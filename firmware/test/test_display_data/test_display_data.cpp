/**
 * @file test_display_data.cpp
 * @brief Unit tests for Display Data and Status Mapping
 *
 * Tests verify DisplayData structure handling, status to color mapping,
 * status text formatting, and page transition logic.
 *
 * These tests ensure the display correctly renders status updates from
 * various sources (Webex, Supabase, MQTT sensors).
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>

// ============================================================================
// Color Definitions (RGB565 format - from matrix_display.h)
// ============================================================================

#define COLOR_BLACK     0x0000
#define COLOR_WHITE     0xFFFF
#define COLOR_RED       0xF800
#define COLOR_GREEN     0x07E0
#define COLOR_BLUE      0x001F
#define COLOR_YELLOW    0xFFE0
#define COLOR_ORANGE    0xFD20
#define COLOR_PURPLE    0x8010
#define COLOR_CYAN      0x07FF
#define COLOR_GRAY      0x8410

// Status colors
#define COLOR_ACTIVE    0x07E0  // Green
#define COLOR_AWAY      0xFFE0  // Yellow
#define COLOR_DND       0xF800  // Red
#define COLOR_BUSY      0xF800  // Red
#define COLOR_OFFLINE   0x8410  // Gray
#define COLOR_OOO       0x8010  // Purple
#define COLOR_PRESENTING 0xF81F // Magenta

// ============================================================================
// Display Page Types
// ============================================================================

enum class DisplayPage : uint8_t {
    STATUS = 0,
    SENSORS = 1,
    IN_CALL = 2
};

// ============================================================================
// DisplayData Structure (from matrix_display.h)
// ============================================================================

struct DisplayData {
    String webex_status = "unknown";
    String display_name = "";
    bool camera_on = false;
    bool mic_muted = false;
    bool in_call = false;
    bool show_call_status = false;
    float temperature = 0.0f;
    float humidity = 0.0f;
    String door_status = "";
    int air_quality_index = 0;
    float tvoc = 0.0f;
    float co2_ppm = 0.0f;
    float pm2_5 = 0.0f;
    float ambient_noise = 0.0f;
    String right_metric = "tvoc";
    bool show_sensors = false;
    bool sensor_page_enabled = true;
    bool wifi_connected = false;
    bool bridge_connected = false;
    int hour = 0;
    int minute = 0;
    int day = 0;
    int month = 0;
    bool time_valid = false;
    bool use_24h = true;
    uint8_t date_format = 0;
};

// ============================================================================
// Status Color Mapping (simulates getStatusColor from matrix_display.cpp)
// ============================================================================

uint16_t getStatusColor(const String& status) {
    String s = status;
    s.toLowerCase();
    
    if (s == "active" || s == "available") {
        return COLOR_ACTIVE;
    } else if (s == "call" || s == "meeting" || s == "busy") {
        return COLOR_BUSY;
    } else if (s == "dnd" || s == "donotdisturb") {
        return COLOR_DND;
    } else if (s == "inactive" || s == "away" || s == "brb") {
        return COLOR_AWAY;
    } else if (s == "outofoffice" || s == "ooo") {
        return COLOR_OOO;
    } else if (s == "presenting") {
        return COLOR_PRESENTING;
    } else if (s == "offline" || s == "unknown" || s == "pending") {
        return COLOR_OFFLINE;
    }
    
    return COLOR_GRAY;  // Default fallback
}

// ============================================================================
// Status Text Mapping (simulates getStatusText from matrix_display.cpp)
// ============================================================================

String getStatusText(const String& status) {
    String s = status;
    s.toLowerCase();
    
    if (s == "active" || s == "available") {
        return "AVAILABLE";
    } else if (s == "call") {
        return "ON A CALL";
    } else if (s == "meeting") {
        return "IN MEETING";
    } else if (s == "busy") {
        return "BUSY";
    } else if (s == "dnd" || s == "donotdisturb") {
        return "DO NOT DISTURB";
    } else if (s == "inactive" || s == "away") {
        return "AWAY";
    } else if (s == "brb") {
        return "BE RIGHT BACK";
    } else if (s == "outofoffice" || s == "ooo") {
        return "OUT OF OFFICE";
    } else if (s == "presenting") {
        return "PRESENTING";
    } else if (s == "offline") {
        return "OFFLINE";
    } else if (s == "pending") {
        return "LOADING...";
    }
    
    return "UNKNOWN";
}

// ============================================================================
// Status Color and Text Mapping Tests (Consolidated)
// ============================================================================

void test_status_color_mapping() {
    // Active/Available -> Green
    TEST_ASSERT_EQUAL_HEX16(COLOR_GREEN, getStatusColor("active"));
    TEST_ASSERT_EQUAL_HEX16(COLOR_GREEN, getStatusColor("AVAILABLE"));
    
    // Busy states -> Red
    TEST_ASSERT_EQUAL_HEX16(COLOR_RED, getStatusColor("call"));
    TEST_ASSERT_EQUAL_HEX16(COLOR_RED, getStatusColor("meeting"));
    TEST_ASSERT_EQUAL_HEX16(COLOR_DND, getStatusColor("dnd"));
    
    // Away -> Yellow
    TEST_ASSERT_EQUAL_HEX16(COLOR_YELLOW, getStatusColor("away"));
    
    // Special states
    TEST_ASSERT_EQUAL_HEX16(COLOR_PURPLE, getStatusColor("ooo"));
    TEST_ASSERT_EQUAL_HEX16(COLOR_PRESENTING, getStatusColor("presenting"));
    
    // Unknown/offline -> Gray
    TEST_ASSERT_EQUAL_HEX16(COLOR_GRAY, getStatusColor("unknown"));
    TEST_ASSERT_EQUAL_HEX16(COLOR_GRAY, getStatusColor("foobar"));
}

void test_status_text_mapping() {
    // Test key status text outputs
    TEST_ASSERT_EQUAL_STRING("AVAILABLE", getStatusText("active").c_str());
    TEST_ASSERT_EQUAL_STRING("ON A CALL", getStatusText("call").c_str());
    TEST_ASSERT_EQUAL_STRING("IN MEETING", getStatusText("meeting").c_str());
    TEST_ASSERT_EQUAL_STRING("DO NOT DISTURB", getStatusText("dnd").c_str());
    TEST_ASSERT_EQUAL_STRING("AWAY", getStatusText("away").c_str());
    TEST_ASSERT_EQUAL_STRING("OUT OF OFFICE", getStatusText("ooo").c_str());
    TEST_ASSERT_EQUAL_STRING("PRESENTING", getStatusText("presenting").c_str());
    TEST_ASSERT_EQUAL_STRING("LOADING...", getStatusText("pending").c_str());
    TEST_ASSERT_EQUAL_STRING("UNKNOWN", getStatusText("foobar").c_str());
}

// ============================================================================
// DisplayData Structure Tests
// ============================================================================

void test_display_data_defaults() {
    DisplayData data;
    
    TEST_ASSERT_EQUAL_STRING("unknown", data.webex_status.c_str());
    TEST_ASSERT_TRUE(data.display_name.isEmpty());
    TEST_ASSERT_FALSE(data.camera_on);
    TEST_ASSERT_FALSE(data.mic_muted);
    TEST_ASSERT_FALSE(data.in_call);
    TEST_ASSERT_FALSE(data.show_call_status);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, data.temperature);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, data.humidity);
    TEST_ASSERT_EQUAL(0, data.air_quality_index);
    TEST_ASSERT_FALSE(data.show_sensors);
    TEST_ASSERT_TRUE(data.sensor_page_enabled);
    TEST_ASSERT_FALSE(data.wifi_connected);
    TEST_ASSERT_FALSE(data.time_valid);
    TEST_ASSERT_TRUE(data.use_24h);
}

void test_display_data_webex_status_update() {
    DisplayData data;
    
    data.webex_status = "meeting";
    data.display_name = "John Doe";
    data.in_call = true;
    data.camera_on = false;
    data.mic_muted = true;
    
    TEST_ASSERT_EQUAL_STRING("meeting", data.webex_status.c_str());
    TEST_ASSERT_EQUAL_STRING("John Doe", data.display_name.c_str());
    TEST_ASSERT_TRUE(data.in_call);
    TEST_ASSERT_FALSE(data.camera_on);
    TEST_ASSERT_TRUE(data.mic_muted);
}

void test_display_data_sensor_update() {
    DisplayData data;
    
    data.temperature = 22.5f;
    data.humidity = 45.0f;
    data.tvoc = 125.0f;
    data.air_quality_index = 35;
    data.show_sensors = true;
    
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 22.5f, data.temperature);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 45.0f, data.humidity);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 125.0f, data.tvoc);
    TEST_ASSERT_EQUAL(35, data.air_quality_index);
    TEST_ASSERT_TRUE(data.show_sensors);
}

void test_display_data_time_update() {
    DisplayData data;
    
    data.hour = 14;
    data.minute = 30;
    data.day = 28;
    data.month = 1;
    data.time_valid = true;
    data.use_24h = false;
    
    TEST_ASSERT_EQUAL(14, data.hour);
    TEST_ASSERT_EQUAL(30, data.minute);
    TEST_ASSERT_EQUAL(28, data.day);
    TEST_ASSERT_EQUAL(1, data.month);
    TEST_ASSERT_TRUE(data.time_valid);
    TEST_ASSERT_FALSE(data.use_24h);
}

// ============================================================================
// Page Selection Logic Tests
// ============================================================================

DisplayPage selectPage(const DisplayData& data, DisplayPage currentPage, 
                       unsigned long now, unsigned long lastPageChange,
                       unsigned long pageInterval) {
    // In-call overrides page rotation
    if (data.show_call_status && data.in_call) {
        return DisplayPage::IN_CALL;
    }
    
    // Page rotation between status and sensors
    if (data.show_sensors && data.sensor_page_enabled) {
        if (now - lastPageChange >= pageInterval) {
            return (currentPage == DisplayPage::STATUS) 
                ? DisplayPage::SENSORS 
                : DisplayPage::STATUS;
        }
        return currentPage;
    }
    
    // Default to status page
    return DisplayPage::STATUS;
}

void test_page_default_is_status() {
    DisplayData data;
    DisplayPage current = DisplayPage::STATUS;
    
    DisplayPage result = selectPage(data, current, 0, 0, 5000);
    TEST_ASSERT_EQUAL((int)DisplayPage::STATUS, (int)result);
}

void test_page_in_call_override() {
    DisplayData data;
    data.show_call_status = true;
    data.in_call = true;
    data.show_sensors = true;  // Even with sensors, call takes priority
    
    DisplayPage result = selectPage(data, DisplayPage::STATUS, 0, 0, 5000);
    TEST_ASSERT_EQUAL((int)DisplayPage::IN_CALL, (int)result);
}

void test_page_sensor_rotation() {
    DisplayData data;
    data.show_sensors = true;
    data.sensor_page_enabled = true;
    
    // After 5 seconds, should switch from STATUS to SENSORS
    DisplayPage result = selectPage(data, DisplayPage::STATUS, 6000, 0, 5000);
    TEST_ASSERT_EQUAL((int)DisplayPage::SENSORS, (int)result);
}

void test_page_sensor_rotation_back() {
    DisplayData data;
    data.show_sensors = true;
    data.sensor_page_enabled = true;
    
    // After 5 seconds on SENSORS, should switch back to STATUS
    DisplayPage result = selectPage(data, DisplayPage::SENSORS, 6000, 0, 5000);
    TEST_ASSERT_EQUAL((int)DisplayPage::STATUS, (int)result);
}

void test_page_no_rotation_when_disabled() {
    DisplayData data;
    data.show_sensors = true;
    data.sensor_page_enabled = false;  // Disabled
    
    DisplayPage result = selectPage(data, DisplayPage::STATUS, 10000, 0, 5000);
    TEST_ASSERT_EQUAL((int)DisplayPage::STATUS, (int)result);
}

void test_page_stays_on_current_before_interval() {
    DisplayData data;
    data.show_sensors = true;
    data.sensor_page_enabled = true;
    
    // Only 3 seconds passed, should stay on current page
    DisplayPage result = selectPage(data, DisplayPage::STATUS, 3000, 0, 5000);
    TEST_ASSERT_EQUAL((int)DisplayPage::STATUS, (int)result);
}

// ============================================================================
// Time and Date Formatting Tests (Consolidated)
// ============================================================================

String formatTime12(int hour, int minute) {
    int displayHour = hour % 12;
    if (displayHour == 0) displayHour = 12;
    
    String period = (hour < 12) ? "AM" : "PM";
    
    char buf[16];
    snprintf(buf, sizeof(buf), "%d:%02d%s", displayHour, minute, period.c_str());
    return String(buf);
}

String formatTime24(int hour, int minute) {
    char buf[8];
    snprintf(buf, sizeof(buf), "%02d:%02d", hour, minute);
    return String(buf);
}

String getMonthAbbrev(int month) {
    const char* months[] = {
        "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
        "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
    };
    if (month < 1 || month > 12) return "???";
    return months[month - 1];
}

String formatDate(int month, int day, uint8_t format) {
    char buf[16];
    switch (format) {
        case 0:  // mdy - "JAN28"
            snprintf(buf, sizeof(buf), "%s%d", getMonthAbbrev(month).c_str(), day);
            break;
        case 1:  // dmy - "28JAN"
            snprintf(buf, sizeof(buf), "%d%s", day, getMonthAbbrev(month).c_str());
            break;
        case 2:  // numeric - "1/28"
            snprintf(buf, sizeof(buf), "%d/%d", month, day);
            break;
        default:
            return "???";
    }
    return String(buf);
}

void test_time_formatting_12h_and_24h() {
    // 12-hour format tests
    TEST_ASSERT_EQUAL_STRING("9:30AM", formatTime12(9, 30).c_str());
    TEST_ASSERT_EQUAL_STRING("2:30PM", formatTime12(14, 30).c_str());
    TEST_ASSERT_EQUAL_STRING("12:00PM", formatTime12(12, 0).c_str());
    TEST_ASSERT_EQUAL_STRING("12:00AM", formatTime12(0, 0).c_str());
    
    // 24-hour format tests
    TEST_ASSERT_EQUAL_STRING("09:30", formatTime24(9, 30).c_str());
    TEST_ASSERT_EQUAL_STRING("14:30", formatTime24(14, 30).c_str());
}

void test_date_formatting() {
    // Date format variations
    TEST_ASSERT_EQUAL_STRING("JAN28", formatDate(1, 28, 0).c_str());  // MDY
    TEST_ASSERT_EQUAL_STRING("28JAN", formatDate(1, 28, 1).c_str());  // DMY
    TEST_ASSERT_EQUAL_STRING("1/28", formatDate(1, 28, 2).c_str());   // Numeric
    
    // Month abbreviations
    TEST_ASSERT_EQUAL_STRING("JAN", getMonthAbbrev(1).c_str());
    TEST_ASSERT_EQUAL_STRING("DEC", getMonthAbbrev(12).c_str());
    TEST_ASSERT_EQUAL_STRING("???", getMonthAbbrev(13).c_str());
}

void test_temperature_conversion() {
    // Celsius to Fahrenheit conversion
    float celsius = 22.5f;
    int fahrenheit = (int)((celsius * 9.0f / 5.0f) + 32.0f);
    TEST_ASSERT_EQUAL(72, fahrenheit);
    
    // Boundary values
    TEST_ASSERT_EQUAL(32, (int)((0.0f * 9.0f / 5.0f) + 32.0f));    // Freezing
    TEST_ASSERT_EQUAL(212, (int)((100.0f * 9.0f / 5.0f) + 32.0f)); // Boiling
}

// ============================================================================
// Status Integration Tests (Supabase + Display)
// ============================================================================

void test_supabase_status_to_display() {
    // Simulate receiving status from Supabase
    String supabaseStatus = "meeting";
    String supabaseName = "John Doe";
    bool inCall = true;
    bool cameraOn = false;
    bool micMuted = true;
    
    DisplayData data;
    data.webex_status = supabaseStatus;
    data.display_name = supabaseName;
    data.in_call = inCall;
    data.camera_on = cameraOn;
    data.mic_muted = micMuted;
    data.show_call_status = true;
    
    // Verify display would show correct page and color
    TEST_ASSERT_EQUAL_HEX16(COLOR_RED, getStatusColor(data.webex_status));
    TEST_ASSERT_EQUAL_STRING("IN MEETING", getStatusText(data.webex_status).c_str());
    
    DisplayPage page = selectPage(data, DisplayPage::STATUS, 0, 0, 5000);
    TEST_ASSERT_EQUAL((int)DisplayPage::IN_CALL, (int)page);
}

void test_mqtt_sensor_to_display() {
    // Simulate receiving sensor data from MQTT
    float mqttTemp = 22.5f;
    float mqttHumidity = 45.0f;
    float mqttTvoc = 125.0f;
    int mqttIaq = 35;
    
    DisplayData data;
    data.temperature = mqttTemp;
    data.humidity = mqttHumidity;
    data.tvoc = mqttTvoc;
    data.air_quality_index = mqttIaq;
    data.show_sensors = true;
    data.sensor_page_enabled = true;
    
    // Verify sensor data propagated correctly
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 22.5f, data.temperature);
    TEST_ASSERT_TRUE(data.show_sensors);
    
    // Verify page would rotate
    DisplayPage page = selectPage(data, DisplayPage::STATUS, 6000, 0, 5000);
    TEST_ASSERT_EQUAL((int)DisplayPage::SENSORS, (int)page);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_display_data_tests() {
    // Status Color and Text Mapping (consolidated)
    RUN_TEST(test_status_color_mapping);
    RUN_TEST(test_status_text_mapping);
    
    // DisplayData Structure
    RUN_TEST(test_display_data_defaults);
    RUN_TEST(test_display_data_webex_status_update);
    RUN_TEST(test_display_data_sensor_update);
    RUN_TEST(test_display_data_time_update);
    
    // Page Selection
    RUN_TEST(test_page_default_is_status);
    RUN_TEST(test_page_in_call_override);
    RUN_TEST(test_page_sensor_rotation);
    RUN_TEST(test_page_sensor_rotation_back);
    RUN_TEST(test_page_no_rotation_when_disabled);
    RUN_TEST(test_page_stays_on_current_before_interval);
    
    // Time, Date, and Temperature (consolidated)
    RUN_TEST(test_time_formatting_12h_and_24h);
    RUN_TEST(test_date_formatting);
    RUN_TEST(test_temperature_conversion);
    
    // Integration Tests
    RUN_TEST(test_supabase_status_to_display);
    RUN_TEST(test_mqtt_sensor_to_display);
}

#if defined(ARDUINO)
void setup() {
    delay(2000);
    UNITY_BEGIN();
    run_display_data_tests();
    UNITY_END();
}

void loop() {}
#else
int main(int argc, char** argv) {
    UNITY_BEGIN();
    run_display_data_tests();
    return UNITY_END();
}
#endif

#endif // UNIT_TEST
