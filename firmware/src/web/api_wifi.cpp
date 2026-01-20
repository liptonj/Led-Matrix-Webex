/**
 * @file api_wifi.cpp
 * @brief WiFi Scan and Save API Handlers
 */

#include "web_server.h"
#include <ArduinoJson.h>
#include <WiFi.h>

void WebServerManager::handleWifiScan(AsyncWebServerRequest* request) {
    int n = WiFi.scanNetworks();

    JsonDocument doc;
    JsonArray networks = doc["networks"].to<JsonArray>();

    for (int i = 0; i < n; i++) {
        JsonObject network = networks.add<JsonObject>();
        network["ssid"] = WiFi.SSID(i);
        network["rssi"] = WiFi.RSSI(i);
        network["encrypted"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    }

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleWifiSave(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    String ssid;
    String password;

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
        request->send(400, "application/json", "{\"error\":\"Missing ssid\"}");
        return;
    }

    config_manager->setWiFiCredentials(ssid, password);

    request->send(200, "application/json", "{\"success\":true,\"message\":\"WiFi saved. Rebooting...\"}");

    // Schedule reboot
    pending_reboot = true;
    pending_reboot_time = millis() + 500;
    pending_boot_partition = nullptr;
}
