/**
 * @file api_system.cpp
 * @brief System Operations API Handlers
 * 
 * Handles system operation endpoints:
 * - POST /api/reboot - Reboots the device
 * - POST /api/factory-reset - Factory reset (disabled via web API)
 * - POST /api/pairing/regenerate - Regenerates pairing code
 */

#include "web_server.h"
#include "web_helpers.h"
#include "../common/pairing_manager.h"
#include "../supabase/supabase_client.h"
#include "../core/dependencies.h"
#include <ArduinoJson.h>

void WebServerManager::handleReboot(AsyncWebServerRequest* request) {
    sendSuccessResponse(request, "Rebooting...", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
    // Schedule reboot for 500ms from now to allow response to be sent
    pending_reboot = true;
    pending_reboot_time = millis() + 500;
    pending_boot_partition = nullptr;
    Serial.println("[WEB] Reboot scheduled");
}

void WebServerManager::handleFactoryReset(AsyncWebServerRequest* request) {
    // Factory reset is disabled for web API - must be done locally via serial console
    // This prevents accidentally breaking the connection to Supabase
    Serial.println("[WEB] Factory reset rejected - must be performed locally via serial");
    sendErrorResponse(request, 403, "Factory reset must be performed locally via serial console",
                      [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}

void WebServerManager::handleRegeneratePairingCode(AsyncWebServerRequest* request) {
    auto& deps = getDependencies();
    String newCode = deps.pairing.generateCode(true);
    deps.supabase.setPairingCode(newCode);
    app_state->supabase_realtime_resubscribe = true;
    Serial.println("[WEB] New pairing code generated");

    JsonDocument doc;
    doc["success"] = true;
    doc["code"] = newCode;

    sendJsonResponse(request, 200, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
}
