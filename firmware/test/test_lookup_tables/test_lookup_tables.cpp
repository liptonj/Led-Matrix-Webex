/**
 * @file test_lookup_tables.cpp
 * @brief Unit tests for Lookup Tables
 *
 * Tests verify that all lookup tables return correct values and handle
 * edge cases properly. These tests ensure the lookup tables behave
 * identically to the if-else chains they replaced.
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <cstring>
#include <string>

// Include the lookup tables header directly
#include "../../src/common/lookup_tables.h"

// Stub Arduino String class for testing (minimal implementation)
#ifndef Arduino_h
class String {
public:
    String() : data("") {}
    String(const char* s) : data(s ? s : "") {}
    const char* c_str() const { return data.c_str(); }
    bool isEmpty() const { return data.empty(); }
private:
    std::string data;
};
#endif

// ============================================================================
// StatusLookup Tests
// ============================================================================

void test_status_color_active() {
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_ACTIVE, 
                            StatusLookup::getStatusColor("active"));
}

void test_status_color_away() {
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_AWAY, 
                            StatusLookup::getStatusColor("away"));
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_AWAY, 
                            StatusLookup::getStatusColor("inactive"));
}

void test_status_color_dnd() {
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_DND, 
                            StatusLookup::getStatusColor("dnd"));
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_DND, 
                            StatusLookup::getStatusColor("DoNotDisturb"));
}

void test_status_color_busy() {
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_BUSY, 
                            StatusLookup::getStatusColor("busy"));
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_BUSY, 
                            StatusLookup::getStatusColor("meeting"));
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_BUSY, 
                            StatusLookup::getStatusColor("call"));
}

void test_status_color_presenting() {
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_PRESENTING, 
                            StatusLookup::getStatusColor("presenting"));
}

void test_status_color_ooo() {
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_OOO, 
                            StatusLookup::getStatusColor("ooo"));
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_OOO, 
                            StatusLookup::getStatusColor("OutOfOffice"));
}

void test_status_color_offline() {
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_OFFLINE, 
                            StatusLookup::getStatusColor("offline"));
}

void test_status_color_unknown() {
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_UNKNOWN, 
                            StatusLookup::getStatusColor("foobar"));
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_UNKNOWN, 
                            StatusLookup::getStatusColor("random_status"));
}

void test_status_color_empty() {
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_OFFLINE, 
                            StatusLookup::getStatusColor(""));
}

void test_status_color_null() {
    TEST_ASSERT_EQUAL_HEX16(StatusLookup::STATUS_COLOR_OFFLINE, 
                            StatusLookup::getStatusColor(nullptr));
}

// Status text tests
void test_status_text_active() {
    TEST_ASSERT_EQUAL_STRING("AVAILABLE", StatusLookup::getStatusText("active"));
}

void test_status_text_away() {
    TEST_ASSERT_EQUAL_STRING("AWAY", StatusLookup::getStatusText("away"));
    TEST_ASSERT_EQUAL_STRING("AWAY", StatusLookup::getStatusText("inactive"));
}

void test_status_text_dnd() {
    TEST_ASSERT_EQUAL_STRING("DO NOT DISTURB", StatusLookup::getStatusText("dnd"));
    TEST_ASSERT_EQUAL_STRING("DO NOT DISTURB", StatusLookup::getStatusText("DoNotDisturb"));
}

void test_status_text_call() {
    TEST_ASSERT_EQUAL_STRING("IN A CALL", StatusLookup::getStatusText("meeting"));
    TEST_ASSERT_EQUAL_STRING("ON A CALL", StatusLookup::getStatusText("call"));
    TEST_ASSERT_EQUAL_STRING("BUSY", StatusLookup::getStatusText("busy"));
}

void test_status_text_presenting() {
    TEST_ASSERT_EQUAL_STRING("PRESENTING", StatusLookup::getStatusText("presenting"));
}

void test_status_text_ooo() {
    TEST_ASSERT_EQUAL_STRING("OUT OF OFFICE", StatusLookup::getStatusText("ooo"));
    TEST_ASSERT_EQUAL_STRING("OUT OF OFFICE", StatusLookup::getStatusText("OutOfOffice"));
}

void test_status_text_unknown() {
    // Unknown status returns the original string
    TEST_ASSERT_EQUAL_STRING("foobar", StatusLookup::getStatusText("foobar"));
}

void test_status_text_null() {
    TEST_ASSERT_EQUAL_STRING("OFFLINE", StatusLookup::getStatusText(nullptr));
}

// ============================================================================
// MonthLookup Tests
// ============================================================================

void test_month_abbrev_all() {
    TEST_ASSERT_EQUAL_STRING("JAN", MonthLookup::getAbbrev(1));
    TEST_ASSERT_EQUAL_STRING("FEB", MonthLookup::getAbbrev(2));
    TEST_ASSERT_EQUAL_STRING("MAR", MonthLookup::getAbbrev(3));
    TEST_ASSERT_EQUAL_STRING("APR", MonthLookup::getAbbrev(4));
    TEST_ASSERT_EQUAL_STRING("MAY", MonthLookup::getAbbrev(5));
    TEST_ASSERT_EQUAL_STRING("JUN", MonthLookup::getAbbrev(6));
    TEST_ASSERT_EQUAL_STRING("JUL", MonthLookup::getAbbrev(7));
    TEST_ASSERT_EQUAL_STRING("AUG", MonthLookup::getAbbrev(8));
    TEST_ASSERT_EQUAL_STRING("SEP", MonthLookup::getAbbrev(9));
    TEST_ASSERT_EQUAL_STRING("OCT", MonthLookup::getAbbrev(10));
    TEST_ASSERT_EQUAL_STRING("NOV", MonthLookup::getAbbrev(11));
    TEST_ASSERT_EQUAL_STRING("DEC", MonthLookup::getAbbrev(12));
}

void test_month_abbrev_invalid() {
    TEST_ASSERT_EQUAL_STRING("???", MonthLookup::getAbbrev(0));
    TEST_ASSERT_EQUAL_STRING("???", MonthLookup::getAbbrev(13));
    TEST_ASSERT_EQUAL_STRING("???", MonthLookup::getAbbrev(-1));
    TEST_ASSERT_EQUAL_STRING("???", MonthLookup::getAbbrev(100));
}

// ============================================================================
// OTALookup Tests
// ============================================================================

void test_ota_update_type_full() {
    TEST_ASSERT_EQUAL(OTALookup::UpdateType::FULL_IMAGE, 
                      OTALookup::getUpdateType("full"));
}

void test_ota_update_type_compressed() {
    TEST_ASSERT_EQUAL(OTALookup::UpdateType::COMPRESSED, 
                      OTALookup::getUpdateType("compressed"));
}

void test_ota_update_type_delta() {
    TEST_ASSERT_EQUAL(OTALookup::UpdateType::DELTA_PATCH, 
                      OTALookup::getUpdateType("delta"));
}

void test_ota_update_type_module() {
    TEST_ASSERT_EQUAL(OTALookup::UpdateType::MODULE_ONLY, 
                      OTALookup::getUpdateType("module"));
}

void test_ota_update_type_invalid() {
    TEST_ASSERT_EQUAL(OTALookup::UpdateType::INVALID, 
                      OTALookup::getUpdateType("unknown"));
    TEST_ASSERT_EQUAL(OTALookup::UpdateType::INVALID, 
                      OTALookup::getUpdateType("foobar"));
    TEST_ASSERT_EQUAL(OTALookup::UpdateType::INVALID, 
                      OTALookup::getUpdateType(nullptr));
}

void test_variant_modules_embedded() {
    TEST_ASSERT_EQUAL_HEX8(0x21, OTALookup::getVariantModules("embedded"));
}

void test_variant_modules_standard() {
    TEST_ASSERT_EQUAL_HEX8(0x23, OTALookup::getVariantModules("standard"));
}

void test_variant_modules_sensors() {
    TEST_ASSERT_EQUAL_HEX8(0x25, OTALookup::getVariantModules("sensors"));
}

void test_variant_modules_full() {
    TEST_ASSERT_EQUAL_HEX8(0x37, OTALookup::getVariantModules("full"));
}

void test_variant_modules_unknown() {
    TEST_ASSERT_EQUAL_HEX8(OTALookup::DEFAULT_MODULE_MASK, 
                           OTALookup::getVariantModules("unknown"));
    TEST_ASSERT_EQUAL_HEX8(OTALookup::DEFAULT_MODULE_MASK, 
                           OTALookup::getVariantModules(nullptr));
}

// ============================================================================
// EmbeddedStatusLookup Tests
// ============================================================================

void test_embedded_status_active() {
    auto result = EmbeddedStatusLookup::normalize("active");
    TEST_ASSERT_EQUAL_STRING("active", result.status);
    TEST_ASSERT_FALSE(result.sets_in_call);
    TEST_ASSERT_TRUE(result.found);
}

void test_embedded_status_available() {
    auto result = EmbeddedStatusLookup::normalize("available");
    TEST_ASSERT_EQUAL_STRING("active", result.status);
    TEST_ASSERT_FALSE(result.sets_in_call);
    TEST_ASSERT_TRUE(result.found);
}

void test_embedded_status_away() {
    auto result = EmbeddedStatusLookup::normalize("away");
    TEST_ASSERT_EQUAL_STRING("away", result.status);
    TEST_ASSERT_FALSE(result.sets_in_call);
    TEST_ASSERT_TRUE(result.found);
}

void test_embedded_status_dnd_variants() {
    auto result1 = EmbeddedStatusLookup::normalize("dnd");
    TEST_ASSERT_EQUAL_STRING("dnd", result1.status);
    TEST_ASSERT_TRUE(result1.found);
    
    auto result2 = EmbeddedStatusLookup::normalize("donotdisturb");
    TEST_ASSERT_EQUAL_STRING("dnd", result2.status);
    TEST_ASSERT_TRUE(result2.found);
    
    auto result3 = EmbeddedStatusLookup::normalize("DoNotDisturb");
    TEST_ASSERT_EQUAL_STRING("dnd", result3.status);
    TEST_ASSERT_TRUE(result3.found);
}

void test_embedded_status_presenting() {
    auto result = EmbeddedStatusLookup::normalize("presenting");
    TEST_ASSERT_EQUAL_STRING("presenting", result.status);
    TEST_ASSERT_TRUE(result.sets_in_call);
    TEST_ASSERT_TRUE(result.found);
}

void test_embedded_status_call() {
    auto result = EmbeddedStatusLookup::normalize("call");
    TEST_ASSERT_EQUAL_STRING("call", result.status);
    TEST_ASSERT_TRUE(result.sets_in_call);
    TEST_ASSERT_TRUE(result.found);
}

void test_embedded_status_meeting() {
    auto result = EmbeddedStatusLookup::normalize("meeting");
    TEST_ASSERT_EQUAL_STRING("meeting", result.status);
    TEST_ASSERT_TRUE(result.sets_in_call);
    TEST_ASSERT_TRUE(result.found);
}

void test_embedded_status_busy() {
    auto result = EmbeddedStatusLookup::normalize("busy");
    TEST_ASSERT_EQUAL_STRING("meeting", result.status);
    TEST_ASSERT_TRUE(result.sets_in_call);
    TEST_ASSERT_TRUE(result.found);
}

void test_embedded_status_ooo_variants() {
    auto result1 = EmbeddedStatusLookup::normalize("ooo");
    TEST_ASSERT_EQUAL_STRING("ooo", result1.status);
    TEST_ASSERT_TRUE(result1.found);
    
    auto result2 = EmbeddedStatusLookup::normalize("outofoffice");
    TEST_ASSERT_EQUAL_STRING("ooo", result2.status);
    TEST_ASSERT_TRUE(result2.found);
    
    auto result3 = EmbeddedStatusLookup::normalize("OutOfOffice");
    TEST_ASSERT_EQUAL_STRING("ooo", result3.status);
    TEST_ASSERT_TRUE(result3.found);
}

void test_embedded_status_unknown() {
    auto result = EmbeddedStatusLookup::normalize("foobar");
    TEST_ASSERT_EQUAL_STRING("foobar", result.status);  // Returns input as-is
    TEST_ASSERT_FALSE(result.sets_in_call);
    TEST_ASSERT_FALSE(result.found);
}

void test_embedded_status_null() {
    auto result = EmbeddedStatusLookup::normalize(nullptr);
    TEST_ASSERT_EQUAL_STRING("unknown", result.status);
    TEST_ASSERT_FALSE(result.sets_in_call);
    TEST_ASSERT_FALSE(result.found);
}

// ============================================================================
// DateFormatLookup Tests
// ============================================================================

void test_date_format_mdy() {
    TEST_ASSERT_EQUAL_UINT8(0, DateFormatLookup::getFormatCode("mdy"));
    TEST_ASSERT_EQUAL_UINT8(0, DateFormatLookup::getFormatCode("default"));
}

void test_date_format_dmy() {
    TEST_ASSERT_EQUAL_UINT8(1, DateFormatLookup::getFormatCode("dmy"));
    TEST_ASSERT_EQUAL_UINT8(1, DateFormatLookup::getFormatCode("dd/mm"));
    TEST_ASSERT_EQUAL_UINT8(1, DateFormatLookup::getFormatCode("dd-mm"));
}

void test_date_format_numeric() {
    TEST_ASSERT_EQUAL_UINT8(2, DateFormatLookup::getFormatCode("numeric"));
    TEST_ASSERT_EQUAL_UINT8(2, DateFormatLookup::getFormatCode("num"));
    TEST_ASSERT_EQUAL_UINT8(2, DateFormatLookup::getFormatCode("mm/dd"));
    TEST_ASSERT_EQUAL_UINT8(2, DateFormatLookup::getFormatCode("mm-dd"));
}

void test_date_format_unknown() {
    TEST_ASSERT_EQUAL_UINT8(0, DateFormatLookup::getFormatCode("foobar"));
    TEST_ASSERT_EQUAL_UINT8(0, DateFormatLookup::getFormatCode(nullptr));
}

// ============================================================================
// TimeFormatLookup Tests
// ============================================================================

void test_time_format_12h() {
    TEST_ASSERT_TRUE(TimeFormatLookup::is12HourFormat("12h"));
    TEST_ASSERT_TRUE(TimeFormatLookup::is12HourFormat("12"));
    TEST_ASSERT_TRUE(TimeFormatLookup::is12HourFormat("am/pm"));
    TEST_ASSERT_TRUE(TimeFormatLookup::is12HourFormat("ampm"));
}

void test_time_format_24h() {
    TEST_ASSERT_FALSE(TimeFormatLookup::is12HourFormat("24h"));
    TEST_ASSERT_FALSE(TimeFormatLookup::is12HourFormat("24"));
    TEST_ASSERT_FALSE(TimeFormatLookup::is12HourFormat(""));
    TEST_ASSERT_FALSE(TimeFormatLookup::is12HourFormat(nullptr));
}

// ============================================================================
// Test Runner
// ============================================================================

void setup() {
    UNITY_BEGIN();
    
    // StatusLookup Color Tests
    RUN_TEST(test_status_color_active);
    RUN_TEST(test_status_color_away);
    RUN_TEST(test_status_color_dnd);
    RUN_TEST(test_status_color_busy);
    RUN_TEST(test_status_color_presenting);
    RUN_TEST(test_status_color_ooo);
    RUN_TEST(test_status_color_offline);
    RUN_TEST(test_status_color_unknown);
    RUN_TEST(test_status_color_empty);
    RUN_TEST(test_status_color_null);
    
    // StatusLookup Text Tests
    RUN_TEST(test_status_text_active);
    RUN_TEST(test_status_text_away);
    RUN_TEST(test_status_text_dnd);
    RUN_TEST(test_status_text_call);
    RUN_TEST(test_status_text_presenting);
    RUN_TEST(test_status_text_ooo);
    RUN_TEST(test_status_text_unknown);
    RUN_TEST(test_status_text_null);
    
    // MonthLookup Tests
    RUN_TEST(test_month_abbrev_all);
    RUN_TEST(test_month_abbrev_invalid);
    
    // OTALookup Tests
    RUN_TEST(test_ota_update_type_full);
    RUN_TEST(test_ota_update_type_compressed);
    RUN_TEST(test_ota_update_type_delta);
    RUN_TEST(test_ota_update_type_module);
    RUN_TEST(test_ota_update_type_invalid);
    RUN_TEST(test_variant_modules_embedded);
    RUN_TEST(test_variant_modules_standard);
    RUN_TEST(test_variant_modules_sensors);
    RUN_TEST(test_variant_modules_full);
    RUN_TEST(test_variant_modules_unknown);
    
    // EmbeddedStatusLookup Tests
    RUN_TEST(test_embedded_status_active);
    RUN_TEST(test_embedded_status_available);
    RUN_TEST(test_embedded_status_away);
    RUN_TEST(test_embedded_status_dnd_variants);
    RUN_TEST(test_embedded_status_presenting);
    RUN_TEST(test_embedded_status_call);
    RUN_TEST(test_embedded_status_meeting);
    RUN_TEST(test_embedded_status_busy);
    RUN_TEST(test_embedded_status_ooo_variants);
    RUN_TEST(test_embedded_status_unknown);
    RUN_TEST(test_embedded_status_null);
    
    // DateFormatLookup Tests
    RUN_TEST(test_date_format_mdy);
    RUN_TEST(test_date_format_dmy);
    RUN_TEST(test_date_format_numeric);
    RUN_TEST(test_date_format_unknown);
    
    // TimeFormatLookup Tests
    RUN_TEST(test_time_format_12h);
    RUN_TEST(test_time_format_24h);
    
    UNITY_END();
}

void loop() {
    // Empty
}

int main(int argc, char** argv) {
    setup();
    return 0;
}

#endif // UNIT_TEST
