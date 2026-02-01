/**
 * @file command_processor.cpp
 * @brief Command Processor Implementation
 */

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
#include "../debug/remote_logger.h"
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_heap_caps.h>

// Firmware version from build
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

extern AppState app_state;
extern SupabaseClient supabaseClient;
extern SupabaseRealtime supabaseRealtime;
extern ConfigManager config_manager;
extern PairingManager pairing_manager;
extern MatrixDisplay matrix_display;
extern MerakiMQTTClient mqtt_client;
extern RemoteLogger remoteLogger;

// Include for hasSafeTlsHeap
#include "../loop/loop_handlers.h"

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
    if (id.isEmpty()) {
        return;
    }
    if (_pendingAction != PendingCommandAction::None) {
        if (_pendingActionId == id) {
            return;
        }
        Serial.println("[SUPABASE] Another command action already pending; ignoring");
        return;
    }

    _pendingAction = action;
    _pendingActionId = id;
    _pendingActionSince = millis();
    _pendingActionLastLog = 0;
    markProcessed(id);

    // Free heap by disconnecting realtime before ack + reboot
    supabaseRealtime.disconnect();
    app_state.realtime_defer_until = millis() + 60000UL;

    Serial.printf("[SUPABASE] %s queued - waiting for safe heap to ack\n",
                  action == PendingCommandAction::FactoryReset ? "Factory reset" : "Reboot");
}

void CommandProcessor::processPendingActions() {
    if (_pendingAction == PendingCommandAction::None) {
        return;
    }

    const unsigned long now = millis();
    app_state.realtime_defer_until = now + 60000UL;

    if (!hasSafeTlsHeap(65000, 40000)) {
        if (now - _pendingActionLastLog > 10000) {
            _pendingActionLastLog = now;
            Serial.printf("[SUPABASE] Pending command waiting for TLS heap (%lus)\n",
                          (now - _pendingActionSince) / 1000);
        }
        return;
    }

    if (supabaseClient.isRequestInFlight()) {
        return;
    }

    if (!supabaseClient.ackCommand(_pendingActionId, true, "", "")) {
        if (now - _pendingActionLastLog > 10000) {
            _pendingActionLastLog = now;
            Serial.println("[SUPABASE] Pending command ack failed; will retry");
        }
        return;
    }

    markProcessed(_pendingActionId);

    if (_pendingAction == PendingCommandAction::FactoryReset) {
        config_manager.factoryReset();
    }

    _pendingAction = PendingCommandAction::None;
    _pendingActionId = "";

    delay(500);
    ESP.restart();
}

bool CommandProcessor::enqueuePendingAck(const String& id, bool success,
                                          const String& response, const String& error) {
    if (_pendingAckCount >= MAX_PENDING_ACKS) {
        Serial.println("[SUPABASE] Ack queue full; dropping command ack");
        return false;
    }

    uint8_t slot = (_pendingAckHead + _pendingAckCount) % MAX_PENDING_ACKS;
    _pendingAcks[slot] = { id, success, response, error };
    _pendingAckCount++;
    return true;
}

void CommandProcessor::processPendingAcks() {
    if (_pendingAckCount == 0) {
        return;
    }

    if (!supabaseClient.isAuthenticated()) {
        return;
    }

    const bool realtime_connecting = supabaseRealtime.isConnecting();
    if (realtime_connecting) {
        return;
    }

    if (!hasSafeTlsHeap(65000, 40000)) {
        return;
    }

    while (_pendingAckCount > 0) {
        PendingAck& ack = _pendingAcks[_pendingAckHead];
        if (!supabaseClient.ackCommand(ack.id, ack.success, ack.response, ack.error)) {
            break;
        }
        _pendingAckHead = (_pendingAckHead + 1) % MAX_PENDING_ACKS;
        _pendingAckCount--;
    }
}

bool CommandProcessor::sendOrQueueAck(const String& id, bool success,
                                       const String& response, const String& error) {
    const bool realtime_connecting = supabaseRealtime.isConnecting();
    if (realtime_connecting || !hasSafeTlsHeap(65000, 40000)) {
        return enqueuePendingAck(id, success, response, error);
    }

    if (!supabaseClient.ackCommand(id, success, response, error)) {
        return enqueuePendingAck(id, success, response, error);
    }
    return true;
}

// =============================================================================
// SUPABASE COMMAND HANDLER
// =============================================================================

void handleSupabaseCommand(const SupabaseCommand& cmd) {
    Serial.printf("[CMD-SB] Processing command: %s\n", cmd.command.c_str());
    
    bool success = true;
    String response = "";
    String error = "";
    
    if (cmd.command == "get_status") {
        response = DeviceInfo::buildStatusJson();
        
    } else if (cmd.command == "get_telemetry") {
        int rssi = WiFi.RSSI();
        uint32_t freeHeap = ESP.getFreeHeap();
        uint32_t uptime = millis() / 1000;
        float temp = app_state.temperature;
        if (!hasSafeTlsHeap(65000, 40000)) {
            success = false;
            error = "low_heap";
        } else {
            SupabaseAppState appState = supabaseClient.postDeviceState(
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
        
    } else if (cmd.command == "set_config") {
        JsonDocument doc;
        DeserializationError parseError = deserializeJson(doc, cmd.payload);
        
        if (parseError) {
            success = false;
            error = "Invalid JSON";
        } else {
            // Apply settings
            if (doc["display_name"].is<const char*>()) {
                config_manager.setDisplayName(doc["display_name"].as<String>());
            }
            if (doc["brightness"].is<int>()) {
                uint8_t brightness = doc["brightness"].as<uint8_t>();
                config_manager.setBrightness(brightness);
                matrix_display.setBrightness(brightness);
            }
            if (doc["scroll_speed_ms"].is<int>()) {
                uint16_t speed = doc["scroll_speed_ms"].as<uint16_t>();
                config_manager.setScrollSpeedMs(speed);
                matrix_display.setScrollSpeedMs(speed);
            }
            if (doc["page_interval_ms"].is<int>()) {
                uint16_t interval = doc["page_interval_ms"].as<uint16_t>();
                config_manager.setPageIntervalMs(interval);
                matrix_display.setPageIntervalMs(config_manager.getPageIntervalMs());
            }
            if (doc["sensor_page_enabled"].is<bool>()) {
                config_manager.setSensorPageEnabled(doc["sensor_page_enabled"].as<bool>());
            }
            if (doc["display_pages"].is<const char*>()) {
                config_manager.setDisplayPages(doc["display_pages"].as<const char*>());
            }
            if (doc["status_layout"].is<const char*>()) {
                config_manager.setStatusLayout(doc["status_layout"].as<const char*>());
            }
            if (doc["date_color"].is<const char*>()) {
                config_manager.setDateColor(doc["date_color"].as<String>());
            }
            if (doc["time_color"].is<const char*>()) {
                config_manager.setTimeColor(doc["time_color"].as<String>());
            }
            if (doc["name_color"].is<const char*>()) {
                config_manager.setNameColor(doc["name_color"].as<String>());
            }
            if (doc["metric_color"].is<const char*>()) {
                config_manager.setMetricColor(doc["metric_color"].as<String>());
            }
            if (doc["time_zone"].is<const char*>()) {
                config_manager.setTimeZone(doc["time_zone"].as<String>());
                if (!applyTimeConfig(config_manager, &app_state)) {
                    Serial.println("[SUPABASE] Failed to apply new time zone configuration");
                }
            }
            if (doc["time_format"].is<const char*>()) {
                config_manager.setTimeFormat(doc["time_format"].as<String>());
            }
            if (doc["date_format"].is<const char*>()) {
                config_manager.setDateFormat(doc["date_format"].as<String>());
            }
            if (doc["tls_verify"].is<bool>()) {
                config_manager.setTlsVerify(doc["tls_verify"].as<bool>());
            }
            // Update MQTT config if broker is provided (indicates MQTT update intent)
            if (doc["mqtt_broker"].is<const char*>()) {
                // Get current values as defaults (for fields not provided)
                String currentBroker = config_manager.getMQTTBroker();
                uint16_t currentPort = config_manager.getMQTTPort();
                String currentUsername = config_manager.getMQTTUsername();
                String currentPassword = config_manager.getMQTTPassword();
                String currentTopic = config_manager.getMQTTTopic();
                
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
                
                config_manager.updateMQTTConfig(broker, port, username, password, updatePassword, topic);
                Serial.println("[CMD-SB] MQTT config updated");
                mqtt_client.invalidateConfig();  // Reconnect with new MQTT settings
            }
            if (doc["display_sensor_mac"].is<const char*>()) {
                config_manager.setDisplaySensorMac(doc["display_sensor_mac"].as<String>());
            }
            if (doc["display_metric"].is<const char*>()) {
                config_manager.setDisplayMetric(doc["display_metric"].as<String>());
            }
            if (doc["sensor_macs"].is<const char*>()) {
                config_manager.setSensorMacs(doc["sensor_macs"].as<String>());
            } else if (doc["sensor_serial"].is<const char*>()) {
                config_manager.setSensorSerial(doc["sensor_serial"].as<String>());
            }
            if (doc["poll_interval"].is<int>()) {
                config_manager.setWebexPollInterval(doc["poll_interval"].as<uint16_t>());
            }
            
            response = DeviceInfo::buildConfigJson();
            Serial.println("[CMD-SB] Config updated");
        }
        
    } else if (cmd.command == "set_brightness") {
        JsonDocument doc;
        deserializeJson(doc, cmd.payload);
        uint8_t brightness = doc["value"] | 128;
        config_manager.setBrightness(brightness);
        matrix_display.setBrightness(brightness);
        
    } else if (cmd.command == "regenerate_pairing") {
        String newCode = pairing_manager.generateCode(true);
        supabaseClient.setPairingCode(newCode);  // Update Supabase client
        app_state.supabase_realtime_resubscribe = true;
        JsonDocument resp;
        resp["code"] = newCode;
        serializeJson(resp, response);

    } else if (cmd.command == "set_remote_debug") {
        JsonDocument doc;
        deserializeJson(doc, cmd.payload);
        bool enabled = doc["enabled"] | false;
        supabaseClient.setRemoteDebugEnabled(enabled);
        remoteLogger.setRemoteEnabled(enabled);
        JsonDocument resp;
        resp["enabled"] = enabled;
        serializeJson(resp, response);
        
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
    
    // Send acknowledgment
    const bool ackQueued = commandProcessor.sendOrQueueAck(cmd.id, success, response, error);
    if (ackQueued) {
        commandProcessor.markProcessed(cmd.id);
    }
}
