/**
 * @file globals.cpp
 * @brief Global instance definitions for mock classes
 */

#include "Arduino.h"
#include "WiFi.h"
#include "ESPmDNS.h"
#include "LittleFS.h"

// Global instances
HardwareSerial Serial;
EspClass Esp;
EspClass ESP;
WiFiClass WiFi;
MDNSResponder MDNS;
LittleFSFS LittleFS;

// Note: Preferences static storage is now defined inline in Preferences.h using C++17 inline static

#if defined(UNIT_TEST)
// ============================================================================
// Minimal getDependencies() stub for tests that include serial_commands.cpp
// ============================================================================
// serial_commands.cpp references getDependencies() but most tests
// don't call functions that use it. This stub provides a minimal implementation
// that satisfies the linker. Individual tests can override this via weak linkage.
#include "core/dependencies.h"

// Forward declarations for minimal mocks
class ConfigManager { public: void setWiFiCredentials(const String&, const String&) {} void factoryReset() {} };
struct AppState {};
class MatrixDisplay {};
class WiFiManager {};
class WebServerManager {};
class MDNSManager {};
class SupabaseClient {};
class SupabaseRealtime {};
class DeviceCredentials {};
class PairingManager {};
class BootValidator {};
class OTAManager {};
class MerakiMQTTClient {};
class SyncManager {};
class RealtimeManager {};
class CommandProcessor {};
class RemoteLogger {};
class ImprovHandler {};
class WebexClient {};
class XAPIWebSocket {};

// Minimal mock instances
static ConfigManager mockConfig;
static AppState mockAppState;
static bool mockDebugMode = false;
static bool mockDebugDisplay = false;
static bool mockDebugRealtime = false;
static MatrixDisplay mockDisplay;
static WiFiManager mockWifi;
static WebServerManager mockWebServer;
static MDNSManager mockMDNS;
static SupabaseClient mockSupabase;
static SupabaseRealtime mockRealtime;
static DeviceCredentials mockCredentials;
static PairingManager mockPairing;
static BootValidator mockBootValidator;
static OTAManager mockOTA;
static MerakiMQTTClient mockMQTT;
static SyncManager mockSync;
static RealtimeManager mockRealtimeManager;
static CommandProcessor mockCommandProcessor;
static RemoteLogger mockRemoteLogger;
static ImprovHandler mockImprov;
static WebexClient mockWebex;
static XAPIWebSocket mockXAPI;

// Static Dependencies instance
static Dependencies* g_test_deps = nullptr;

// Use weak attribute to allow tests to override this function
// Tests that provide their own getDependencies() will take precedence
__attribute__((weak)) Dependencies& getDependencies() {
    if (g_test_deps == nullptr) {
        static Dependencies deps(
            *reinterpret_cast<ConfigManager*>(&mockConfig),
            *reinterpret_cast<AppState*>(&mockAppState),
            mockDebugMode,
            mockDebugDisplay,
            mockDebugRealtime,
            *reinterpret_cast<MatrixDisplay*>(&mockDisplay),
            *reinterpret_cast<WiFiManager*>(&mockWifi),
            *reinterpret_cast<WebServerManager*>(&mockWebServer),
            *reinterpret_cast<MDNSManager*>(&mockMDNS),
            *reinterpret_cast<SupabaseClient*>(&mockSupabase),
            *reinterpret_cast<SupabaseRealtime*>(&mockRealtime),
            *reinterpret_cast<DeviceCredentials*>(&mockCredentials),
            *reinterpret_cast<PairingManager*>(&mockPairing),
            *reinterpret_cast<BootValidator*>(&mockBootValidator),
            *reinterpret_cast<OTAManager*>(&mockOTA),
            *reinterpret_cast<MerakiMQTTClient*>(&mockMQTT),
            *reinterpret_cast<SyncManager*>(&mockSync),
            *reinterpret_cast<RealtimeManager*>(&mockRealtimeManager),
            *reinterpret_cast<CommandProcessor*>(&mockCommandProcessor),
            *reinterpret_cast<RemoteLogger*>(&mockRemoteLogger),
            *reinterpret_cast<ImprovHandler*>(&mockImprov),
            *reinterpret_cast<WebexClient*>(&mockWebex),
            *reinterpret_cast<XAPIWebSocket*>(&mockXAPI)
        );
        g_test_deps = &deps;
    }
    return *g_test_deps;
}

#endif // UNIT_TEST

// ============================================================================
// Mock serial_commands functions for native tests
// ============================================================================
// These functions are used by provision_helpers.cpp but serial_commands.cpp
// is not included in test builds, so we provide mock implementations here.

#if defined(NATIVE_BUILD) || defined(UNIT_TEST)
// ============================================================================
// Mock serial_commands functions for native tests
// ============================================================================
// These functions are used by provision_helpers.cpp and test_serial_commands.
// We provide mock implementations here using weak linkage so they're only used
// if the real symbols from serial_commands.cpp are not available.
// 
// IMPORTANT: These mocks use weak linkage (__attribute__((weak))) so the linker
// will prefer the real implementation from serial_commands.cpp if it's linked.
// This allows:
// - test_serial_commands: Uses real implementation from serial_commands.cpp
// - test_provision_helpers: Uses weak mocks (serial_commands.cpp not included)
// 
// Note: Weak symbols are supported on Unix-like systems (Linux, macOS) which
// is what the native test environment uses. If porting to Windows, we may need
// a different approach.

// Static storage for provision token (matches serial_commands.cpp implementation)
static String g_mock_provision_token = "";

// Use weak attribute to allow real implementation to override
__attribute__((weak)) void set_provision_token(const String& token) {
    g_mock_provision_token = token;
}

__attribute__((weak)) String get_provision_token() {
    return g_mock_provision_token;
}

__attribute__((weak)) void clear_provision_token() {
    g_mock_provision_token = "";
}

// Mock serial_commands_begin for native tests
__attribute__((weak)) void serial_commands_begin() {
    // Mock implementation - no-op for tests
}

#endif // NATIVE_BUILD || UNIT_TEST

#ifdef UNIT_TEST
// Mock millis() control variable for unit tests
// This is declared as extern in Arduino.h when UNIT_TEST is defined
unsigned long g_mock_millis = 0;

#endif // UNIT_TEST
