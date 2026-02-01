/**
 * @file string_constants.h
 * @brief Centralized string constants and log tags
 * 
 * This file consolidates commonly used string literals throughout the firmware
 * to improve maintainability and reduce code duplication.
 */

#ifndef STRING_CONSTANTS_H
#define STRING_CONSTANTS_H

// =============================================================================
// LOG TAGS (for Serial logging)
// =============================================================================

namespace LogTags {
    constexpr const char* MAIN = "[MAIN]";
    constexpr const char* WIFI = "[WiFi]";
    constexpr const char* MQTT = "[MQTT]";
    constexpr const char* OTA = "[OTA]";
    constexpr const char* WEBEX = "[WEBEX]";
    constexpr const char* XAPI = "[XAPI]";
    constexpr const char* CONFIG = "[CONFIG]";
    constexpr const char* SUPABASE = "[SUPABASE]";
    constexpr const char* REALTIME = "[REALTIME]";
    constexpr const char* DISPLAY = "[DISPLAY]";
    constexpr const char* CREDS = "[CREDS]";
    constexpr const char* BOOT = "[BOOT]";
    constexpr const char* TIME = "[TIME]";
    constexpr const char* WEB = "[WEB]";
    constexpr const char* SERIAL = "[SERIAL]";
    constexpr const char* MDNS = "[mDNS]";
    constexpr const char* ERROR_TAG = "[ERROR]";
    constexpr const char* WARN = "[WARN]";
    constexpr const char* DEBUG = "[DEBUG]";
}

// =============================================================================
// COMMON STATUS MESSAGES
// =============================================================================

namespace StatusMessages {
    // Success messages
    constexpr const char* SUCCESS = "Success";
    constexpr const char* CONNECTED = "Connected";
    constexpr const char* DISCONNECTED = "Disconnected";
    constexpr const char* INITIALIZED = "Initialized";
    constexpr const char* COMPLETE = "Complete";
    constexpr const char* SAVED = "Saved";
    constexpr const char* LOADED = "Loaded";
    constexpr const char* CLEARED = "Cleared";
    
    // Failure messages
    constexpr const char* FAILED = "Failed";
    constexpr const char* ERROR_MSG = "Error";
    constexpr const char* TIMEOUT = "Timeout";
    constexpr const char* INVALID = "Invalid";
    constexpr const char* NOT_FOUND = "Not found";
    constexpr const char* UNAUTHORIZED = "Unauthorized";
    
    // State messages
    constexpr const char* ENABLED = "enabled";
    constexpr const char* DISABLED = "disabled";
    constexpr const char* ACTIVE = "active";
    constexpr const char* INACTIVE = "inactive";
    constexpr const char* PENDING = "pending";
}

// =============================================================================
// WEBEX STATUS STRINGS
// =============================================================================

namespace WebexStatus {
    constexpr const char* ACTIVE = "active";
    constexpr const char* INACTIVE = "inactive";
    constexpr const char* IN_CALL = "in_call";
    constexpr const char* IN_MEETING = "in_meeting";
    constexpr const char* DO_NOT_DISTURB = "do_not_disturb";
    constexpr const char* PRESENTING = "presenting";
    constexpr const char* AWAY = "away";
    constexpr const char* OFFLINE = "offline";
    constexpr const char* UNKNOWN = "unknown";
}

// =============================================================================
// SENSOR STATUS STRINGS
// =============================================================================

namespace SensorStatus {
    constexpr const char* DOOR_OPEN = "open";
    constexpr const char* DOOR_CLOSED = "closed";
    constexpr const char* WATER_WET = "wet";
    constexpr const char* WATER_DRY = "dry";
}

// =============================================================================
// DISPLAY STRINGS
// =============================================================================

namespace DisplayStrings {
    // Status text
    constexpr const char* NO_CONNECTION = "No Connection";
    constexpr const char* CONNECTING = "Connecting...";
    constexpr const char* STARTING = "Starting...";
    constexpr const char* PROVISIONING = "Provisioning...";
    constexpr const char* UPDATING = "Updating...";
    constexpr const char* ERROR_TEXT = "Error";
    
    // Metric labels
    constexpr const char* TEMP_F = "°F";
    constexpr const char* TEMP_C = "°C";
    constexpr const char* HUMIDITY = "RH";
    constexpr const char* TVOC = "TVOC";
    constexpr const char* AQI = "AQI";
    constexpr const char* CO2 = "CO2";
    constexpr const char* PM25 = "PM2.5";
    constexpr const char* NOISE = "dB";
    
    // Time format
    constexpr const char* AM = "AM";
    constexpr const char* PM = "PM";
}

// =============================================================================
// NETWORK STRINGS
// =============================================================================

namespace NetworkStrings {
    // Protocols
    constexpr const char* HTTP = "http://";
    constexpr const char* HTTPS = "https://";
    constexpr const char* WS = "ws://";
    constexpr const char* WSS = "wss://";
    
    // HTTP methods
    constexpr const char* GET = "GET";
    constexpr const char* POST = "POST";
    constexpr const char* PUT = "PUT";
    constexpr const char* DELETE = "DELETE";
    constexpr const char* PATCH = "PATCH";
    
    // HTTP headers
    constexpr const char* CONTENT_TYPE = "Content-Type";
    constexpr const char* AUTHORIZATION = "Authorization";
    constexpr const char* USER_AGENT = "User-Agent";
    constexpr const char* ACCEPT = "Accept";
    
    // Content types
    constexpr const char* JSON = "application/json";
    constexpr const char* TEXT_HTML = "text/html";
    constexpr const char* TEXT_PLAIN = "text/plain";
    constexpr const char* OCTET_STREAM = "application/octet-stream";
}

// =============================================================================
// CONFIGURATION KEYS (NVS)
// =============================================================================

namespace ConfigKeys {
    // WiFi
    constexpr const char* WIFI_SSID = "wifi_ssid";
    constexpr const char* WIFI_PASSWORD = "wifi_password";
    
    // Webex
    constexpr const char* WEBEX_CLIENT_ID = "webex_client_id";
    constexpr const char* WEBEX_CLIENT_SECRET = "webex_client_secret";
    constexpr const char* WEBEX_ACCESS_TOKEN = "webex_access_token";
    constexpr const char* WEBEX_REFRESH_TOKEN = "webex_refresh_token";
    
    // MQTT
    constexpr const char* MQTT_BROKER = "mqtt_broker";
    constexpr const char* MQTT_PORT = "mqtt_port";
    constexpr const char* MQTT_TOPIC = "mqtt_topic";
    constexpr const char* MQTT_USE_TLS = "mqtt_use_tls";
    
    // Display
    constexpr const char* DISPLAY_BRIGHTNESS = "display_bright";
    constexpr const char* DISPLAY_PAGES = "display_pages";
    constexpr const char* PAGE_INTERVAL = "page_interval";
    constexpr const char* BORDER_WIDTH = "border_width";
    
    // OTA
    constexpr const char* OTA_URL = "ota_url";
    constexpr const char* FAILED_OTA_VERSION = "failed_ota_ver";
    
    // Supabase
    constexpr const char* SUPABASE_URL = "supabase_url";
    constexpr const char* SUPABASE_ANON_KEY = "supabase_key";
}

// =============================================================================
// ERROR MESSAGES
// =============================================================================

namespace ErrorMessages {
    constexpr const char* OUT_OF_MEMORY = "Out of memory";
    constexpr const char* HEAP_CRITICAL = "Critical heap level";
    constexpr const char* WIFI_FAILED = "WiFi connection failed";
    constexpr const char* MQTT_FAILED = "MQTT connection failed";
    constexpr const char* OTA_FAILED = "OTA update failed";
    constexpr const char* PARSE_ERROR = "Failed to parse JSON";
    constexpr const char* NETWORK_ERROR = "Network error";
    constexpr const char* AUTH_FAILED = "Authentication failed";
    constexpr const char* NOT_PROVISIONED = "Device not provisioned";
    constexpr const char* INVALID_CONFIG = "Invalid configuration";
    constexpr const char* TIMEOUT_ERROR = "Operation timed out";
}

// =============================================================================
// API ENDPOINTS
// =============================================================================

namespace ApiEndpoints {
    // Supabase
    constexpr const char* AUTH = "/auth/v1";
    constexpr const char* REST = "/rest/v1";
    constexpr const char* REALTIME = "/realtime/v1";
    constexpr const char* STORAGE = "/storage/v1";
    
    // Webex
    constexpr const char* WEBEX_API = "https://webexapis.com/v1";
    constexpr const char* WEBEX_PEOPLE_ME = "/people/me";
    constexpr const char* WEBEX_MEETINGS = "/meetings";
}

// =============================================================================
// UNITS
// =============================================================================

namespace Units {
    constexpr const char* CELSIUS = "°C";
    constexpr const char* FAHRENHEIT = "°F";
    constexpr const char* PERCENT = "%";
    constexpr const char* PPM = "ppm";
    constexpr const char* PPB = "ppb";
    constexpr const char* DECIBEL = "dB";
    constexpr const char* MICROSECONDS = "µg/m³";
    constexpr const char* MILLISECONDS = "ms";
    constexpr const char* SECONDS = "s";
    constexpr const char* MINUTES = "min";
    constexpr const char* HOURS = "h";
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

namespace Format {
    // Common format strings for printf
    constexpr const char* IP_ADDRESS = "%d.%d.%d.%d";
    constexpr const char* MAC_ADDRESS = "%02X:%02X:%02X:%02X:%02X:%02X";
    constexpr const char* TIME_24H = "%02d:%02d";
    constexpr const char* TIME_12H = "%2d:%02d";
    constexpr const char* DATE_MDY = "%02d/%02d/%04d";
    constexpr const char* PERCENTAGE = "%d%%";
    constexpr const char* FLOAT_1 = "%.1f";
    constexpr const char* FLOAT_2 = "%.2f";
}

#endif // STRING_CONSTANTS_H
