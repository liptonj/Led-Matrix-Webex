/**
 * @file test_provision_helpers.cpp
 * @brief Unit tests for Provision Helpers module
 *
 * Tests verify:
 * - Pairing code extraction from JSON responses
 * - Pairing code persistence to PairingManager and SupabaseClient
 * - Display of pairing codes on LED matrix
 * - Timeout handling for pairing codes
 * - Approval pending state management
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <string.h>

// Include the module under test
#include "sync/provision_helpers.h"
#include "core/dependencies.h"

// ============================================================================
// Mock Classes
// ============================================================================

// Mock PairingManager
class MockPairingManager {
public:
    String lastSetCode;
    bool lastSetCodeSave = false;
    int setCodeCallCount = 0;
    
    String getCode() const {
        return currentCode;
    }
    
    bool setCode(const String& code, bool save = true) {
        lastSetCode = code;
        lastSetCodeSave = save;
        setCodeCallCount++;
        currentCode = code;
        return true;
    }
    
    void reset() {
        lastSetCode = "";
        lastSetCodeSave = false;
        setCodeCallCount = 0;
        currentCode = "";
    }
    
private:
    String currentCode;
};

// Mock SupabaseClient
class MockSupabaseClient {
public:
    String lastSetPairingCode;
    int setPairingCodeCallCount = 0;
    bool initialized = true;
    
    void setPairingCode(const String& code) {
        lastSetPairingCode = code;
        setPairingCodeCallCount++;
    }
    
    bool isInitialized() const {
        return initialized;
    }
    
    void reset() {
        lastSetPairingCode = "";
        setPairingCodeCallCount = 0;
        initialized = true;
    }
};

// Mock MatrixDisplay
class MockMatrixDisplay {
public:
    String lastShowPairingCode;
    String lastShowPairingCodeHubUrl;
    int showPairingCodeCallCount = 0;
    String lastDisplayProvisioningStatus;
    int displayProvisioningStatusCallCount = 0;
    
    void showPairingCode(const String& code, const String& hub_url = "") {
        lastShowPairingCode = code;
        lastShowPairingCodeHubUrl = hub_url;
        showPairingCodeCallCount++;
    }
    
    void displayProvisioningStatus(const String& serial) {
        lastDisplayProvisioningStatus = serial;
        displayProvisioningStatusCallCount++;
    }
    
    void reset() {
        lastShowPairingCode = "";
        lastShowPairingCodeHubUrl = "";
        showPairingCodeCallCount = 0;
        lastDisplayProvisioningStatus = "";
        displayProvisioningStatusCallCount = 0;
    }
};

// Mock DeviceCredentials
class MockDeviceCredentials {
public:
    String serialNumber = "TEST1234";
    bool provisioned = true;
    
    String getSerialNumber() const {
        return serialNumber;
    }
    
    bool isProvisioned() const {
        return provisioned;
    }
    
    void reset() {
        serialNumber = "TEST1234";
        provisioned = true;
    }
};

// Mock ConfigManager
class MockConfigManager {
public:
    String supabaseUrl = "https://test.supabase.co";
    
    String getSupabaseUrl() {
        return supabaseUrl;
    }
    
    void reset() {
        supabaseUrl = "https://test.supabase.co";
    }
};

// Mock AppState
struct MockAppState {
    bool wifi_connected = true;
    bool time_synced = true;
    bool supabase_disabled = false;
    bool supabase_blacklisted = false;
    bool supabase_deleted = false;
    bool supabase_approval_pending = false;
    
    void reset() {
        wifi_connected = true;
        time_synced = true;
        supabase_disabled = false;
        supabase_blacklisted = false;
        supabase_deleted = false;
        supabase_approval_pending = false;
    }
};

// Mock other dependencies (minimal implementations)
class MockWiFiManager {};
class MockWebServerManager {};
class MockMDNSManager {};
class MockSupabaseRealtime {};
class MockBootValidator {};
class MockOTAManager {};
class MockMerakiMQTTClient {};
class MockSyncManager {};
class MockRealtimeManager {};
class MockCommandProcessor {};
class MockRemoteLogger {};
class ImprovHandler {};
class MockWebexClient {};
class MockXAPIWebSocket {};

// Global mock instances
static MockPairingManager mockPairing;
static MockSupabaseClient mockSupabase;
static MockMatrixDisplay mockDisplay;
static MockDeviceCredentials mockCredentials;
static MockConfigManager mockConfig;
static MockAppState mockAppState;
static bool mockDebugMode = false;
static bool mockDebugDisplay = false;
static bool mockDebugRealtime = false;
static MockWiFiManager mockWifi;
static MockWebServerManager mockWebServer;
static MockMDNSManager mockMDNS;
static MockSupabaseRealtime mockRealtime;
static MockBootValidator mockBootValidator;
static MockOTAManager mockOTA;
static MockMerakiMQTTClient mockMQTT;
static MockSyncManager mockSync;
static MockRealtimeManager mockRealtimeManager;
static MockCommandProcessor mockCommandProcessor;
static MockRemoteLogger mockRemoteLogger;
static ImprovHandler mockImprov;
static MockWebexClient mockWebex;
static MockXAPIWebSocket mockXAPI;

// Global Dependencies instance for testing
static Dependencies* g_test_dependencies = nullptr;

// Override getDependencies() for testing
// Note: Using reinterpret_cast is necessary here because Dependencies uses references,
// and we need to bind them to our mock objects. This is safe as long as we only call
// methods that exist on our mocks and don't access data members directly.
Dependencies& getDependencies() {
    if (g_test_dependencies == nullptr) {
        // Initialize test dependencies with mock objects
        // The reinterpret_cast is safe because:
        // 1. We only call interface methods that exist on our mocks
        // 2. We don't access data members through the Dependencies struct
        // 3. This is a test-only environment
        static Dependencies test_deps(
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
        g_test_dependencies = &test_deps;
    }
    return *g_test_dependencies;
}

// Mock millis() for timeout testing
// Note: millis() is defined in Arduino.h mock and uses g_mock_millis when UNIT_TEST is defined
unsigned long g_mock_millis = 0;

// ============================================================================
// Mock Global Functions
// ============================================================================

// Note: Provision token functions (get_provision_token, set_provision_token, 
// clear_provision_token) are now provided by simulation/mocks/globals.cpp
// to avoid duplicate symbol definitions across test files.

// ============================================================================
// Test Setup and Teardown
// ============================================================================

void setUp(void) {
    // Reset all mocks
    mockPairing.reset();
    mockSupabase.reset();
    mockDisplay.reset();
    mockCredentials.reset();
    mockConfig.reset();
    mockAppState.reset();
    g_mock_millis = 1000;  // Start at 1 second
    g_mock_provision_token = "";  // Reset provision token
    g_test_dependencies = nullptr;  // Force re-initialization
    
    // Reset provisioning state
    ProvisionHelpers::resetProvisionState();
}

void tearDown(void) {
    // Clean up after each test
}

// ============================================================================
// Test Cases
// ============================================================================

/**
 * @brief Test that handleAwaitingApproval() saves pairing code to PairingManager
 * 
 * This is the main test for the bug fix - verifies that when a pairing code
 * is received from the server, it's properly saved to PairingManager.
 */
void test_handle_awaiting_approval_saves_pairing_code_to_pairing_manager(void) {
    // Arrange
    const char* responseJson = R"({"pairing_code": "ABC123"})";
    
    // Act
    int result = ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    
    // Assert
    TEST_ASSERT_EQUAL(0, result);  // Should return 0 (keep trying)
    TEST_ASSERT_EQUAL(1, mockPairing.setCodeCallCount);
    TEST_ASSERT_EQUAL_STRING("ABC123", mockPairing.lastSetCode.c_str());
    TEST_ASSERT_TRUE(mockPairing.lastSetCodeSave);  // Should save to NVS
}

/**
 * @brief Test that handleAwaitingApproval() saves pairing code to SupabaseClient
 * 
 * Verifies that the pairing code is also saved to SupabaseClient for
 * realtime channel subscription.
 */
void test_handle_awaiting_approval_saves_pairing_code_to_supabase_client(void) {
    // Arrange
    const char* responseJson = R"({"pairing_code": "XYZ789"})";
    
    // Act
    int result = ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    
    // Assert
    TEST_ASSERT_EQUAL(0, result);
    TEST_ASSERT_EQUAL(1, mockSupabase.setPairingCodeCallCount);
    TEST_ASSERT_EQUAL_STRING("XYZ789", mockSupabase.lastSetPairingCode.c_str());
}

/**
 * @brief Test that handleAwaitingApproval() displays pairing code on LED matrix
 * 
 * Verifies that the pairing code is displayed on the LED matrix display.
 */
void test_handle_awaiting_approval_displays_pairing_code(void) {
    // Arrange
    const char* responseJson = R"({"pairing_code": "DEF456"})";
    
    // Act
    int result = ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    
    // Assert
    TEST_ASSERT_EQUAL(0, result);
    TEST_ASSERT_EQUAL(1, mockDisplay.showPairingCodeCallCount);
    TEST_ASSERT_EQUAL_STRING("DEF456", mockDisplay.lastShowPairingCode.c_str());
}

/**
 * @brief Test that handleAwaitingApproval() sets approval pending state
 * 
 * Verifies that the approval pending flag is set in app state.
 */
void test_handle_awaiting_approval_sets_approval_pending(void) {
    // Arrange
    const char* responseJson = R"({"pairing_code": "GHI789"})";
    mockAppState.supabase_approval_pending = false;
    
    // Act
    int result = ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    
    // Assert
    TEST_ASSERT_EQUAL(0, result);
    TEST_ASSERT_TRUE(mockAppState.supabase_approval_pending);
}

/**
 * @brief Test that handleAwaitingApproval() handles response without pairing code
 * 
 * When no pairing code is present, should display provisioning status instead.
 */
void test_handle_awaiting_approval_without_pairing_code(void) {
    // Arrange
    const char* responseJson = R"({"status": "pending"})";
    mockCredentials.serialNumber = "SERIAL99";
    
    // Act
    int result = ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    
    // Assert
    TEST_ASSERT_EQUAL(0, result);
    TEST_ASSERT_EQUAL(0, mockPairing.setCodeCallCount);  // Should not set code
    TEST_ASSERT_EQUAL(0, mockSupabase.setPairingCodeCallCount);
    TEST_ASSERT_EQUAL(0, mockDisplay.showPairingCodeCallCount);  // Should not show pairing code
    TEST_ASSERT_TRUE(mockAppState.supabase_approval_pending);
}

/**
 * @brief Test that handleAwaitingApproval() handles invalid JSON gracefully
 * 
 * Should handle malformed JSON without crashing.
 */
void test_handle_awaiting_approval_invalid_json(void) {
    // Arrange
    const char* responseJson = "{invalid json";
    
    // Act
    int result = ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    
    // Assert
    TEST_ASSERT_EQUAL(0, result);
    TEST_ASSERT_EQUAL(0, mockPairing.setCodeCallCount);
    TEST_ASSERT_EQUAL(0, mockSupabase.setPairingCodeCallCount);
    TEST_ASSERT_TRUE(mockAppState.supabase_approval_pending);
}

/**
 * @brief Test that handleAwaitingApproval() handles empty response
 * 
 * Should handle empty string response gracefully.
 */
void test_handle_awaiting_approval_empty_response(void) {
    // Arrange
    String responseJson = "";
    
    // Act
    int result = ProvisionHelpers::handleAwaitingApproval(responseJson);
    
    // Assert
    TEST_ASSERT_EQUAL(0, result);
    TEST_ASSERT_EQUAL(0, mockPairing.setCodeCallCount);
    TEST_ASSERT_EQUAL(0, mockSupabase.setPairingCodeCallCount);
    TEST_ASSERT_TRUE(mockAppState.supabase_approval_pending);
}

/**
 * @brief Test that handleAwaitingApproval() handles pairing code timeout
 * 
 * After 240 seconds (4 minutes), should return timeout status.
 */
void test_handle_awaiting_approval_timeout(void) {
    // Arrange
    const char* responseJson = R"({"pairing_code": "TIMEOUT"})";
    
    // First call - sets pairing code and starts timer
    g_mock_millis = 1000;
    ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    
    // Second call - after timeout period (240 seconds = 240000ms)
    g_mock_millis = 241000;  // 1 second past timeout
    
    // Act
    int result = ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    
    // Assert
    TEST_ASSERT_EQUAL(1, result);  // Should return 1 (timeout expired)
}

/**
 * @brief Test that handleAwaitingApproval() handles multiple calls with same pairing code
 * 
 * Should handle repeated calls with the same pairing code correctly.
 */
void test_handle_awaiting_approval_multiple_calls_same_code(void) {
    // Arrange
    const char* responseJson = R"({"pairing_code": "REPEAT"})";
    
    // Act - call multiple times
    ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    g_mock_millis += 1000;
    ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    g_mock_millis += 1000;
    ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    
    // Assert
    // Should set code on first call, then just display it
    TEST_ASSERT_EQUAL(1, mockPairing.setCodeCallCount);  // Only set once
    TEST_ASSERT_EQUAL(1, mockSupabase.setPairingCodeCallCount);  // Only set once
    TEST_ASSERT_EQUAL(3, mockDisplay.showPairingCodeCallCount);  // Display each time
}

/**
 * @brief Test that handleAwaitingApproval() handles pairing code change
 * 
 * If pairing code changes between calls, should update it.
 */
void test_handle_awaiting_approval_code_change(void) {
    // Arrange
    const char* responseJson1 = R"({"pairing_code": "FIRST"})";
    const char* responseJson2 = R"({"pairing_code": "SECOND"})";
    
    // Act
    ProvisionHelpers::handleAwaitingApproval(String(responseJson1));
    g_mock_millis += 1000;
    ProvisionHelpers::handleAwaitingApproval(String(responseJson2));
    
    // Assert
    TEST_ASSERT_EQUAL(2, mockPairing.setCodeCallCount);  // Should set twice
    TEST_ASSERT_EQUAL(2, mockSupabase.setPairingCodeCallCount);  // Should set twice
    TEST_ASSERT_EQUAL_STRING("SECOND", mockPairing.lastSetCode.c_str());
    TEST_ASSERT_EQUAL_STRING("SECOND", mockSupabase.lastSetPairingCode.c_str());
}

/**
 * @brief Test comprehensive pairing code fix - all three operations together
 * 
 * This is the main integration test verifying the bug fix:
 * 1. Pairing code is saved to PairingManager
 * 2. Pairing code is saved to SupabaseClient
 * 3. Pairing code is displayed on LED matrix
 */
void test_pairing_code_fix_comprehensive(void) {
    // Arrange - Simulate a 403 response with pairing code (the bug scenario)
    const char* responseJson = R"({
        "error": "Device awaiting approval",
        "pairing_code": "FIX123"
    })";
    
    // Act
    int result = ProvisionHelpers::handleAwaitingApproval(String(responseJson));
    
    // Assert - Verify all three operations happened
    TEST_ASSERT_EQUAL(0, result);
    
    // 1. Verify PairingManager.setCode() was called
    TEST_ASSERT_EQUAL(1, mockPairing.setCodeCallCount);
    TEST_ASSERT_EQUAL_STRING("FIX123", mockPairing.lastSetCode.c_str());
    TEST_ASSERT_TRUE(mockPairing.lastSetCodeSave);  // Should save to NVS
    
    // 2. Verify SupabaseClient.setPairingCode() was called
    TEST_ASSERT_EQUAL(1, mockSupabase.setPairingCodeCallCount);
    TEST_ASSERT_EQUAL_STRING("FIX123", mockSupabase.lastSetPairingCode.c_str());
    
    // 3. Verify MatrixDisplay.showPairingCode() was called
    TEST_ASSERT_EQUAL(1, mockDisplay.showPairingCodeCallCount);
    TEST_ASSERT_EQUAL_STRING("FIX123", mockDisplay.lastShowPairingCode.c_str());
    
    // 4. Verify approval pending state is set
    TEST_ASSERT_TRUE(mockAppState.supabase_approval_pending);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_provision_helpers_tests() {
    UNITY_BEGIN();
    
    // Pairing code fix tests (main bug fix verification)
    RUN_TEST(test_pairing_code_fix_comprehensive);
    RUN_TEST(test_handle_awaiting_approval_saves_pairing_code_to_pairing_manager);
    RUN_TEST(test_handle_awaiting_approval_saves_pairing_code_to_supabase_client);
    RUN_TEST(test_handle_awaiting_approval_displays_pairing_code);
    
    // State management tests
    RUN_TEST(test_handle_awaiting_approval_sets_approval_pending);
    
    // Edge case tests
    RUN_TEST(test_handle_awaiting_approval_without_pairing_code);
    RUN_TEST(test_handle_awaiting_approval_invalid_json);
    RUN_TEST(test_handle_awaiting_approval_empty_response);
    
    // Timeout tests
    RUN_TEST(test_handle_awaiting_approval_timeout);
    
    // Multiple call tests
    RUN_TEST(test_handle_awaiting_approval_multiple_calls_same_code);
    RUN_TEST(test_handle_awaiting_approval_code_change);
    
    UNITY_END();
}

#ifdef NATIVE_BUILD
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    run_provision_helpers_tests();
    return 0;
}
#else
void setup() {
    delay(2000);  // Give time for serial monitor
    run_provision_helpers_tests();
}

void loop() {
    // Empty - tests run once in setup()
}
#endif

#endif // UNIT_TEST
