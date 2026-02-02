/**
 * @file realtime_manager.cpp
 * @brief Realtime Manager Implementation
 */

#include "realtime_manager.h"
#include "../app_state.h"
#include "../supabase/supabase_client.h"
#include "../supabase/supabase_realtime.h"
#include "../config/config_manager.h"
#include "../common/pairing_manager.h"
#include "../commands/command_processor.h"
#include <ArduinoJson.h>

extern AppState app_state;
extern ConfigManager config_manager;
extern SupabaseClient supabaseClient;
extern SupabaseRealtime supabaseRealtime;
extern PairingManager pairing_manager;

// External debug flags from main.cpp
extern bool g_debug_mode;

// Global instance
RealtimeManager realtimeManager;

namespace {
constexpr int REALTIME_SUBSCRIPTION_MODE = 0;  // 0=all tables, 1=commands only, 2=pairings only, 3=broadcast
constexpr unsigned long INIT_RETRY_INTERVAL = 15000;  // 15 seconds
constexpr unsigned long WATCHDOG_INTERVAL = 30000;    // 30 seconds
}  // namespace

RealtimeManager::RealtimeManager()
    : _initialized(false), _lastInitAttempt(0), _lastSubscribedTime(0),
      _lastWatchdogLog(0), _watchdogInit(false) {
}

RealtimeManager::~RealtimeManager() {
}

void RealtimeManager::begin() {
    _initialized = false;
    _lastInitAttempt = 0;
    _lastSubscribedTime = 0;
    _lastWatchdogLog = 0;
    _watchdogInit = false;
}

void RealtimeManager::loop(unsigned long current_time) {
    // Process realtime events if socket is connected
    if (app_state.wifi_connected && supabaseRealtime.isSocketConnected()) {
        supabaseRealtime.loop();
    }

    // Watchdog: log if not subscribed for too long
    if (!_watchdogInit) {
        _watchdogInit = true;
        _lastSubscribedTime = current_time;
    }

    // Update watchdog timer if socket is connected (not just subscribed)
    // This prevents false positives when messages are flowing but subscription flag is unclear
    if (supabaseRealtime.isSocketConnected()) {
        _lastSubscribedTime = current_time;
    } else if (app_state.wifi_connected && app_state.supabase_connected) {
        if (current_time - _lastSubscribedTime > 60000UL &&
            current_time - _lastWatchdogLog > WATCHDOG_INTERVAL) {
            _lastWatchdogLog = current_time;
            Serial.println("[REALTIME] Watchdog: socket disconnected for 60s");
        }
    }

    // Auto-reconnect if needed
    if (app_state.wifi_connected && app_state.supabase_connected &&
        !supabaseRealtime.isSocketConnected() &&
        !supabaseRealtime.isConnecting()) {

        if (current_time < app_state.realtime_defer_until) {
            return;  // Deferred
        }

        unsigned long interval = supabaseRealtime.hasEverConnected() ? 60000UL : INIT_RETRY_INTERVAL;
        if (current_time - _lastInitAttempt > interval) {
            if (!supabaseClient.isRequestInFlight()) {
                _lastInitAttempt = current_time;
                Serial.println("[REALTIME] Attempting to reconnect...");
                initConnection();
            }
        }
    }
}

bool RealtimeManager::isConnected() const {
    return supabaseRealtime.isConnected();
}

void RealtimeManager::reconnect() {
    supabaseRealtime.disconnect();
    _lastInitAttempt = 0;
}

bool RealtimeManager::initConnection() {
    return attemptInit();
}

bool RealtimeManager::attemptInit() {
    static unsigned long last_realtime_error_log = 0;

    String anonKey = config_manager.getSupabaseAnonKey();

    // Skip if anon key not configured
    if (anonKey.isEmpty()) {
        app_state.realtime_error = "anon_key_missing";
        app_state.last_realtime_error = millis();
        return false;
    }

    if (!app_state.time_synced) {
        app_state.realtime_error = "time_not_synced";
        app_state.last_realtime_error = millis();
        return false;
    }

    const uint32_t min_heap = supabaseRealtime.minHeapRequired();
    if (ESP.getFreeHeap() < min_heap) {
        app_state.realtime_error = "low_heap";
        app_state.last_realtime_error = millis();
        return false;
    }

    String supabaseUrl = config_manager.getSupabaseUrl();
    String accessToken = supabaseClient.getAccessToken();

    if (supabaseUrl.isEmpty() || accessToken.isEmpty()) {
        app_state.realtime_error = "missing_url_or_token";
        app_state.last_realtime_error = millis();
        return false;
    }

    Serial.println("[REALTIME] Initializing Phase B realtime connection...");

    // Set message handler
    supabaseRealtime.setMessageHandler(handleRealtimeMessage);

    // Initialize WebSocket connection
    supabaseRealtime.begin(supabaseUrl, anonKey, accessToken);

    // Subscribe based on mode
    String pairingCode = pairing_manager.getCode();
    if (pairingCode.isEmpty()) {
        Serial.println("[REALTIME] No pairing code - cannot subscribe");
        return false;
    }

    String filter = "pairing_code=eq." + pairingCode;
    Serial.printf("[REALTIME] Subscribing mode=%d\n", REALTIME_SUBSCRIPTION_MODE);

    bool queued = false;

    if (REALTIME_SUBSCRIPTION_MODE == 3) {
        // Broadcast mode
        String channelTopic = "realtime:pairing:" + pairingCode + ":events";
        supabaseRealtime.setChannelTopic(channelTopic);
        queued = supabaseRealtime.subscribeBroadcast();
    } else if (REALTIME_SUBSCRIPTION_MODE == 1) {
        // Commands only
        supabaseRealtime.setChannelTopic("realtime:display");
        const String tables[] = { "commands" };
        queued = supabaseRealtime.subscribeMultiple("display", tables, 1, filter);
    } else if (REALTIME_SUBSCRIPTION_MODE == 2) {
        // Pairings only
        supabaseRealtime.setChannelTopic("realtime:display");
        const String tables[] = { "pairings" };
        queued = supabaseRealtime.subscribeMultiple("display", tables, 1, filter);
    } else {
        // All tables (default)
        supabaseRealtime.setChannelTopic("realtime:display");
        const String tables[] = { "commands", "pairings", "devices" };
        queued = supabaseRealtime.subscribeMultiple("display", tables, 3, filter);
    }

    if (queued) {
        Serial.println("[REALTIME] Subscription requested");
        app_state.realtime_error = "";
        return true;
    }

    Serial.println("[REALTIME] Connection timeout - will retry");
    app_state.realtime_error = "connection_timeout";
    app_state.last_realtime_error = millis();

    unsigned long now = millis();
    if (now - last_realtime_error_log > 600000) {  // 10 minutes
        last_realtime_error_log = now;
        JsonDocument meta;
        meta["reason"] = "connection_timeout";
        meta["heap"] = ESP.getFreeHeap();
        meta["time"] = (unsigned long)time(nullptr);
        String metaStr;
        serializeJson(meta, metaStr);
        supabaseClient.insertDeviceLog("warn", "realtime_connect_failed", metaStr);
    }

    return supabaseRealtime.isSocketConnected();
}

// =============================================================================
// REALTIME MESSAGE HANDLER
// =============================================================================

void handleRealtimeMessage(const RealtimeMessage& msg) {
    if (!msg.valid) {
        return;
    }
    
    Serial.printf("[REALTIME] Received %s on %s.%s\n", 
                  msg.event.c_str(), msg.schema.c_str(), msg.table.c_str());

    // Handle broadcast events (pairing channels)
    if (msg.event == "broadcast") {
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        JsonObject broadcast = payload["payload"];
        if (broadcast.isNull()) {
            Serial.println("[REALTIME] Broadcast payload missing");
            return;
        }

        String broadcastEvent = broadcast["event"] | "";
        JsonVariant inner = broadcast["payload"];
        JsonObject data = inner.is<JsonObject>() ? inner.as<JsonObject>() : broadcast;

        if (data.isNull()) {
            Serial.println("[REALTIME] Broadcast data missing");
            return;
        }

        String table = data["table"] | "";
        String operation = data["operation"] | "";
        JsonObject record = data["record"];

        Serial.printf("[REALTIME] Broadcast %s table=%s op=%s\n",
                      broadcastEvent.c_str(),
                      table.c_str(),
                      operation.c_str());

        if (table == "commands" && operation == "INSERT") {
            if (record.isNull()) {
                Serial.println("[REALTIME] Broadcast command missing record");
                return;
            }

            SupabaseCommand cmd;
            cmd.valid = true;
            cmd.id = record["id"].as<String>();
            cmd.command = record["command"].as<String>();
            cmd.created_at = record["created_at"].as<String>();

            // REGRESSION FIX: Validate command ID before processing
            cmd.id.trim();
            if (cmd.id.isEmpty() || cmd.id.length() < 8) {
                Serial.printf("[REALTIME] Broadcast command has invalid ID: '%s'\n", cmd.id.c_str());
                return;
            }
            
            // Validate command name
            cmd.command.trim();
            if (cmd.command.isEmpty()) {
                Serial.printf("[REALTIME] Broadcast command %s has empty command name\n", cmd.id.c_str());
                return;
            }

            JsonObject cmdPayload = record["payload"];
            if (!cmdPayload.isNull()) {
                serializeJson(cmdPayload, cmd.payload);
            } else {
                cmd.payload = "{}";
            }

            if (commandProcessor.wasRecentlyProcessed(cmd.id)) {
                Serial.printf("[REALTIME] Duplicate command ignored: %s\n", cmd.id.c_str());
                return;
            }

            String status = record["status"].as<String>();
            if (status != "pending") {
                Serial.printf("[REALTIME] Command %s already %s, skipping\n",
                              cmd.id.c_str(), status.c_str());
                return;
            }

            Serial.printf("[REALTIME] Processing command via broadcast: %s (id=%s)\n",
                          cmd.command.c_str(), cmd.id.c_str());
            handleSupabaseCommand(cmd);
        }

        if (table == "pairings" && operation == "UPDATE") {
            if (record.isNull()) {
                Serial.println("[REALTIME] Broadcast pairing missing record");
                return;
            }

            // Extract new values
            bool newAppConnected = record["app_connected"] | false;
            String newWebexStatus = record["webex_status"] | "offline";
            String newDisplayName = record["display_name"] | "";
            bool newCameraOn = record["camera_on"] | false;
            bool newMicMuted = record["mic_muted"] | false;
            bool newInCall = record["in_call"] | false;

            // Check if any STATUS-RELEVANT fields actually changed
            bool statusChanged = false;
            
            if (newAppConnected != app_state.embedded_app_connected ||
                newWebexStatus != app_state.webex_status ||
                (!newDisplayName.isEmpty() && newDisplayName != app_state.embedded_app_display_name)) {
                statusChanged = true;
            }
            
            if (!app_state.xapi_connected) {
                if (newCameraOn != app_state.camera_on ||
                    newMicMuted != app_state.mic_muted ||
                    newInCall != app_state.in_call) {
                    statusChanged = true;
                }
            }
            
            // Ignore heartbeat-only updates
            if (!statusChanged) {
                app_state.last_supabase_sync = millis();
                if (g_debug_mode && config_manager.getPairingRealtimeDebug()) {
                    Serial.println("[REALTIME] Broadcast pairing update ignored (no status change)");
                }
                return;
            }

            // Apply changes
            app_state.supabase_app_connected = newAppConnected;
            app_state.embedded_app_connected = newAppConnected;
            if (newAppConnected) {
                app_state.webex_status = newWebexStatus;
                app_state.webex_status_received = true;
                app_state.webex_status_source = "embedded_app";
                if (!newDisplayName.isEmpty()) {
                    app_state.embedded_app_display_name = newDisplayName;
                }
                if (!app_state.xapi_connected) {
                    app_state.camera_on = newCameraOn;
                    app_state.mic_muted = newMicMuted;
                    app_state.in_call = newInCall;
                }
            }

            app_state.last_supabase_sync = millis();
            Serial.printf("[REALTIME] Pairing status changed (broadcast) - app=%s, status=%s\n",
                          newAppConnected ? "connected" : "disconnected",
                          newWebexStatus.c_str());
        }
        return;
    }
    
    // Handle command insertions (immediate command delivery)
    if (msg.table == "commands" && msg.event == "INSERT") {
        // Extract command data from payload
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        JsonObject data = payload["data"]["record"];
        
        if (data.isNull()) {
            Serial.println("[REALTIME] No record in command payload");
            return;
        }
        
        // Build SupabaseCommand from realtime data
        SupabaseCommand cmd;
        cmd.valid = true;
        cmd.id = data["id"].as<String>();
        cmd.command = data["command"].as<String>();
        cmd.created_at = data["created_at"].as<String>();

        // REGRESSION FIX: Validate command ID before processing
        cmd.id.trim();
        if (cmd.id.isEmpty() || cmd.id.length() < 8) {
            Serial.printf("[REALTIME] INSERT command has invalid ID: '%s'\n", cmd.id.c_str());
            return;
        }
        
        // Validate command name
        cmd.command.trim();
        if (cmd.command.isEmpty()) {
            Serial.printf("[REALTIME] INSERT command %s has empty command name\n", cmd.id.c_str());
            return;
        }

        if (commandProcessor.wasRecentlyProcessed(cmd.id)) {
            Serial.printf("[REALTIME] Duplicate command ignored: %s\n", cmd.id.c_str());
            return;
        }
        
        // Serialize payload to string
        JsonObject cmdPayload = data["payload"];
        if (!cmdPayload.isNull()) {
            serializeJson(cmdPayload, cmd.payload);
        } else {
            cmd.payload = "{}";
        }
        
        // Verify this command is pending (not already processed via polling)
        String status = data["status"].as<String>();
        if (status != "pending") {
            Serial.printf("[REALTIME] Command %s already %s, skipping\n", 
                          cmd.id.c_str(), status.c_str());
            return;
        }
        
        Serial.printf("[REALTIME] Processing command via realtime: %s (id=%s)\n",
                      cmd.command.c_str(), cmd.id.c_str());
        
        // Handle the command (same handler as polling)
        handleSupabaseCommand(cmd);
    }
    
    // Handle pairing updates (app connection state changes)
    if (msg.table == "pairings" && msg.event == "UPDATE") {
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        JsonObject data = payload["data"]["record"];
        
        if (!data.isNull()) {
            // Extract new values from realtime message
            bool newAppConnected = data["app_connected"] | false;
            String newWebexStatus = data["webex_status"] | "offline";
            String newDisplayName = data["display_name"] | "";
            bool newCameraOn = data["camera_on"] | false;
            bool newMicMuted = data["mic_muted"] | false;
            bool newInCall = data["in_call"] | false;
            
            // Check if any STATUS-RELEVANT fields actually changed
            // (ignore heartbeat-only updates that only change app_last_seen/device_last_seen)
            bool statusChanged = false;
            
            // Check connection state changes
            if (newAppConnected != app_state.embedded_app_connected) {
                statusChanged = true;
            }
            
            // Check webex status change
            if (newWebexStatus != app_state.webex_status) {
                statusChanged = true;
            }
            
            // Check display name change (only if non-empty)
            if (!newDisplayName.isEmpty() && newDisplayName != app_state.embedded_app_display_name) {
                statusChanged = true;
            }
            
            // Check camera/mic/call state changes (only if not using xAPI)
            if (!app_state.xapi_connected) {
                if (newCameraOn != app_state.camera_on ||
                    newMicMuted != app_state.mic_muted ||
                    newInCall != app_state.in_call) {
                    statusChanged = true;
                }
            }
            
            // Only process and log if something actually changed
            if (!statusChanged) {
                app_state.last_supabase_sync = millis();
                // Heartbeat-only update - silently ignore
                if (g_debug_mode && config_manager.getPairingRealtimeDebug()) {
                    Serial.println("[REALTIME] Pairing update ignored (no status change - likely heartbeat)");
                }
                return;
            }
            
            // Apply the changes to app state
            app_state.supabase_app_connected = newAppConnected;
            app_state.embedded_app_connected = newAppConnected;
            if (newAppConnected) {
                app_state.webex_status = newWebexStatus;
                app_state.webex_status_received = true;
                app_state.webex_status_source = "embedded_app";
                
                if (!newDisplayName.isEmpty()) {
                    app_state.embedded_app_display_name = newDisplayName;
                }
                
                // Only update camera/mic/call if not using xAPI
                if (!app_state.xapi_connected) {
                    app_state.camera_on = newCameraOn;
                    app_state.mic_muted = newMicMuted;
                    app_state.in_call = newInCall;
                }
            }
            
            app_state.last_supabase_sync = millis();
            Serial.printf("[REALTIME] Pairing status changed - app=%s, status=%s, camera=%s, mic=%s, inCall=%s\n",
                          newAppConnected ? "connected" : "disconnected",
                          newWebexStatus.c_str(),
                          newCameraOn ? "on" : "off",
                          newMicMuted ? "muted" : "unmuted",
                          newInCall ? "yes" : "no");

            if (g_debug_mode && config_manager.getPairingRealtimeDebug()) {
                JsonDocument debugDoc;
                debugDoc["app_connected"] = newAppConnected;
                debugDoc["webex_status"] = newWebexStatus;
                debugDoc["display_name"] = newDisplayName;
                debugDoc["camera_on"] = newCameraOn;
                debugDoc["mic_muted"] = newMicMuted;
                debugDoc["in_call"] = newInCall;
                String debugJson;
                serializeJson(debugDoc, debugJson);
                Serial.printf("[REALTIME][DEBUG] Pairing payload: %s\n", debugJson.c_str());
            }
        }
    }

    // Handle device updates (admin debug toggle)
    // Device realtime handler removed - using single connection now
}
