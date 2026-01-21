/**
 * @file bridge_discovery.h
 * @brief Bridge Discovery Client
 * 
 * Fetches bridge configuration from a central endpoint.
 * This allows the bridge URL to be updated without firmware changes.
 */

#ifndef BRIDGE_DISCOVERY_H
#define BRIDGE_DISCOVERY_H

#include <Arduino.h>

// Discovery endpoint
#define BRIDGE_CONFIG_URL "https://display.5ls.us/api/bridge-config.json"

// How often to refresh config (in milliseconds)
#define BRIDGE_CONFIG_REFRESH_INTERVAL (3600 * 1000)  // 1 hour

/**
 * @brief Bridge configuration from discovery endpoint
 */
struct BridgeConfig {
    String url;              // Primary WebSocket URL (e.g., wss://bridge.5ls.us)
    String fallback_url;     // Fallback URL (e.g., ws://webex-bridge.local:8080)
    bool pairing_enabled;    // Whether pairing mode is available
    bool valid;              // Whether config was successfully loaded
    unsigned long fetched_at; // When config was last fetched
};

/**
 * @brief Bridge Discovery Client
 */
class BridgeDiscovery {
public:
    BridgeDiscovery();
    
    /**
     * @brief Fetch bridge configuration from discovery endpoint
     * @param force Force refresh even if cache is valid
     * @return true if configuration was successfully fetched
     */
    bool fetchConfig(bool force = false);
    
    /**
     * @brief Get current bridge configuration
     * @return Bridge configuration struct
     */
    const BridgeConfig& getConfig() const { return config; }
    
    /**
     * @brief Check if configuration is valid and not expired
     * @return true if config is usable
     */
    bool hasValidConfig() const;
    
    /**
     * @brief Get the preferred bridge URL
     * Uses primary URL if available, falls back to fallback_url
     * @return WebSocket URL string
     */
    String getBridgeUrl() const;
    
    /**
     * @brief Get the fallback bridge URL (local network)
     * @return Fallback WebSocket URL string
     */
    String getFallbackUrl() const;
    
    /**
     * @brief Check if it's time to refresh the config
     * @return true if refresh is needed
     */
    bool needsRefresh() const;

private:
    BridgeConfig config;
    
    /**
     * @brief Parse JSON response into config
     * @param json JSON string from endpoint
     * @return true if parsing succeeded
     */
    bool parseConfig(const String& json);
};

#endif // BRIDGE_DISCOVERY_H
