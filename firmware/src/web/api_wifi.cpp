/**
 * @file api_wifi.cpp
 * @brief WiFi Scan and Save API Handlers
 */

#include "web_server.h"
#include "web_helpers.h"
#include "../common/url_utils.h"
#include <ArduinoJson.h>
#include <WiFi.h>

void WebServerManager::handleWifiScan(AsyncWebServerRequest* request) {
    // Avoid scans while connected; scans can disrupt connectivity even in AP+STA mode.
    const bool wifi_connected = (WiFi.status() == WL_CONNECTED) ||
        (app_state && app_state->wifi_connected);
    if (wifi_connected) {
        sendErrorResponse(request, 409, "WiFi scan disabled while connected. Disconnect first to scan.", 
                         [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }

    // Check if a scan is already in progress
    int16_t scan_status = WiFi.scanComplete();
    
    if (scan_status == WIFI_SCAN_RUNNING) {
        // Scan already in progress, return 202 Accepted
        sendJsonResponse(request, 202, "{\"status\":\"scanning\",\"message\":\"Scan in progress\"}",
                        [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }
    
    if (scan_status == WIFI_SCAN_FAILED) {
        // Previous scan failed, clean up
        WiFi.scanDelete();
        scan_status = -1;
    }
    
    // If scan results are available (scan_status >= 0), return them
    if (scan_status >= 0) {
        JsonDocument doc;
        JsonArray networks = doc["networks"].to<JsonArray>();
        
        for (int i = 0; i < scan_status; i++) {
            JsonObject network = networks.add<JsonObject>();
            network["ssid"] = WiFi.SSID(i);
            network["rssi"] = WiFi.RSSI(i);
            network["encrypted"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
        }
        
        // Clean up scan results after sending
        WiFi.scanDelete();
        
        sendJsonResponse(request, 200, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }
    
    // No scan in progress and no results available - start a new async scan
    int16_t result = WiFi.scanNetworks(true, false);  // Async scan, no hidden networks
    
    if (result == WIFI_SCAN_RUNNING) {
        // Scan started successfully
        sendJsonResponse(request, 202, "{\"status\":\"scanning\",\"message\":\"Scan started\"}",
                        [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
    } else {
        // Scan failed to start
        sendErrorResponse(request, 500, "Failed to start WiFi scan",
                         [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
    }
}

void WebServerManager::handleWifiSave(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    String ssid;
    String password;
    
    // CRITICAL: Clean up any pending async WiFi scan before saving and rebooting
    // This prevents scan interference during reboot
    int16_t scan_status = WiFi.scanComplete();
    if (scan_status == WIFI_SCAN_RUNNING) {
        Serial.println("[WEB] Cleaning up pending WiFi scan before reboot...");
        WiFi.scanDelete();
    }

    // Note: urlDecode() helper function now from common/url_utils.h

    // Prefer JSON body if provided
    if (len > 0) {
        String body;
        body.reserve(len);
        for (size_t i = 0; i < len; i++) {
            body += static_cast<char>(data[i]);
        }

        JsonDocument doc;
        if (deserializeJson(doc, body) == DeserializationError::Ok) {
            ssid = doc["ssid"] | "";
            password = doc["password"] | "";
        } else {
            // Fallback for x-www-form-urlencoded / multipart body
            int ssid_pos = body.indexOf("ssid=");
            if (ssid_pos >= 0) {
                int amp = body.indexOf('&', ssid_pos);
                String raw = (amp >= 0) ? body.substring(ssid_pos + 5, amp) : body.substring(ssid_pos + 5);
                ssid = urlDecode(raw);
            }
            int pass_pos = body.indexOf("password=");
            if (pass_pos >= 0) {
                int amp = body.indexOf('&', pass_pos);
                String raw = (amp >= 0) ? body.substring(pass_pos + 9, amp) : body.substring(pass_pos + 9);
                password = urlDecode(raw);
            }
        }
    }

    // Fallback to form params (some clients send multipart params)
    if (ssid.isEmpty() && request->hasParam("ssid", true)) {
        ssid = request->getParam("ssid", true)->value();
    }
    if (password.isEmpty() && request->hasParam("password", true)) {
        password = request->getParam("password", true)->value();
    }

    if (ssid.isEmpty()) {
        sendErrorResponse(request, 400, "Missing ssid", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
        return;
    }

    config_manager->setWiFiCredentials(ssid, password);

    sendSuccessResponse(request, "WiFi saved. Rebooting...", [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });

    // Schedule reboot with longer delay to allow display DMA to complete
    // This helps prevent display corruption on reboot
    pending_reboot = true;
    pending_reboot_time = millis() + 1000;
    pending_boot_partition = nullptr;
}
