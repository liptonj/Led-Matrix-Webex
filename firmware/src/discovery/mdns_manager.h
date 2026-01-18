/**
 * @file mdns_manager.h
 * @brief mDNS Service Discovery Manager Header
 */

#ifndef MDNS_MANAGER_H
#define MDNS_MANAGER_H

#include <Arduino.h>
#include <ESPmDNS.h>

// Service types
#define MDNS_SERVICE_HTTP "_http"
#define MDNS_SERVICE_BRIDGE "_webex-bridge"
#define MDNS_PROTOCOL_TCP "_tcp"

/**
 * @brief mDNS Manager Class
 * 
 * Handles mDNS service advertisement and discovery.
 */
class MDNSManager {
public:
    MDNSManager();
    ~MDNSManager();
    
    /**
     * @brief Initialize mDNS
     * @param hostname Device hostname (e.g., "webex-display")
     * @return true on success
     */
    bool begin(const String& hostname);
    
    /**
     * @brief Advertise HTTP service
     * @param port HTTP port number
     */
    void advertiseHTTP(uint16_t port);
    
    /**
     * @brief Discover bridge server on the network
     * @param host Output: Bridge host address
     * @param port Output: Bridge port
     * @return true if bridge found
     */
    bool discoverBridge(String& host, uint16_t& port);
    
    /**
     * @brief Check if a bridge server has been discovered
     * @return true if bridge is available
     */
    bool hasBridge() const { return bridge_found; }
    
    /**
     * @brief Get discovered bridge host
     * @return Bridge host address
     */
    String getBridgeHost() const { return bridge_host; }
    
    /**
     * @brief Get discovered bridge port
     * @return Bridge port number
     */
    uint16_t getBridgePort() const { return bridge_port; }
    
    /**
     * @brief Refresh bridge discovery
     */
    void refreshBridgeDiscovery();
    
    /**
     * @brief Get the mDNS hostname
     * @return Hostname (without .local)
     */
    String getHostname() const { return current_hostname; }

private:
    bool initialized;
    bool bridge_found;
    String bridge_host;
    uint16_t bridge_port;
    unsigned long last_discovery;
    String current_hostname;
};

#endif // MDNS_MANAGER_H
