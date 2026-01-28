/**
 * @file api_wifi.cpp
 * @brief WiFi Scan and Save API Handlers
 */

#include "web_server.h"
#include <ArduinoJson.h>
#include <WiFi.h>

void WebServerManager::handleWifiScan(AsyncWebServerRequest* request) {
    // Avoid scans while connected; scans can disrupt connectivity even in AP+STA mode.
    const bool wifi_connected = (WiFi.status() == WL_CONNECTED) ||
        (app_state && app_state->wifi_connected);
    if (wifi_connected) {
        AsyncWebServerResponse* response = request->beginResponse(
            409,
            "application/json",
            "{\"error\":\"WiFi scan disabled while connected. Disconnect first to scan.\"}"
        );
        addCorsHeaders(response);
        request->send(response);
        return;
    }

    // Check if a scan is already in progress
    int16_t scan_status = WiFi.scanComplete();
    
    if (scan_status == WIFI_SCAN_RUNNING) {
        // Scan already in progress, return 202 Accepted
        AsyncWebServerResponse* response = request->beginResponse(202, "application/json", 
            "{\"status\":\"scanning\",\"message\":\"Scan in progress\"}");
        addCorsHeaders(response);
        request->send(response);
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
        
        String responseStr;
        serializeJson(doc, responseStr);
        AsyncWebServerResponse* response = request->beginResponse(200, "application/json", responseStr);
        addCorsHeaders(response);
        request->send(response);
        return;
    }
    
    // No scan in progress and no results available - start a new async scan
    int16_t result = WiFi.scanNetworks(true, false);  // Async scan, no hidden networks
    
    if (result == WIFI_SCAN_RUNNING) {
        // Scan started successfully
        AsyncWebServerResponse* response = request->beginResponse(202, "application/json", 
            "{\"status\":\"scanning\",\"message\":\"Scan started\"}");
        addCorsHeaders(response);
        request->send(response);
    } else {
        // Scan failed to start
        AsyncWebServerResponse* response = request->beginResponse(500, "application/json", 
            "{\"error\":\"Failed to start WiFi scan\"}");
        addCorsHeaders(response);
        request->send(response);
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

    // Helper to URL-decode form values
    auto urlDecode = [](const String& input) -> String {
        String out;
        out.reserve(input.length());
        for (size_t i = 0; i < input.length(); i++) {
            char c = input[i];
            if (c == '+') {
                out += ' ';
                continue;
            }
            if (c == '%' && i + 2 < input.length()) {
                char hex[3] = { input[i + 1], input[i + 2], 0 };
                out += static_cast<char>(strtol(hex, nullptr, 16));
                i += 2;
                continue;
            }
            out += c;
        }
        return out;
    };

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
        AsyncWebServerResponse* response = request->beginResponse(400, "application/json", "{\"error\":\"Missing ssid\"}");
        addCorsHeaders(response);
        request->send(response);
        return;
    }

    config_manager->setWiFiCredentials(ssid, password);

    AsyncWebServerResponse* response = request->beginResponse(200, "application/json", 
        "{\"success\":true,\"message\":\"WiFi saved. Rebooting...\"}");
    addCorsHeaders(response);
    request->send(response);

    // Schedule reboot with longer delay to allow display DMA to complete
    // This helps prevent display corruption on reboot
    pending_reboot = true;
    pending_reboot_time = millis() + 1000;
    pending_boot_partition = nullptr;
}
