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
#include "../debug/log_system.h"
#include "../sync/sync_manager.h"
#include <ArduinoJson.h>

static const char* TAG = "RT_HANDLER";

// Forward declarations
void handleSupabaseCommand(const SupabaseCommand& cmd);
void handleUserChannelBroadcast(JsonDocument& payload);

/**
 * @brief Validate command ID
 * @param cmdId Command ID to validate
 * @return true if valid, false otherwise
 */
bool validateCommandId(const String& cmdId) {
    String trimmed = cmdId;
    trimmed.trim();
    if (trimmed.isEmpty() || trimmed.length() < 8) {
        ESP_LOGW(TAG, "Command has invalid ID: '%s'", trimmed.c_str());
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
        ESP_LOGW(TAG, "Command %s has empty command name", cmdId.c_str());
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
        ESP_LOGW(TAG, "Broadcast command missing record");
        return;
    }

    SupabaseCommand cmd;
    if (!buildCommandFromJson(record, cmd)) {
        return;
    }

    if (deps.command_processor.wasRecentlyProcessed(cmd.id)) {
        ESP_LOGD(TAG, "Duplicate command ignored: %s", cmd.id.c_str());
        return;
    }

    String status = record["status"].as<String>();
    if (status != "pending") {
        ESP_LOGD(TAG, "Command %s already %s, skipping",
                 cmd.id.c_str(), status.c_str());
        return;
    }

    ESP_LOGI(TAG, "Processing command via broadcast: %s (id=%s)", cmd.command.c_str(), cmd.id.c_str());
    handleSupabaseCommand(cmd);
}

/**
 * @brief Handle broadcast pairing update event
 * @param record JSON object containing pairing data
 */
void handleBroadcastPairing(const JsonObject& record) {
    auto& deps = getDependencies();
    
    if (record.isNull()) {
        ESP_LOGW(TAG, "Broadcast pairing missing record");
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
        strcmp(newWebexStatus.c_str(), deps.app_state.webex_status) != 0 ||
        (!newDisplayName.isEmpty() && strcmp(newDisplayName.c_str(), deps.app_state.embedded_app_display_name) != 0)) {
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
        if (deps.config.getPairingRealtimeDebug()) {
            ESP_LOGD(TAG, "Broadcast pairing update ignored (no status change)");
        }
        return;
    }

    // Apply changes
    deps.app_state.supabase_app_connected = newAppConnected;
    deps.app_state.embedded_app_connected = newAppConnected;
    if (newAppConnected) {
        safeStrCopy(deps.app_state.webex_status, sizeof(deps.app_state.webex_status), newWebexStatus);
        deps.app_state.webex_status_received = true;
        safeStrCopyLiteral(deps.app_state.webex_status_source, sizeof(deps.app_state.webex_status_source), "embedded_app");
        if (!newDisplayName.isEmpty()) {
            safeStrCopy(deps.app_state.embedded_app_display_name, sizeof(deps.app_state.embedded_app_display_name), newDisplayName);
        }
        if (!deps.app_state.xapi_connected) {
            deps.app_state.camera_on = newCameraOn;
            deps.app_state.mic_muted = newMicMuted;
            deps.app_state.in_call = newInCall;
        }
    }

    deps.app_state.last_supabase_sync = millis();
    ESP_LOGI(TAG, "Pairing status changed (broadcast) - app=%s, status=%s",
             newAppConnected ? "connected" : "disconnected",
             newWebexStatus.c_str());
}

#if 0
/**
 * @brief Handle broadcast message events (LEGACY - DEAD CODE)
 * @param payload JSON document containing broadcast payload
 * 
 * LEGACY: This function handled broadcast messages for the old pairing-based
 * channel subscription. Since we switched to user-based channels, this handler
 * is unreachable. User channels use handleUserChannelBroadcast() instead.
 * 
 * This code is kept for reference but is never executed.
 */
void handleBroadcastMessage(JsonDocument& payload) {
    JsonObject broadcast = payload["payload"];
    if (broadcast.isNull()) {
        ESP_LOGW(TAG, "Broadcast payload missing");
        return;
    }

    String broadcastEvent = broadcast["event"] | "";
    JsonVariant inner = broadcast["payload"];
    JsonObject data = inner.is<JsonObject>() ? inner.as<JsonObject>() : broadcast;

    if (data.isNull()) {
        ESP_LOGW(TAG, "Broadcast data missing");
        return;
    }

    String table = data["table"] | "";
    String operation = data["operation"] | "";
    JsonObject record = data["record"];

    ESP_LOGD(TAG, "Broadcast %s table=%s op=%s",
             broadcastEvent.c_str(),
             table.c_str(),
             operation.c_str());

    if (table == "commands" && operation == "INSERT") {
        handleBroadcastCommand(record);
    } else if (table == "pairings" && operation == "UPDATE") {
        handleBroadcastPairing(record);
    }
}
#endif

/**
 * @brief Handle command INSERT event from postgres_changes
 * @param data JSON object containing command data
 */
void handleCommandInsert(const JsonObject& data) {
    auto& deps = getDependencies();
    
    if (data.isNull()) {
        ESP_LOGW(TAG, "No record in command payload");
        return;
    }

    // Build SupabaseCommand from realtime data
    SupabaseCommand cmd;
    if (!buildCommandFromJson(data, cmd)) {
        return;
    }

    if (deps.command_processor.wasRecentlyProcessed(cmd.id)) {
        ESP_LOGD(TAG, "Duplicate command ignored: %s", cmd.id.c_str());
        return;
    }

    // Verify this command is pending (not already processed via polling)
    String status = data["status"].as<String>();
    if (status != "pending") {
        ESP_LOGD(TAG, "Command %s already %s, skipping",
                 cmd.id.c_str(), status.c_str());
        return;
    }

    ESP_LOGI(TAG, "Processing command via realtime: %s (id=%s)", cmd.command.c_str(), cmd.id.c_str());

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
    if (strcmp(newWebexStatus.c_str(), deps.app_state.webex_status) != 0) {
        statusChanged = true;
    }

    // Check display name change (only if non-empty)
    if (!newDisplayName.isEmpty() && strcmp(newDisplayName.c_str(), deps.app_state.embedded_app_display_name) != 0) {
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
        if (deps.config.getPairingRealtimeDebug()) {
            ESP_LOGD(TAG, "Pairing update ignored (no status change - likely heartbeat)");
        }
        return;
    }

    // Apply the changes to app state
    deps.app_state.supabase_app_connected = newAppConnected;
    deps.app_state.embedded_app_connected = newAppConnected;
    if (newAppConnected) {
        safeStrCopy(deps.app_state.webex_status, sizeof(deps.app_state.webex_status), newWebexStatus);
        deps.app_state.webex_status_received = true;
        safeStrCopyLiteral(deps.app_state.webex_status_source, sizeof(deps.app_state.webex_status_source), "embedded_app");

        if (!newDisplayName.isEmpty()) {
            safeStrCopy(deps.app_state.embedded_app_display_name, sizeof(deps.app_state.embedded_app_display_name), newDisplayName);
        }

        // Only update camera/mic/call if not using xAPI
        if (!deps.app_state.xapi_connected) {
            deps.app_state.camera_on = newCameraOn;
            deps.app_state.mic_muted = newMicMuted;
            deps.app_state.in_call = newInCall;
        }
    }

    deps.app_state.last_supabase_sync = millis();
    ESP_LOGI(TAG, "Pairing status changed - app=%s, status=%s, camera=%s, mic=%s, inCall=%s",
             newAppConnected ? "connected" : "disconnected",
             newWebexStatus.c_str(),
             newCameraOn ? "on" : "off",
             newMicMuted ? "muted" : "unmuted",
             newInCall ? "yes" : "no");

    if (deps.config.getPairingRealtimeDebug()) {
        JsonDocument debugDoc;
        debugDoc["app_connected"] = newAppConnected;
        debugDoc["webex_status"] = newWebexStatus;
        debugDoc["display_name"] = newDisplayName;
        debugDoc["camera_on"] = newCameraOn;
        debugDoc["mic_muted"] = newMicMuted;
        debugDoc["in_call"] = newInCall;
        String debugJson;
        serializeJson(debugDoc, debugJson);
        ESP_LOGD(TAG, "[DEBUG] Pairing payload: %s", debugJson.c_str());
    }
}

// =============================================================================
// REALTIME MESSAGE HANDLER
// =============================================================================

void handleRealtimeMessage(const RealtimeMessage& msg) {
    if (!msg.valid) {
        return;
    }

    ESP_LOGD(TAG, "Received %s on %s.%s", msg.event.c_str(), msg.schema.c_str(), msg.table.c_str());

    // Handle broadcast events
    if (msg.event == "broadcast") {
        JsonDocument& payload = const_cast<JsonDocument&>(msg.payload);
        
        // Check if this is a user channel broadcast by examining the event type in payload
        String broadcastEvent = payload["event"] | "";  // TOP level, not nested
        // User channel events: user_assigned, webex_status, command, request_config
        if (broadcastEvent == "user_assigned" || broadcastEvent == "webex_status" || broadcastEvent == "command" || broadcastEvent == "request_config") {
            handleUserChannelBroadcast(payload);
            return;
        }
        
        // Legacy pairing channel broadcast (DEAD CODE - no longer subscribed to pairing channels)
        // handleBroadcastMessage(payload);  // Removed - unreachable code path
        ESP_LOGW(TAG, "Unknown broadcast event: %s", broadcastEvent.c_str());
        return;
    }

#if 0
    // DEAD CODE: postgres_changes handlers for user channels
    // These handlers were for postgres_changes events on user channels, but user channels
    // only use broadcast events now (user_assigned, webex_status, command). These handlers
    // are unreachable because subscribeToUserChannel() subscribes with includePostgresChanges=false.
    //
    // User channels handle commands via handleUserChannelCommand() (broadcast event)
    // User channels handle status via handleWebexStatusUpdate() (broadcast event)
    
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
#endif

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
        ESP_LOGW(TAG, "user_assigned event missing payload");
        return;
    }
    
    String newUserUuid = payload["user_uuid"] | "";
    if (newUserUuid.isEmpty()) {
        ESP_LOGW(TAG, "user_assigned event missing user_uuid");
        return;
    }
    
    String currentUserUuid = deps.config.getUserUuid();
    if (newUserUuid == currentUserUuid) {
        ESP_LOGD(TAG, "user_assigned event - user_uuid unchanged: %s", 
                 newUserUuid.c_str());
        return;
    }
    
    ESP_LOGI(TAG, "User assigned: %s -> %s",
             currentUserUuid.isEmpty() ? "(none)" : currentUserUuid.c_str(),
             newUserUuid.c_str());
    
    // Store new user_uuid to NVS
    deps.config.setUserUuid(newUserUuid);
    
    // Disconnect and reconnect to new user channel
    ESP_LOGI(TAG, "Reconnecting to new user channel");
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
        ESP_LOGW(TAG, "webex_status event missing payload");
        return;
    }
    
    // Always log incoming payload for debugging
    String payloadStr;
    serializeJson(payload, payloadStr);
    ESP_LOGD(TAG, "webex_status payload: %s", payloadStr.c_str());
    
    // webex_status is USER-SCOPED - all devices on this user channel should update.
    // No device_uuid filtering here. The device dropdown in the embedded app
    // is only for device-specific settings, not for status broadcasts.
    
    // Extract webex status fields
    String webexStatus = payload["webex_status"] | "offline";
    bool inCall = payload["in_call"] | false;
    bool cameraOn = payload["camera_on"] | false;
    bool micMuted = payload["mic_muted"] | false;
    String displayName = payload["display_name"] | "";
    
    // Check if status changed
    bool statusChanged = false;
    if (strcmp(webexStatus.c_str(), deps.app_state.webex_status) != 0) {
        statusChanged = true;
        ESP_LOGI(TAG, "Webex status changed: %s -> %s",
                 deps.app_state.webex_status, webexStatus.c_str());
    }
    
    if (inCall != deps.app_state.in_call) {
        statusChanged = true;
        ESP_LOGI(TAG, "In-call status changed: %s -> %s",
                 deps.app_state.in_call ? "true" : "false",
                 inCall ? "true" : "false");
    }
    
    if (cameraOn != deps.app_state.camera_on) {
        statusChanged = true;
        ESP_LOGI(TAG, "Camera status changed: %s -> %s",
                 deps.app_state.camera_on ? "on" : "off",
                 cameraOn ? "on" : "off");
    }
    
    if (micMuted != deps.app_state.mic_muted) {
        statusChanged = true;
        ESP_LOGI(TAG, "Mic status changed: %s -> %s",
                 deps.app_state.mic_muted ? "muted" : "unmuted",
                 micMuted ? "muted" : "unmuted");
    }
    
    if (!displayName.isEmpty() && strcmp(displayName.c_str(), deps.app_state.embedded_app_display_name) != 0) {
        statusChanged = true;
        ESP_LOGI(TAG, "Display name changed: %s -> %s",
                 deps.app_state.embedded_app_display_name,
                 displayName.c_str());
    }
    
    if (!statusChanged) {
        // No changes - silently ignore
        return;
    }
    
    // Update app state
    safeStrCopy(deps.app_state.webex_status, sizeof(deps.app_state.webex_status), webexStatus);
    deps.app_state.webex_status_received = true;
    safeStrCopyLiteral(deps.app_state.webex_status_source, sizeof(deps.app_state.webex_status_source), "realtime_user_channel");
    deps.app_state.in_call = inCall;
    deps.app_state.camera_on = cameraOn;
    deps.app_state.mic_muted = micMuted;
    
    // Save webex_status to NVS for persistence (Phase 3)
    deps.config.setLastWebexStatus(webexStatus);
    
    if (!displayName.isEmpty()) {
        safeStrCopy(deps.app_state.embedded_app_display_name, sizeof(deps.app_state.embedded_app_display_name), displayName);
        // Also save to config for persistence
        deps.config.setDisplayName(displayName);
    }
    
    deps.app_state.last_supabase_sync = millis();
    
    ESP_LOGI(TAG, "Webex status updated: status=%s, in_call=%s, camera=%s, mic=%s, name=%s",
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
        ESP_LOGW(TAG, "command event missing payload");
        return;
    }
    
    // Always log incoming command payload for debugging
    String payloadStr;
    serializeJson(payload, payloadStr);
    ESP_LOGD(TAG, "command payload: %s", payloadStr.c_str());
    
    // Filter by device_uuid - commands ARE device-specific (unlike webex_status)
    String eventDeviceUuid = payload["device_uuid"] | "";
    String currentDeviceUuid = deps.config.getDeviceUuid();
    
    ESP_LOGD(TAG, "command device filter: event=%s, this_device=%s",
             eventDeviceUuid.isEmpty() ? "(empty)" : eventDeviceUuid.c_str(),
             currentDeviceUuid.isEmpty() ? "(empty)" : currentDeviceUuid.c_str());
    
    if (eventDeviceUuid.isEmpty()) {
        ESP_LOGW(TAG, "command event missing device_uuid");
        return;
    }
    
    if (eventDeviceUuid != currentDeviceUuid) {
        ESP_LOGD(TAG, "command IGNORED - device_uuid mismatch: %s != %s",
                 eventDeviceUuid.c_str(), currentDeviceUuid.c_str());
        return;
    }
    
    // Extract command data
    JsonObject cmdData = payload["command"];
    if (cmdData.isNull()) {
        ESP_LOGW(TAG, "command event missing command data");
        return;
    }
    
    // Build SupabaseCommand from event data
    SupabaseCommand cmd;
    if (!buildCommandFromJson(cmdData, cmd)) {
        ESP_LOGW(TAG, "Failed to build command from user channel event");
        return;
    }
    
    if (deps.command_processor.wasRecentlyProcessed(cmd.id)) {
        ESP_LOGD(TAG, "Duplicate command ignored: %s", cmd.id.c_str());
        return;
    }
    
    String status = cmdData["status"] | "";
    if (status != "pending") {
        ESP_LOGD(TAG, "Command %s already %s, skipping",
                 cmd.id.c_str(), status.c_str());
        return;
    }
    
    ESP_LOGI(TAG, "Processing command via user channel: %s (id=%s)", cmd.command.c_str(), cmd.id.c_str());
    
    // Handle the command (same handler as polling)
    handleSupabaseCommand(cmd);
}

/**
 * @brief Handle request_config event from user channel
 * @param payload JSON object containing request_config event data
 */
void handleRequestConfig(JsonObject& payload) {
    auto& deps = getDependencies();
    
    // Filter by device_uuid - only respond if this device is targeted
    String eventDeviceUuid = payload["device_uuid"] | "";
    String currentDeviceUuid = deps.config.getDeviceUuid();
    
    if (eventDeviceUuid.isEmpty()) {
        ESP_LOGD(TAG, "request_config missing device_uuid - broadcasting anyway");
    } else if (eventDeviceUuid != currentDeviceUuid) {
        // Not for this device
        return;
    }
    
    ESP_LOGI(TAG, "Config requested via realtime");
    syncManager.broadcastDeviceConfig();
}

/**
 * @brief Handle broadcast message from user channel
 * @param payload JSON document containing broadcast payload
 */
void handleUserChannelBroadcast(JsonDocument& payload) {
    String event = payload["event"] | "";  // TOP level
    JsonVariant inner = payload["payload"];
    JsonObject data = inner.is<JsonObject>() ? inner.as<JsonObject>() : payload.as<JsonObject>();
    
    if (data.isNull()) {
        ESP_LOGW(TAG, "User channel broadcast missing data");
        return;
    }
    
    ESP_LOGI(TAG, "User channel event: %s (has nested payload: %s)", 
             event.c_str(), inner.is<JsonObject>() ? "yes" : "no");
    
    if (event == "user_assigned") {
        handleUserAssigned(data);
    } else if (event == "webex_status") {
        handleWebexStatusUpdate(data);
    } else if (event == "command") {
        handleUserChannelCommand(data);
    } else if (event == "request_config") {
        handleRequestConfig(data);
    } else {
        ESP_LOGW(TAG, "Unknown event: %s", event.c_str());
    }
}
