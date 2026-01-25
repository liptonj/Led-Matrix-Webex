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
    : initialized(false), bridge_found(false), bridge_port(0), last_discovery(0), last_refresh(0) {
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
    bridge_found = false;
    bridge_host = "";
    bridge_port = 0;
    current_hostname = "";
}

void MDNSManager::advertiseHTTP(uint16_t port) {
    if (!initialized) return;
    
    MDNS.addService(MDNS_SERVICE_HTTP, MDNS_PROTOCOL_TCP, port);
    Serial.printf("[MDNS] Advertising HTTP service on port %d\n", port);
}

bool MDNSManager::discoverBridge(String& host, uint16_t& port) {
    if (!initialized) {
        Serial.println("[MDNS] Discovery not initialized");
        return false;
    }
    
    Serial.println("[MDNS] Searching for bridge server...");
    Serial.printf("[MDNS] Query: service=%s, protocol=%s\n", 
                  MDNS_SERVICE_BRIDGE, MDNS_PROTOCOL_TCP);
    
    int n = MDNS.queryService(MDNS_SERVICE_BRIDGE, MDNS_PROTOCOL_TCP);
    
    Serial.printf("[MDNS] Query returned %d result(s)\n", n);
    
    if (n == 0) {
        Serial.println("[MDNS] No bridge server found");
        Serial.println("[MDNS] Hint: Check that bridge server is running and advertising mDNS");
        Serial.println("[MDNS] Hint: Try 'dns-sd -B _webex-bridge._tcp' on macOS/Linux to verify");
        bridge_found = false;
        return false;
    }
    
    // Log all discovered services
    for (int i = 0; i < n; i++) {
        Serial.printf("[MDNS] Service %d: %s at %s:%d\n", 
                      i, 
                      MDNS.hostname(i).c_str(),
                      MDNS.IP(i).toString().c_str(), 
                      MDNS.port(i));
    }
    
    // Use the first discovered service
    bridge_host = MDNS.IP(0).toString();
    bridge_port = MDNS.port(0);
    bridge_found = true;
    last_discovery = millis();
    
    host = bridge_host;
    port = bridge_port;
    
    Serial.printf("[MDNS] Selected bridge at %s:%d\n", bridge_host.c_str(), bridge_port);
    return true;
}

void MDNSManager::refreshBridgeDiscovery() {
    // Only refresh every 30 seconds
    if (millis() - last_discovery < 30000) {
        return;
    }
    
    String host;
    uint16_t port;
    discoverBridge(host, port);
}

void MDNSManager::refresh() {
    // ESP32's mDNS implementation handles TTL refreshes automatically.
    // Previously, we tried to restart mDNS every 60s which caused instability.
    // The mDNS responder daemon handles multicast announcements internally.
    // 
    // This function is kept for API compatibility but no longer restarts mDNS.
    // If mDNS becomes unresponsive, the only reliable fix is a device reboot.
    
    if (!initialized) return;
    
    // Just log status periodically for debugging (every 5 minutes)
    if (millis() - last_refresh < 300000) {  // 5 minutes
        return;
    }
    last_refresh = millis();
    
    Serial.printf("[MDNS] Active: %s.local (no refresh needed - handled by ESP-IDF)\n", 
                  current_hostname.c_str());
}
