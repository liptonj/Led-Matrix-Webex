/**
 * @file mdns_manager.cpp
 * @brief mDNS Service Discovery Manager Implementation
 */

#include "mdns_manager.h"

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
        Serial.printf("[MDNS] Sanitized hostname '%s' -> '%s'\n",
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
            Serial.printf("[MDNS] Started with hostname: %s.local\n", sanitized.c_str());
            return true;
        }
        Serial.printf("[MDNS] Start failed (attempt %d/3)\n", attempt);
        delay(300);
    }

    Serial.println("[MDNS] Failed to start mDNS!");
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
    Serial.printf("[MDNS] Advertising HTTP service on port %d\n", port);
}

void MDNSManager::refresh() {
    if (!initialized) return;
    
    unsigned long now = millis();
    
    // Force mDNS restart every 2 minutes to ensure it stays responsive
    // ESP32's mDNS can sometimes become unresponsive without any indication
    if (now - last_refresh >= 120000) {  // 2 minutes
        last_refresh = now;
        
        Serial.printf("[MDNS] Forcing refresh of %s.local\n", current_hostname.c_str());
        
        // Save current state
        String hostname = current_hostname;
        
        // Restart mDNS
        MDNS.end();
        delay(50);  // Brief pause to ensure clean shutdown
        
        if (MDNS.begin(hostname.c_str())) {
            MDNS.addService(MDNS_SERVICE_HTTP, MDNS_PROTOCOL_TCP, 80);
            Serial.println("[MDNS] Refresh successful");
        } else {
            Serial.println("[MDNS] Refresh failed - will retry next cycle");
            initialized = false;
        }
    }
}
