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
#define MDNS_PROTOCOL_TCP "_tcp"

// Refresh interval (60 seconds - well before 120s TTL expiry)
#define MDNS_REFRESH_INTERVAL_MS 60000

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
     * @brief Stop mDNS and clear state
     */
    void end();
    
    /**
     * @brief Advertise HTTP service
     * @param port HTTP port number
     */
    void advertiseHTTP(uint16_t port);
    
    /**
     * @brief Refresh mDNS by forcing periodic restart
     * 
     * ESP32's mDNS can become unresponsive without indication.
     * This method forces a full restart every 2 minutes to ensure
     * the device stays discoverable on the network.
     */
    void refresh();
    
    /**
     * @brief Get the mDNS hostname
     * @return Hostname (without .local)
     */
    String getHostname() const { return current_hostname; }

    /**
     * @brief Check if mDNS has been initialized
     * @return true if MDNS.begin() succeeded
     */
    bool isInitialized() const { return initialized; }

private:
    bool initialized;
    unsigned long last_refresh;
    String current_hostname;
};

#endif // MDNS_MANAGER_H
