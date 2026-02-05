/**
 * @file realtime_handlers.cpp
 * @brief Realtime message routing and handling
 */

#include "realtime_manager.h"
#include "../app_state.h"
#include "../config/config_manager.h"
#include "../commands/command_processor.h"
#include "../supabase/supabase_client.h"
#include "../supabase/supabase_realtime.h"
#include "../core/dependencies.h"
#include <ArduinoJson.h>

// Forward declarations
void handleSupabaseCommand(const SupabaseCommand& cmd);

/**
 * @brief Validate command ID
 * @param cmdId Command ID to validate
 * @return true if valid, false otherwise
 */
bool validateCommandId(const String& cmdId) {
    String trimmed = cmdId;
    trimmed.trim();
    if (trimmed.isEmpty() || trimmed.length() < 8) {
        Serial.printf("[REALTIME] Command has invalid ID: '%s'\n", trimmed.c_str());
        return false;
    }
    return true;
}

/**
 * @brief Validate command name
 * @param cmdName Command name to validate
 * @param cmdId Command ID for error logging
 * @return true if valid, false otherwise
 */
bool validateCommandName(const String& cmdName, const String& cmdId) {
    String trimmed = cmdName;
    trimmed.trim();
    if (trimmed.isEmpty()) {
        Serial.printf("[REALTIME] Command %s has empty command name\n", cmdId.c_str());
        return false;
    }
    return true;
}

/**
 * @brief Build SupabaseCommand from JSON record
 * @param record JSON object containing command data
 * @param cmd Output command structure
 * @return true if command was built successfully
 */
bool buildCommandFromJson(const JsonObject& record, SupabaseCommand& cmd) {
    cmd.valid = true;
    cmd.id = record["id"].as<String>();
    cmd.command = record["command"].as<String>();
    cmd.created_at = record["created_at"].as<String>();

    // Validate command ID
    if (!validateCommandId(cmd.id)) {
        return false;
    }

    // Validate command name
    if (!validateCommandName(cmd.command, cmd.id)) {
        return false;
    }

    // Serialize payload to string
    JsonObject cmdPayload = record["payload"];
    if (!cmdPayload.isNull()) {
        serializeJson(cmdPayload, cmd.payload);
    } else {
        cmd.payload = "{}";
    }

    return true;
}

/**
 * @brief Handle broadcast command event
 * @param record JSON object containing command data
 */
void handleBroadcastCommand(const JsonObject& record) {
    auto& deps = getDependencies();
    
    if (record.isNull()) {
        Serial.println("[REALTIME] Broadcast command missing record");
        return;
    }

    SupabaseCommand cmd;
    if (!buildCommandFromJson(record, cmd)) {
        return;
    }

    if (deps.command_processor.wasRecentlyProcessed(cmd.id)) {
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

/**
 * @brief Handle broadcast pairing update event
 * @param record JSON object containing pairing data
 */
void handleBroadcastPairing(const JsonObject& record) {
    auto& deps = getDependencies();
    
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

    if (newAppConnected != deps.app_state.embedded_app_connected ||
        newWebexStatus != deps.app_state.webex_status ||
        (!newDisplayName.isEmpty() && newDisplayName != deps.app_state.embedded_app_display_name)) {
        statusChanged = true;
    }

    if (!deps.app_state.xapi_connected) {
        if (newCameraOn != deps.app_state.camera_on ||
            newMicMuted != deps.app_state.mic_muted ||
            newInCall != deps.app_state.in_call) {
            statusChanged = true;
        }
    }

    // Ignore heartbeat-only updates
    if (!statusChanged) {
        deps.app_state.last_supabase_sync = millis();
        if (deps.debug_mode && deps.config.getPairingRealtimeDebug()) {
            Serial.println("[REALTIME] Broadcast pairing update ignored (no status change)");
        }
        return;
    }

    // Apply changes
    deps.app_state.supabase_app_connected = newAppConnected;
    deps.app_state.embedded_app_connected = newAppConnected;
    if (newAppConnected) {
        deps.app_state.webex_status = newWebexStatus;
        deps.app_state.webex_status_received = true;
        deps.app_state.webex_status_source = "embedded_app";
        if (!newDisplayName.isEmpty()) {
            deps.app_state.embedded_app_display_name = newDisplayName;
        }
        if (!deps.app_state.xapi_connected) {
            deps.app_state.camera_on = newCameraOn;
            deps.app_state.mic_muted = newMicMuted;
            deps.app_state.in_call = newInCall;
        }
    }

    deps.app_state.last_supabase_sync = millis();
    Serial.printf("[REALTIME] Pairing status changed (broadcast) - app=%s, status=%s\n",
                  newAppConnected ? "connected" : "disconnected",
                  newWebexStatus.c_str());
}

/**
 * @brief Handle broadcast message events
 * @param payload JSON document containing broadcast payload
 */
void handleBroadcastMessage(JsonDocument& payload) {
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
        handleBroadcastCommand(record);
    } else if (table == "pairings" && operation == "UPDATE") {
        handleBroadcastPairing(record);
    }
}

/**
 * @brief Handle command INSERT event from postgres_changes
 * @param data JSON object containing command data
 */
void handleCommandInsert(const JsonObject& data) {
    auto& deps = getDependencies();
    
    if (data.isNull()) {
        Serial.println("[REALTIME] No record in command payload");
        return;
    }

    // Build SupabaseCommand from realtime data
    SupabaseCommand cmd;
    if (!buildCommandFromJson(data, cmd)) {
        return;
    }

    if (deps.command_processor.wasRecentlyProcessed(cmd.id)) {
        Serial.printf("[REALTIME] Duplicate command ignored: %s\n", cmd.id.c_str());
        return;
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

/**
 * @brief Handle pairing UPDATE event from postgres_changes
 * @param data JSON object containing pairing data
 */
void handlePairingUpdate(const JsonObject& data) {
    auto& deps = getDependencies();
    
    if (data.isNull()) {
        return;
    }

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
    if (newAppConnected != deps.app_state.embedded_app_connected) {
        statusChanged = true;
    }

    // Check webex status change
    if (newWebexStatus != deps.app_state.webex_status) {
        statusChanged = true;
    }

    // Check display name change (only if non-empty)
    if (!newDisplayName.isEmpty() && newDisplayName != deps.app_state.embedded_app_display_name) {
        statusChanged = true;
    }

    // Check camera/mic/call state changes (only if not using xAPI)
    if (!deps.app_state.xapi_connected) {
        if (newCameraOn != deps.app_state.camera_on ||
            newMicMuted != deps.app_state.mic_muted ||
            newInCall != deps.app_state.in_call) {
            statusChanged = true;
        }
    }

    // Only process and log if something actually changed
    if (!statusChanged) {
        deps.app_state.last_supabase_sync = millis();
        // Heartbeat-only update - silently ignore
        if (deps.debug_mode && deps.config.getPairingRealtimeDebug()) {
            Serial.println("[REALTIME] Pairing update ignored (no status change - likely heartbeat)");
        }
        return;
    }

    // Apply the changes to app state
    deps.app_state.supabase_app_connected = newAppConnected;
    deps.app_state.embedded_app_connected = newAppConnected;
    if (newAppConnected) {
        deps.app_state.webex_status = newWebexStatus;
        deps.app_state.webex_status_received = true;
        deps.app_state.webex_status_source = "embedded_app";

        if (!newDisplayName.isEmpty()) {
            deps.app_state.embedded_app_display_name = newDisplayName;
        }

        // Only update camera/mic/call if not using xAPI
        if (!deps.app_state.xapi_connected) {
            deps.app_state.camera_on = newCameraOn;
            deps.app_state.mic_muted = newMicMuted;
            deps.app_state.in_call = newInCall;
        }
    }

    deps.app_state.last_supabase_sync = millis();
    Serial.printf("[REALTIME] Pairing status changed - app=%s, status=%s, camera=%s, mic=%s, inCall=%s\n",
                  newAppConnected ? "connected" : "disconnected",
                  newWebexStatus.c_str(),
                  newCameraOn ? "on" : "off",
                  newMicMuted ? "muted" : "unmuted",
                  newInCall ? "yes" : "no");

    if (deps.debug_mode && deps.config.getPairingRealtimeDebug()) {
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

// =============================================================================
// REALTIME MESSAGE HANDLER
// =============================================================================

void handleRealtimeMessage(const RealtimeMessage& msg) {
    if (!msg.valid) {
        return;
    }

    Serial.printf("[REALTIME] Received %s on %s.%s\n",
                  msg.event.c_str(), msg.schema.c_str(), msg.table.c_str());

    // Handle broadcast events
    if (msg.event == "broadcast") {
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        
        // Check if this is a user channel broadcast by examining the event type in payload
        JsonObject broadcast = payload["payload"];
        if (!broadcast.isNull()) {
            String event = broadcast["event"] | "";
            // User channel events: user_assigned, webex_status, command
            if (event == "user_assigned" || event == "webex_status" || event == "command") {
                handleUserChannelBroadcast(payload);
                return;
            }
        }
        
        // Legacy pairing channel broadcast
        handleBroadcastMessage(payload);
        return;
    }

    // Handle command insertions (immediate command delivery)
    if (msg.table == "commands" && msg.event == "INSERT") {
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        JsonObject data = payload["data"]["record"];
        handleCommandInsert(data);
        return;
    }

    // Handle pairing updates (app connection state changes)
    if (msg.table == "pairings" && msg.event == "UPDATE") {
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        JsonObject data = payload["data"]["record"];
        handlePairingUpdate(data);
        return;
    }

    // Handle device updates (admin debug toggle)
    // Device realtime handler removed - using single connection now
}

// =============================================================================
// USER CHANNEL HANDLERS (UUID-based device identity)
// =============================================================================

/**
 * @brief Handle user_assigned event from user channel
 * @param payload JSON object containing user_assigned event data
 */
void handleUserAssigned(JsonObject& payload) {
    auto& deps = getDependencies();
    
    if (payload.isNull()) {
        Serial.println("[REALTIME] user_assigned event missing payload");
        return;
    }
    
    String newUserUuid = payload["user_uuid"] | "";
    if (newUserUuid.isEmpty()) {
        Serial.println("[REALTIME] user_assigned event missing user_uuid");
        return;
    }
    
    String currentUserUuid = deps.config.getUserUuid();
    if (newUserUuid == currentUserUuid) {
        Serial.printf("[REALTIME] user_assigned event - user_uuid unchanged: %s\n", 
                      newUserUuid.c_str());
        return;
    }
    
    Serial.printf("[REALTIME] User assigned: %s -> %s\n", 
                  currentUserUuid.isEmpty() ? "(none)" : currentUserUuid.c_str(),
                  newUserUuid.c_str());
    
    // Store new user_uuid to NVS
    deps.config.setUserUuid(newUserUuid);
    
    // Disconnect and reconnect to new user channel
    Serial.println("[REALTIME] Reconnecting to new user channel...");
    deps.realtime.disconnect();
    // Reconnection will happen automatically on next loop iteration
    // The realtime manager will call subscribeToUserChannel() when user_uuid is available
}

/**
 * @brief Handle webex_status event from user channel
 * @param payload JSON object containing webex_status event data
 */
void handleWebexStatusUpdate(JsonObject& payload) {
    auto& deps = getDependencies();
    
    if (payload.isNull()) {
        Serial.println("[REALTIME] webex_status event missing payload");
        return;
    }
    
    // Filter by device_uuid - only process if this event is for this device
    String eventDeviceUuid = payload["device_uuid"] | "";
    String currentDeviceUuid = deps.config.getDeviceUuid();
    
    if (eventDeviceUuid.isEmpty()) {
        Serial.println("[REALTIME] webex_status event missing device_uuid");
        return;
    }
    
    if (eventDeviceUuid != currentDeviceUuid) {
        // This event is for a different device - ignore
        if (deps.debug_mode && deps.config.getPairingRealtimeDebug()) {
            Serial.printf("[REALTIME] webex_status event ignored - device_uuid mismatch: %s != %s\n",
                          eventDeviceUuid.c_str(), currentDeviceUuid.c_str());
        }
        return;
    }
    
    // Extract webex status fields
    String webexStatus = payload["webex_status"] | "offline";
    bool inCall = payload["in_call"] | false;
    bool cameraOn = payload["camera_on"] | false;
    bool micMuted = payload["mic_muted"] | false;
    String displayName = payload["display_name"] | "";
    
    // Check if status changed
    bool statusChanged = false;
    if (webexStatus != deps.app_state.webex_status) {
        statusChanged = true;
        Serial.printf("[REALTIME] Webex status changed: %s -> %s\n",
                      deps.app_state.webex_status.c_str(), webexStatus.c_str());
    }
    
    if (inCall != deps.app_state.in_call) {
        statusChanged = true;
        Serial.printf("[REALTIME] In-call status changed: %s -> %s\n",
                      deps.app_state.in_call ? "true" : "false",
                      inCall ? "true" : "false");
    }
    
    if (cameraOn != deps.app_state.camera_on) {
        statusChanged = true;
        Serial.printf("[REALTIME] Camera status changed: %s -> %s\n",
                      deps.app_state.camera_on ? "on" : "off",
                      cameraOn ? "on" : "off");
    }
    
    if (micMuted != deps.app_state.mic_muted) {
        statusChanged = true;
        Serial.printf("[REALTIME] Mic status changed: %s -> %s\n",
                      deps.app_state.mic_muted ? "muted" : "unmuted",
                      micMuted ? "muted" : "unmuted");
    }
    
    if (!displayName.isEmpty() && displayName != deps.app_state.embedded_app_display_name) {
        statusChanged = true;
        Serial.printf("[REALTIME] Display name changed: %s -> %s\n",
                      deps.app_state.embedded_app_display_name.c_str(),
                      displayName.c_str());
    }
    
    if (!statusChanged) {
        // No changes - silently ignore
        return;
    }
    
    // Update app state
    deps.app_state.webex_status = webexStatus;
    deps.app_state.webex_status_received = true;
    deps.app_state.webex_status_source = "realtime_user_channel";
    deps.app_state.in_call = inCall;
    deps.app_state.camera_on = cameraOn;
    deps.app_state.mic_muted = micMuted;
    
    // Save webex_status to NVS for persistence (Phase 3)
    deps.config.setLastWebexStatus(webexStatus);
    
    if (!displayName.isEmpty()) {
        deps.app_state.embedded_app_display_name = displayName;
        // Also save to config for persistence
        deps.config.setDisplayName(displayName);
    }
    
    deps.app_state.last_supabase_sync = millis();
    
    Serial.printf("[REALTIME] Webex status updated: status=%s, in_call=%s, camera=%s, mic=%s, name=%s\n",
                  webexStatus.c_str(),
                  inCall ? "true" : "false",
                  cameraOn ? "on" : "off",
                  micMuted ? "muted" : "unmuted",
                  displayName.isEmpty() ? "(none)" : displayName.c_str());
    
    // Display will be updated automatically by loop handler reading from app_state
}

/**
 * @brief Handle command event from user channel
 * @param payload JSON object containing command event data
 */
void handleUserChannelCommand(JsonObject& payload) {
    auto& deps = getDependencies();
    
    if (payload.isNull()) {
        Serial.println("[REALTIME] command event missing payload");
        return;
    }
    
    // Filter by device_uuid - only process if this command is for this device
    String eventDeviceUuid = payload["device_uuid"] | "";
    String currentDeviceUuid = deps.config.getDeviceUuid();
    
    if (eventDeviceUuid.isEmpty()) {
        Serial.println("[REALTIME] command event missing device_uuid");
        return;
    }
    
    if (eventDeviceUuid != currentDeviceUuid) {
        // This command is for a different device - ignore
        if (deps.debug_mode && deps.config.getPairingRealtimeDebug()) {
            Serial.printf("[REALTIME] command event ignored - device_uuid mismatch: %s != %s\n",
                          eventDeviceUuid.c_str(), currentDeviceUuid.c_str());
        }
        return;
    }
    
    // Extract command data
    JsonObject cmdData = payload["command"];
    if (cmdData.isNull()) {
        Serial.println("[REALTIME] command event missing command data");
        return;
    }
    
    // Build SupabaseCommand from event data
    SupabaseCommand cmd;
    if (!buildCommandFromJson(cmdData, cmd)) {
        Serial.println("[REALTIME] Failed to build command from user channel event");
        return;
    }
    
    if (deps.command_processor.wasRecentlyProcessed(cmd.id)) {
        Serial.printf("[REALTIME] Duplicate command ignored: %s\n", cmd.id.c_str());
        return;
    }
    
    String status = cmdData["status"] | "";
    if (status != "pending") {
        Serial.printf("[REALTIME] Command %s already %s, skipping\n",
                      cmd.id.c_str(), status.c_str());
        return;
    }
    
    Serial.printf("[REALTIME] Processing command via user channel: %s (id=%s)\n",
                  cmd.command.c_str(), cmd.id.c_str());
    
    // Handle the command (same handler as polling)
    handleSupabaseCommand(cmd);
}

/**
 * @brief Handle broadcast message from user channel
 * @param payload JSON document containing broadcast payload
 */
void handleUserChannelBroadcast(JsonDocument& payload) {
    JsonObject broadcast = payload["payload"];
    if (broadcast.isNull()) {
        Serial.println("[REALTIME] User channel broadcast missing payload");
        return;
    }
    
    String event = broadcast["event"] | "";
    JsonObject data = broadcast["data"] | broadcast;
    
    if (data.isNull()) {
        Serial.println("[REALTIME] User channel broadcast missing data");
        return;
    }
    
    Serial.printf("[REALTIME] User channel broadcast event: %s\n", event.c_str());
    
    if (event == "user_assigned") {
        handleUserAssigned(data);
    } else if (event == "webex_status") {
        handleWebexStatusUpdate(data);
    } else if (event == "command") {
        handleUserChannelCommand(data);
    } else {
        Serial.printf("[REALTIME] Unknown user channel event: %s\n", event.c_str());
    }
}
