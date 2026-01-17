/**
 * @file mdns_manager.cpp
 * @brief mDNS Service Discovery Manager Implementation
 */

#include "mdns_manager.h"

MDNSManager::MDNSManager()
    : initialized(false), bridge_found(false), bridge_port(0), last_discovery(0) {
}

MDNSManager::~MDNSManager() {
    if (initialized) {
        MDNS.end();
    }
}

bool MDNSManager::begin(const String& hostname) {
    if (!MDNS.begin(hostname.c_str())) {
        Serial.println("[MDNS] Failed to start mDNS!");
        return false;
    }
    
    initialized = true;
    Serial.printf("[MDNS] Started with hostname: %s.local\n", hostname.c_str());
    return true;
}

void MDNSManager::advertiseHTTP(uint16_t port) {
    if (!initialized) return;
    
    MDNS.addService(MDNS_SERVICE_HTTP, MDNS_PROTOCOL_TCP, port);
    Serial.printf("[MDNS] Advertising HTTP service on port %d\n", port);
}

bool MDNSManager::discoverBridge(String& host, uint16_t& port) {
    if (!initialized) return false;
    
    Serial.println("[MDNS] Searching for bridge server...");
    
    int n = MDNS.queryService(MDNS_SERVICE_BRIDGE, MDNS_PROTOCOL_TCP);
    
    if (n == 0) {
        Serial.println("[MDNS] No bridge server found");
        bridge_found = false;
        return false;
    }
    
    // Use the first discovered service
    bridge_host = MDNS.IP(0).toString();
    bridge_port = MDNS.port(0);
    bridge_found = true;
    last_discovery = millis();
    
    host = bridge_host;
    port = bridge_port;
    
    Serial.printf("[MDNS] Found bridge at %s:%d\n", bridge_host.c_str(), bridge_port);
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
