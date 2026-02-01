/**
 * @file webex_client.h
 * @brief Webex People API Client Header
 */

#ifndef WEBEX_CLIENT_H
#define WEBEX_CLIENT_H

#include <Arduino.h>
#include "../config/config_manager.h"
#include "oauth_handler.h"

// Webex API endpoints
#define WEBEX_API_BASE "https://webexapis.com/v1"
#define WEBEX_PEOPLE_ME "/people/me"

/**
 * @brief Webex Presence Information
 */
struct WebexPresence {
    String status;           // active, call, DoNotDisturb, inactive, meeting,
                             // OutOfOffice, pending, presenting, unknown
    String display_name;
    String first_name;       // User's first name for auto-population
    String email;
    String last_activity;
    bool valid;
};

/**
 * @brief Webex People API Client Class
 */
class WebexClient {
public:
    WebexClient();
    ~WebexClient();
    
    /**
     * @brief Initialize the Webex client
     * @param config Pointer to configuration manager
     */
    void begin(ConfigManager* config);
    
    /**
     * @brief Refresh access token if needed
     * @return true if token is valid
     */
    bool refreshToken();
    
    /**
     * @brief Get current user's presence information
     * @param presence Output: Presence information
     * @return true on success
     */
    bool getPresence(WebexPresence& presence);
    
    /**
     * @brief Check if client is authenticated
     * @return true if authenticated
     */
    bool isAuthenticated() const;
    
    /**
     * @brief Handle OAuth callback code
     * @param code Authorization code
     * @param redirect_uri Redirect URI used
     * @return true on success
     */
    bool handleOAuthCallback(const String& code, const String& redirect_uri);
    
    /**
     * @brief Get OAuth handler for direct access
     * @return Pointer to OAuth handler
     */
    OAuthHandler* getOAuthHandler() { return &oauth_handler; }

private:
    ConfigManager* config_manager;
    OAuthHandler oauth_handler;
    unsigned long last_request_time;
    int rate_limit_backoff;
    
    String makeApiRequest(const String& endpoint, bool is_retry = false);
    void handleRateLimit(int httpCode);
};

#endif // WEBEX_CLIENT_H
