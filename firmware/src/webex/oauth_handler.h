/**
 * @file oauth_handler.h
 * @brief Webex OAuth2 Handler Header
 */

#ifndef OAUTH_HANDLER_H
#define OAUTH_HANDLER_H

#include <Arduino.h>
#include "../config/config_manager.h"

// Webex OAuth endpoints
#define WEBEX_AUTH_URL "https://webexapis.com/v1/authorize"
#define WEBEX_TOKEN_URL "https://webexapis.com/v1/access_token"

// OAuth scopes
#define WEBEX_SCOPE_PEOPLE "spark:people_read"
#define WEBEX_SCOPE_XAPI "spark:xapi_statuses"

/**
 * @brief OAuth2 Token Response
 */
struct OAuthTokens {
    String access_token;
    String refresh_token;
    unsigned long expires_at;
    bool valid;
};

/**
 * @brief Webex OAuth2 Handler Class
 */
class OAuthHandler {
public:
    OAuthHandler();
    ~OAuthHandler();
    
    /**
     * @brief Initialize the OAuth handler
     * @param config Pointer to configuration manager
     */
    void begin(ConfigManager* config);
    
    /**
     * @brief Build the authorization URL for user consent
     * @param redirect_uri Callback URL
     * @return Authorization URL
     */
    String buildAuthUrl(const String& redirect_uri);
    
    /**
     * @brief Validate OAuth state parameter (CSRF protection)
     * @param state State parameter from callback
     * @return true if state is valid
     */
    bool validateState(const String& state) const;
    
    /**
     * @brief Exchange authorization code for tokens
     * @param code Authorization code from callback
     * @param redirect_uri Callback URL used in authorization
     * @return true on success
     */
    bool exchangeCode(const String& code, const String& redirect_uri);
    
    /**
     * @brief Refresh the access token using refresh token
     * @return true on success
     */
    bool refreshAccessToken();
    
    /**
     * @brief Get the current access token
     * @return Access token string
     */
    String getAccessToken() const;
    
    /**
     * @brief Check if we have valid tokens
     * @return true if tokens are valid
     */
    bool hasValidTokens() const;
    
    /**
     * @brief Check if access token needs refresh
     * @return true if token is expired or expiring soon
     */
    bool needsRefresh() const;
    
    /**
     * @brief Clear all tokens
     */
    void clearTokens();

private:
    ConfigManager* config_manager;
    String access_token;
    String refresh_token;
    unsigned long token_expiry;
    String oauth_state;  // Store state for CSRF validation
    
    bool parseTokenResponse(const String& response);
    // Note: urlEncode() moved to common/url_utils.h for reuse
};

#endif // OAUTH_HANDLER_H
