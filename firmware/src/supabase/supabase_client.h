/**
 * @file supabase_client.h
 * @brief Supabase Edge Function Client for Device State Sync
 *
 * Phase A implementation: HTTP polling-based state sync with Supabase.
 * Replaces bridge WebSocket dependency for pairing/status updates.
 *
 * Features:
 * - HMAC-authenticated device authentication
 * - JWT token caching with auto-refresh
 * - Device state posting with app status response
 * - Command polling and acknowledgment
 */

#ifndef SUPABASE_CLIENT_H
#define SUPABASE_CLIENT_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// Token configuration
#define SUPABASE_TOKEN_REFRESH_MARGIN 600  // Refresh 10 minutes before expiry (in seconds)
#define SUPABASE_MAX_RETRIES 3
#define SUPABASE_RETRY_DELAY_MS 2000

/**
 * @brief App state received from Supabase
 */
struct SupabaseAppState {
    bool valid;
    bool app_connected;
    String webex_status;
    String display_name;
    bool camera_on;
    bool mic_muted;
    bool in_call;
};

/**
 * @brief Command received from Supabase
 */
struct SupabaseCommand {
    String id;
    String command;
    String payload;  // JSON payload as string
    String created_at;
    bool valid;
};

/**
 * @brief Authentication result
 */
struct SupabaseAuthResult {
    bool success;
    String token;
    String pairing_code;
    String device_id;
    String target_firmware_version;
    bool debug_enabled;
    String anon_key;
    unsigned long expires_at;  // Unix timestamp in seconds
};

enum class SupabaseAuthError {
    None,
    InvalidSignature,
    ApprovalRequired,
    Disabled,
    Blacklisted,
    Deleted,
    Other
};

// Command handler callback type
typedef void (*SupabaseCommandHandler)(const SupabaseCommand& cmd);

/**
 * @brief Supabase Edge Function Client
 *
 * Handles device authentication and state synchronization with Supabase.
 */
class SupabaseClient {
public:
    SupabaseClient();
    ~SupabaseClient();

    /**
     * @brief Initialize the Supabase client
     * @param supabase_url Base Supabase URL (e.g., https://xxx.supabase.co)
     * @param pairing_code Device's pairing code
     */
    void begin(const String& supabase_url, const String& pairing_code);

    /**
     * @brief Update the pairing code
     * @param code New pairing code
     */
    void setPairingCode(const String& code);

    /**
     * @brief Check if client is initialized
     * @return true if begin() was called with valid URL
     */
    bool isInitialized() const { return !_supabaseUrl.isEmpty(); }

    /**
     * @brief Check if we have a valid authentication token
     * @return true if token exists and not expired
     */
    bool isAuthenticated() const;

    /**
     * @brief Authenticate with Supabase using HMAC
     * @return true on success
     */
    bool authenticate();

    /**
     * @brief Post device state and get app status back
     *
     * @param rssi WiFi signal strength
     * @param freeHeap Free memory in bytes
     * @param uptime Uptime in seconds
     * @param firmwareVersion Current firmware version
     * @param temperature Optional temperature reading
     * @return SupabaseAppState with app's current status
     */
    SupabaseAppState postDeviceState(int rssi, uint32_t freeHeap, 
                                      uint32_t uptime, const String& firmwareVersion,
                                      float temperature = 0);

    /**
     * @brief Poll for pending commands
     * @param commands Output vector to store commands (max 10)
     * @return Number of commands received
     */
    int pollCommands(SupabaseCommand commands[], int maxCommands = 10);

    /**
     * @brief Acknowledge command completion
     * @param commandId Command ID to acknowledge
     * @param success Whether command succeeded
     * @param response Optional response data (JSON string)
     * @param error Optional error message if failed
     * @return true if acknowledgment was successful
     */
    bool ackCommand(const String& commandId, bool success, 
                    const String& response = "", const String& error = "");

    /**
     * @brief Broadcast a device log via Supabase Realtime (no DB storage)
     * @param level Log level (debug, info, warn, error)
     * @param message Log message
     * @param metadata Optional JSON metadata string
     * @return true if sent successfully
     */
    bool insertDeviceLog(const String& level, const String& message, const String& metadata = "");
    bool isRequestInFlight() const { return _requestInFlight; }

    /**
     * @brief Set command handler callback
     * @param handler Function to call when command received
     */
    void setCommandHandler(SupabaseCommandHandler handler) { _commandHandler = handler; }

    /**
     * @brief Get current pairing code
     * @return Pairing code string
     */
    String getPairingCode() const { return _pairingCode; }

    /**
     * @brief Get target firmware version (from device-auth response)
     * @return Target version or empty string if none
     */
    String getTargetFirmwareVersion() const { return _targetFirmwareVersion; }

    /**
     * @brief Check if app is currently connected
     * @return true if last status showed app connected
     */
    bool isAppConnected() const { return _appConnected; }

    /**
     * @brief Check if server-side debug logging is enabled for this device
     * @return true if debug_enabled is set in display.devices
     */
    bool isRemoteDebugEnabled() const { return _remoteDebugEnabled; }
    void setRemoteDebugEnabled(bool enabled) { _remoteDebugEnabled = enabled; }

    /**
     * @brief Get last known app state
     * @return Last received app state
     */
    SupabaseAppState getLastAppState() const { return _lastAppState; }

    /**
     * @brief Force token refresh on next request
     */
    void invalidateToken() { _tokenExpiresAt = 0; }

    /**
     * @brief Get the current access token (for realtime subscriptions)
     * @return JWT token string, or empty if not authenticated
     */
    String getAccessToken() const { return _token; }

    /**
     * @brief Get the latest Supabase anon key from device-auth response
     * @return Anon key string, or empty if not provided
     */
    String getAnonKey() const { return _supabaseAnonKey; }

    /**
     * @brief Get the Supabase URL
     * @return Base Supabase URL
     */
    String getSupabaseUrl() const { return _supabaseUrl; }
    SupabaseAuthError getLastAuthError() const { return _lastAuthError; }

    /**
     * @brief Sync Webex status via cloud edge function
     * @param webexStatus Output: normalized webex status if available
     * @param payload Optional JSON payload to send (e.g., local fallback data)
     * @return true if request succeeded and status parsed
     */
    bool syncWebexStatus(String& webexStatus, const String& payload = "");
    bool isWebexTokenMissing() const { return _webexTokenMissing; }

private:
    String _supabaseUrl;
    String _pairingCode;
    String _token;
    unsigned long _tokenExpiresAt;  // Unix timestamp
    String _targetFirmwareVersion;
    String _supabaseAnonKey;
    bool _remoteDebugEnabled = false;
    bool _appConnected;
    SupabaseAppState _lastAppState;
    SupabaseCommandHandler _commandHandler;
    SupabaseAuthError _lastAuthError = SupabaseAuthError::None;
    bool _webexTokenMissing = false;

    /**
     * @brief Ensure we have a valid token (refresh if needed)
     * @return true if token is valid
     */
    bool ensureAuthenticated();

    /**
     * @brief Make an HTTP request to Supabase Edge Function
     * @param endpoint Function name (e.g., "device-auth")
     * @param method HTTP method
     * @param body Request body
     * @param response Output: response body
     * @param useHmac If true, use HMAC auth; otherwise use Bearer token
     * @return HTTP status code (0 on connection failure)
     */
    int makeRequest(const String& endpoint, const String& method,
                    const String& body, String& response, bool useHmac = false, bool allowImmediate = false);
    
    /**
     * @brief Make an HTTP request with automatic 401 retry handling
     * 
     * Wraps makeRequest() to automatically handle 401 Unauthorized by:
     * 1. Invalidating the current token
     * 2. Re-authenticating to get a new token
     * 3. Retrying the original request once
     * 
     * This consolidates the 401 retry pattern used in:
     * - postDeviceState()
     * - pollCommands()
     * - ackCommand()
     * - insertDeviceLog()
     * 
     * @param endpoint Function name (e.g., "post-device-state")
     * @param method HTTP method ("GET" or "POST")
     * @param body Request body (empty for GET)
     * @param response Output: response body
     * @return HTTP status code (0 on connection failure, -2 if rate limited)
     */
    int makeRequestWithRetry(const String& endpoint, const String& method,
                            const String& body, String& response);
    
    bool beginRequestSlot(bool allowImmediate);

    /**
     * @brief Add HMAC authentication headers
     * @param http HTTPClient reference
     * @param body Request body for signature
     * @return true if headers added successfully, false if not provisioned
     */
    bool addHmacHeaders(HTTPClient& http, const String& body);

    /**
     * @brief Parse auth response
     * @param json Response JSON
     * @return SupabaseAuthResult
     */
    SupabaseAuthResult parseAuthResponse(const String& json);

    WiFiClientSecure _client;
    bool _requestInFlight = false;
    unsigned long _lastRequestMs = 0;
    unsigned long _minRequestIntervalMs = 1500;
};

// Global instance
extern SupabaseClient supabaseClient;

#endif // SUPABASE_CLIENT_H
