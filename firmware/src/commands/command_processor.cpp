/**
 * @file command_processor.cpp
 * @brief Command Processor Implementation
 */

#include <Arduino.h>
#include "command_processor.h"
#include "../app_state.h"
#include "../supabase/supabase_client.h"
#include "../supabase/supabase_realtime.h"
#include "../config/config_manager.h"
#include "../common/pairing_manager.h"
#include "../device/device_info.h"
#include "../display/matrix_display.h"
#include "../time/time_manager.h"
#include "../meraki/mqtt_client.h"
#include "../debug/log_system.h"
#include "../core/dependencies.h"
#include "../ota/ota_manager.h"
#include "../sync/sync_manager.h"
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_heap_caps.h>

// Firmware version from build
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

// Include for hasSafeTlsHeap
#include "../loop/loop_handlers.h"

static const char* TAG = "CMD";

// Global instance
CommandProcessor commandProcessor;

CommandProcessor::CommandProcessor()
    : _recentCommandIndex(0), _pendingAckHead(0), _pendingAckCount(0),
      _pendingAction(PendingCommandAction::None), _pendingActionSince(0),
      _pendingActionLastLog(0) {
}

CommandProcessor::~CommandProcessor() {
}

void CommandProcessor::begin() {
    _recentCommandIndex = 0;
    _pendingAckHead = 0;
    _pendingAckCount = 0;
    _pendingAction = PendingCommandAction::None;
    _pendingActionId = "";
    _pendingActionSince = 0;
    _pendingActionLastLog = 0;

    for (uint8_t i = 0; i < MAX_RECENT_COMMANDS; i++) {
        _recentCommandIds[i] = "";
    }
}

bool CommandProcessor::wasRecentlyProcessed(const String& id) const {
    if (id.isEmpty()) {
        return false;
    }
    for (uint8_t i = 0; i < MAX_RECENT_COMMANDS; i++) {
        if (!_recentCommandIds[i].isEmpty() && _recentCommandIds[i] == id) {
            return true;
        }
    }
    return false;
}

void CommandProcessor::markProcessed(const String& id) {
    if (id.isEmpty()) {
        return;
    }
    _recentCommandIds[_recentCommandIndex] = id;
    _recentCommandIndex = (_recentCommandIndex + 1) % MAX_RECENT_COMMANDS;
}

void CommandProcessor::queuePendingAction(PendingCommandAction action, const String& id) {
    auto& deps = getDependencies();
    if (id.isEmpty()) {
        return;
    }
    if (_pendingAction != PendingCommandAction::None) {
        if (_pendingActionId == id) {
            return;
        }
        ESP_LOGW(TAG, "Another action already pending; ignoring id=%s", id.c_str());
        return;
    }

    _pendingAction = action;
    _pendingActionId = id;
    _pendingActionSince = millis();
    _pendingActionLastLog = 0;
    markProcessed(id);

    // Free heap by disconnecting realtime before ack + reboot
    deps.realtime.disconnect();
    deps.app_state.realtime_defer_until = millis() + 60000UL;

    ESP_LOGW(TAG, "%s queued (id=%s) - waiting for safe heap",
             action == PendingCommandAction::FactoryReset ? "Factory reset" : "Reboot",
             id.c_str());
}

void CommandProcessor::processPendingActions() {
    auto& deps = getDependencies();
    if (_pendingAction == PendingCommandAction::None) {
        return;
    }

    const unsigned long now = millis();
    deps.app_state.realtime_defer_until = now + 60000UL;

    if (!hasSafeTlsHeap(65000, 40000)) {
        if (now - _pendingActionLastLog > 10000) {
            _pendingActionLastLog = now;
            ESP_LOGD(TAG, "Pending command waiting for TLS heap (%lus)",
                     (now - _pendingActionSince) / 1000);
        }
        return;
    }

    if (deps.supabase.isRequestInFlight()) {
        return;
    }

    if (!deps.supabase.ackCommand(_pendingActionId, true, "", "")) {
        if (now - _pendingActionLastLog > 10000) {
            _pendingActionLastLog = now;
            ESP_LOGW(TAG, "Pending command ack failed; will retry");
        }
        return;
    }

    markProcessed(_pendingActionId);

    if (_pendingAction == PendingCommandAction::FactoryReset) {
        deps.config.factoryReset();
    }

    _pendingAction = PendingCommandAction::None;
    _pendingActionId = "";

    delay(500);
    ESP.restart();
}

bool CommandProcessor::enqueuePendingAck(const String& id, bool success,
                                          const String& response, const String& error) {
    if (_pendingAckCount >= MAX_PENDING_ACKS) {
        ESP_LOGW(TAG, "Ack queue full; dropping ack");
        return false;
    }

    uint8_t slot = (_pendingAckHead + _pendingAckCount) % MAX_PENDING_ACKS;
    _pendingAcks[slot] = { id, success, response, error };
    _pendingAckCount++;
    return true;
}

void CommandProcessor::processPendingAcks() {
    auto& deps = getDependencies();
    if (_pendingAckCount == 0) {
        return;
    }

    if (!deps.supabase.isAuthenticated()) {
        return;
    }

    const bool realtime_connecting = deps.realtime.isConnecting();
    if (realtime_connecting) {
        return;
    }

    if (!hasSafeTlsHeap(65000, 40000)) {
        return;
    }

    while (_pendingAckCount > 0) {
        PendingAck& ack = _pendingAcks[_pendingAckHead];
        if (!deps.supabase.ackCommand(ack.id, ack.success, ack.response, ack.error)) {
            break;
        }
        _pendingAckHead = (_pendingAckHead + 1) % MAX_PENDING_ACKS;
        _pendingAckCount--;
    }
}

bool CommandProcessor::sendOrQueueAck(const String& id, bool success,
                                       const String& response, const String& error) {
    auto& deps = getDependencies();
    const bool realtime_connecting = deps.realtime.isConnecting();
    if (realtime_connecting || !hasSafeTlsHeap(65000, 40000)) {
        return enqueuePendingAck(id, success, response, error);
    }

    if (!deps.supabase.ackCommand(id, success, response, error)) {
        return enqueuePendingAck(id, success, response, error);
    }
    return true;
}

// =============================================================================
// SUPABASE COMMAND HANDLER
// =============================================================================

void handleSupabaseCommand(const SupabaseCommand& cmd) {
    auto& deps = getDependencies();
    ESP_LOGI(TAG, "Processing: %s (id=%s)", cmd.command.c_str(), cmd.id.c_str());
    
    bool success = true;
    String response = "";
    String error = "";
    
    if (cmd.command == "get_status") {
        response = DeviceInfo::buildStatusJson();
        
    } else if (cmd.command == "get_telemetry") {
        int rssi = WiFi.RSSI();
        uint32_t freeHeap = ESP.getFreeHeap();
        uint32_t uptime = millis() / 1000;
        float temp = deps.app_state.temperature;
        if (!hasSafeTlsHeap(65000, 40000)) {
            success = false;
            error = "low_heap";
        } else {
            SupabaseAppState appState = deps.supabase.postDeviceState(
                rssi, freeHeap, uptime, FIRMWARE_VERSION, temp);
            if (!appState.valid) {
                success = false;
                error = "get_telemetry failed";
            } else {
                DeviceInfo::applyAppState(appState);
                response = DeviceInfo::buildTelemetryJson();
            }
        }

    } else if (cmd.command == "get_troubleshooting_status") {
        response = DeviceInfo::buildStatusJson();

    } else if (cmd.command == "get_config") {
        response = DeviceInfo::buildConfigJson();
        syncManager.broadcastDeviceConfig();
        
    } else if (cmd.command == "set_config") {
        JsonDocument doc;
        DeserializationError parseError = deserializeJson(doc, cmd.payload);
        
        if (parseError) {
            success = false;
            error = "Invalid JSON";
        } else {
            // Apply settings
            if (doc["display_name"].is<const char*>()) {
                deps.config.setDisplayName(doc["display_name"].as<String>());
            }
            if (doc["brightness"].is<int>()) {
                uint8_t brightness = doc["brightness"].as<uint8_t>();
                deps.config.setBrightness(brightness);
                deps.display.setBrightness(brightness);
            }
            if (doc["scroll_speed_ms"].is<int>()) {
                uint16_t speed = doc["scroll_speed_ms"].as<uint16_t>();
                deps.config.setScrollSpeedMs(speed);
                deps.display.setScrollSpeedMs(speed);
            }
            if (doc["page_interval_ms"].is<int>()) {
                uint16_t interval = doc["page_interval_ms"].as<uint16_t>();
                deps.config.setPageIntervalMs(interval);
                deps.display.setPageIntervalMs(deps.config.getPageIntervalMs());
            }
            if (doc["sensor_page_enabled"].is<bool>()) {
                deps.config.setSensorPageEnabled(doc["sensor_page_enabled"].as<bool>());
            }
            if (doc["display_pages"].is<const char*>()) {
                deps.config.setDisplayPages(doc["display_pages"].as<const char*>());
            }
            if (doc["status_layout"].is<const char*>()) {
                deps.config.setStatusLayout(doc["status_layout"].as<const char*>());
            }
            if (doc["date_color"].is<const char*>()) {
                deps.config.setDateColor(doc["date_color"].as<String>());
            }
            if (doc["time_color"].is<const char*>()) {
                deps.config.setTimeColor(doc["time_color"].as<String>());
            }
            if (doc["name_color"].is<const char*>()) {
                deps.config.setNameColor(doc["name_color"].as<String>());
            }
            if (doc["metric_color"].is<const char*>()) {
                deps.config.setMetricColor(doc["metric_color"].as<String>());
            }
            if (doc["time_zone"].is<const char*>()) {
                deps.config.setTimeZone(doc["time_zone"].as<String>());
                if (!applyTimeConfig(deps.config, &deps.app_state)) {
                    ESP_LOGE(TAG, "Failed to apply new time zone configuration");
                }
            }
            if (doc["time_format"].is<const char*>()) {
                deps.config.setTimeFormat(doc["time_format"].as<String>());
            }
            if (doc["date_format"].is<const char*>()) {
                deps.config.setDateFormat(doc["date_format"].as<String>());
            }
            if (doc["tls_verify"].is<bool>()) {
                deps.config.setTlsVerify(doc["tls_verify"].as<bool>());
            }
            // Update MQTT config if broker is provided (indicates MQTT update intent)
            if (doc["mqtt_broker"].is<const char*>()) {
                // Get current values as defaults (for fields not provided)
                String currentBroker = deps.config.getMQTTBroker();
                uint16_t currentPort = deps.config.getMQTTPort();
                String currentUsername = deps.config.getMQTTUsername();
                String currentPassword = deps.config.getMQTTPassword();
                String currentTopic = deps.config.getMQTTTopic();
                
                // Update only provided fields, keep current values for others
                String broker = doc["mqtt_broker"].as<String>();
                // Port: use provided value if present, otherwise keep current
                uint16_t port = doc["mqtt_port"].is<int>() ? doc["mqtt_port"].as<uint16_t>() : currentPort;
                // Username: use provided value if present (even if empty), otherwise keep current
                String username = doc["mqtt_username"].is<const char*>() ? doc["mqtt_username"].as<String>() : currentUsername;
                // Password: only update if explicitly provided
                String password = doc["mqtt_password"].is<const char*>() ? doc["mqtt_password"].as<String>() : currentPassword;
                bool updatePassword = doc["mqtt_password"].is<const char*>();
                // Topic: use provided value if present, otherwise keep current
                String topic = doc["mqtt_topic"].is<const char*>() ? doc["mqtt_topic"].as<String>() : currentTopic;
                
                deps.config.updateMQTTConfig(broker, port, username, password, updatePassword, topic);
                ESP_LOGI(TAG, "MQTT config updated");
                deps.mqtt.invalidateConfig();  // Reconnect with new MQTT settings
            }
            if (doc["display_sensor_mac"].is<const char*>()) {
                deps.config.setDisplaySensorMac(doc["display_sensor_mac"].as<String>());
            }
            if (doc["display_metric"].is<const char*>()) {
                deps.config.setDisplayMetric(doc["display_metric"].as<String>());
            }
            if (doc["sensor_macs"].is<const char*>()) {
                deps.config.setSensorMacs(doc["sensor_macs"].as<String>());
            } else if (doc["sensor_serial"].is<const char*>()) {
                deps.config.setSensorSerial(doc["sensor_serial"].as<String>());
            }
            if (doc["poll_interval"].is<int>()) {
                deps.config.setWebexPollInterval(doc["poll_interval"].as<uint16_t>());
            }
            // Log verbosity level: "none", "error", "warn", "info", "debug", "verbose"
            if (doc["log_level"].is<const char*>()) {
                String level = doc["log_level"].as<String>();
                level.toUpperCase();
                esp_log_level_t esp_level = ESP_LOG_INFO;
                if (level == "NONE")         esp_level = ESP_LOG_NONE;
                else if (level == "ERROR")   esp_level = ESP_LOG_ERROR;
                else if (level == "WARN")    esp_level = ESP_LOG_WARN;
                else if (level == "INFO")    esp_level = ESP_LOG_INFO;
                else if (level == "DEBUG")   esp_level = ESP_LOG_DEBUG;
                else if (level == "VERBOSE") esp_level = ESP_LOG_VERBOSE;
                esp_log_level_set("*", esp_level);
                ESP_LOGI(TAG, "Log level set to %s via set_config", level.c_str());
            }
            
            response = DeviceInfo::buildConfigJson();
            ESP_LOGI(TAG, "Config updated via set_config");
            syncManager.broadcastDeviceConfig();
        }
        
    } else if (cmd.command == "set_brightness") {
        JsonDocument doc;
        deserializeJson(doc, cmd.payload);
        uint8_t brightness = doc["value"] | 128;
        deps.config.setBrightness(brightness);
        deps.display.setBrightness(brightness);
        
    } else if (cmd.command == "regenerate_pairing") {
        String newCode = deps.pairing.generateCode(true);
        deps.supabase.setPairingCode(newCode);  // Update Supabase client
        deps.app_state.supabase_realtime_resubscribe = true;
        JsonDocument resp;
        resp["code"] = newCode;
        serializeJson(resp, response);

    } else if (cmd.command == "set_remote_debug") {
        JsonDocument doc;
        deserializeJson(doc, cmd.payload);
        bool enabled = doc["enabled"] | false;
        deps.supabase.setRemoteDebugEnabled(enabled);
        log_system_set_remote_enabled(enabled);
        ESP_LOGI(TAG, "Remote debug %s", enabled ? "ENABLED" : "DISABLED");
        JsonDocument resp;
        resp["enabled"] = enabled;
        serializeJson(resp, response);
        
    } else if (cmd.command == "ota_update") {
        ESP_LOGI(TAG, "OTA update requested");
        
        // Check if update is already available (from previous check)
        bool update_available = deps.ota.isUpdateAvailable();
        String latest_version = deps.ota.getLatestVersion();
        
        // If not already checked, check for updates now
        if (!update_available || latest_version.isEmpty()) {
            bool realtime_was_active = deps.realtime.isConnected() || deps.realtime.isConnecting();
            if (realtime_was_active) {
                ESP_LOGI(TAG, "Pausing realtime during OTA check");
                deps.realtime.disconnect();
            }
            deps.app_state.realtime_defer_until = millis() + 30000UL;
            
            if (deps.ota.checkForUpdate()) {
                update_available = deps.ota.isUpdateAvailable();
                latest_version = deps.ota.getLatestVersion();
            } else {
                success = false;
                error = "Failed to check for updates";
                ESP_LOGW(TAG, "OTA check failed");
            }
            
            if (realtime_was_active) {
                deps.app_state.supabase_realtime_resubscribe = true;
            }
        }
        
        // Build response JSON
        JsonDocument resp;
        resp["current_version"] = FIRMWARE_VERSION;
        resp["latest_version"] = latest_version.isEmpty() ? FIRMWARE_VERSION : latest_version;
        resp["update_available"] = update_available;
        
        if (!success) {
            // Check failed
            resp["status"] = "check_failed";
            resp["error"] = error;
        } else if (update_available && !latest_version.isEmpty()) {
            String download_url = deps.ota.getDownloadUrl();
            if (!download_url.isEmpty()) {
                resp["download_url"] = download_url;
            }
            resp["status"] = "update_starting";
            ESP_LOGI(TAG, "Update available: %s -> %s", FIRMWARE_VERSION, latest_version.c_str());
        } else {
            resp["status"] = "already_latest";
            ESP_LOGI(TAG, "Already on latest version: %s", latest_version.isEmpty() ? FIRMWARE_VERSION : latest_version.c_str());
        }
        
        serializeJson(resp, response);
        
        // If update is available, start the update process
        // Note: We send the ack first since the device will reboot on success
        if (update_available && !latest_version.isEmpty() && success) {
            // Clear any previous failed version marker since this is a manual update request
            deps.config.clearFailedOTAVersion();
            
            // Show updating screen
            deps.display.showUpdating(latest_version);
            
            // Disconnect realtime and defer for 10 minutes to cover the entire download
            if (deps.realtime.isConnected() || deps.realtime.isConnecting()) {
                ESP_LOGI(TAG, "Disconnecting realtime for OTA update");
                deps.realtime.disconnect();
            }
            deps.app_state.realtime_defer_until = millis() + 600000UL;  // 10 minutes
            
            // Send ack before starting update (device will reboot on success)
            const bool ackQueued = commandProcessor.sendOrQueueAck(cmd.id, success, response, error);
            if (ackQueued) {
                commandProcessor.markProcessed(cmd.id);
            }
            
            // Small delay to ensure ack is sent
            delay(500);
            
            // Start the update (will reboot on success)
            if (deps.ota.performUpdate()) {
                ESP_LOGI(TAG, "OTA update successful, rebooting...");
                // ESP.restart() is called inside performUpdate() on success
            } else {
                ESP_LOGE(TAG, "OTA update failed");
                deps.display.unlockFromOTA();
                // Record this version as failed to prevent retry loop
                deps.config.setFailedOTAVersion(latest_version);
                ESP_LOGW(TAG, "Marked version %s as failed", latest_version.c_str());
                
                // Update response with failure status
                resp["status"] = "update_failed";
                serializeJson(resp, response);
                commandProcessor.sendOrQueueAck(cmd.id, false, response, "Update installation failed");
                return;
            }
            return;  // Device will reboot, so we won't reach the normal ack code below
        }
        
    } else if (cmd.command == "reboot") {
        commandProcessor.queuePendingAction(PendingCommandAction::Reboot, cmd.id);
        return;
        
    } else if (cmd.command == "factory_reset") {
        // Factory reset is disabled for remote commands - must be done locally
        // This prevents breaking the connection to Supabase and losing device credentials
        success = false;
        error = "Factory reset must be performed locally via serial console";
        
    } else {
        success = false;
        error = "Unknown command: " + cmd.command;
    }
    
    // Log result
    if (success) {
        ESP_LOGI(TAG, "Completed: %s (id=%s) response_len=%d",
                 cmd.command.c_str(), cmd.id.c_str(), response.length());
    } else {
        ESP_LOGW(TAG, "Failed: %s (id=%s) error=%s",
                 cmd.command.c_str(), cmd.id.c_str(), error.c_str());
    }

    // Send acknowledgment
    const bool ackQueued = commandProcessor.sendOrQueueAck(cmd.id, success, response, error);
    if (ackQueued) {
        ESP_LOGD(TAG, "Ack queued for %s (id=%s)", cmd.command.c_str(), cmd.id.c_str());
        commandProcessor.markProcessed(cmd.id);
    } else {
        ESP_LOGW(TAG, "Ack failed for %s (id=%s)", cmd.command.c_str(), cmd.id.c_str());
    }
}
