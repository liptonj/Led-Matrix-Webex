/**
 * @file mdns_manager.cpp
 * @brief mDNS Service Discovery Manager Implementation
 */

#include "mdns_manager.h"
#include "../debug/log_system.h"

static const char* TAG = "MDNS";

namespace {
String sanitizeHostname(const String& input) {
    String sanitized = input;
    sanitized.trim();
    sanitized.toLowerCase();

    String output;
    output.reserve(sanitized.length());
    char prev = '\0';

    for (size_t i = 0; i < sanitized.length(); i++) {
        char c = sanitized.charAt(i);
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
            output += c;
            prev = c;
            continue;
        }
        if (c == '-' || c == '_' || c == ' ') {
            if (prev != '-') {
                output += '-';
                prev = '-';
            }
        }
    }

    while (output.endsWith("-")) {
        output.remove(output.length() - 1);
    }

    if (output.isEmpty()) {
        output = "webex-display";
    }

    return output;
}
}  // namespace

MDNSManager::MDNSManager()
    : initialized(false), last_refresh(0) {
}

MDNSManager::~MDNSManager() {
    if (initialized) {
        MDNS.end();
    }
}

bool MDNSManager::begin(const String& hostname) {
    const String sanitized = sanitizeHostname(hostname);
    if (sanitized != hostname) {
        ESP_LOGI(TAG, "Sanitized hostname '%s' -> '%s'",
                      hostname.c_str(), sanitized.c_str());
    }

    if (initialized) {
        end();
    }

    for (int attempt = 1; attempt <= 3; attempt++) {
        if (MDNS.begin(sanitized.c_str())) {
            initialized = true;
            current_hostname = sanitized;
            last_refresh = millis();
            ESP_LOGI(TAG, "Started with hostname: %s.local", sanitized.c_str());
            return true;
        }
        ESP_LOGW(TAG, "Start failed (attempt %d/3)", attempt);
        delay(300);
    }

    ESP_LOGE(TAG, "Failed to start mDNS!");
    return false;
}

void MDNSManager::end() {
    if (initialized) {
        MDNS.end();
    }
    initialized = false;
    current_hostname = "";
}

void MDNSManager::advertiseHTTP(uint16_t port) {
    if (!initialized) return;
    
    MDNS.addService(MDNS_SERVICE_HTTP, MDNS_PROTOCOL_TCP, port);
    ESP_LOGI(TAG, "Advertising HTTP service on port %d", port);
}

void MDNSManager::refresh() {
    if (!initialized) return;
    
    unsigned long now = millis();
    
    // Force mDNS restart every 2 minutes to ensure it stays responsive
    // ESP32's mDNS can sometimes become unresponsive without any indication
    if (now - last_refresh >= 120000) {  // 2 minutes
        last_refresh = now;
        
        ESP_LOGI(TAG, "Forcing refresh of %s.local", current_hostname.c_str());
        
        // Save current state
        String hostname = current_hostname;
        
        // Restart mDNS
        MDNS.end();
        delay(50);  // Brief pause to ensure clean shutdown
        
        if (MDNS.begin(hostname.c_str())) {
            MDNS.addService(MDNS_SERVICE_HTTP, MDNS_PROTOCOL_TCP, 80);
            ESP_LOGI(TAG, "Refresh successful");
        } else {
            ESP_LOGW(TAG, "Refresh failed - will retry next cycle");
            initialized = false;
        }
    }
}
