/**
 * @file test_ota_retry.cpp
 * @brief Unit tests for OTA retry logic
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>

// ESP mock is already provided by simulation/mocks/Arduino.h
// No need to redefine here

// Include after mocks
#include "../src/ota/ota_helpers.h"

void setUp() {
    // Run before each test
}

void tearDown() {
    // Run after each test
}

// Test shouldRetry() returns true for partial downloads
void test_should_retry_partial_download() {
    TEST_ASSERT_TRUE(OTAHelpers::shouldRetry(1000, 2000));  // 50%
    TEST_ASSERT_TRUE(OTAHelpers::shouldRetry(1, 1000));     // Minimal progress
    TEST_ASSERT_TRUE(OTAHelpers::shouldRetry(999, 1000));   // 99.9%
}

// Test shouldRetry() returns false for zero bytes (connection failed)
void test_should_not_retry_zero_bytes() {
    TEST_ASSERT_FALSE(OTAHelpers::shouldRetry(0, 2000));
    TEST_ASSERT_FALSE(OTAHelpers::shouldRetry(0, 0));
}

// Test shouldRetry() returns false for complete download
void test_should_not_retry_complete() {
    TEST_ASSERT_FALSE(OTAHelpers::shouldRetry(2000, 2000));
    TEST_ASSERT_FALSE(OTAHelpers::shouldRetry(1000, 1000));
}

// Test getRetryDelay() exponential backoff
void test_retry_delay_exponential() {
    TEST_ASSERT_EQUAL(2000, OTAHelpers::getRetryDelay(0));   // 2s
    TEST_ASSERT_EQUAL(4000, OTAHelpers::getRetryDelay(1));   // 4s
    TEST_ASSERT_EQUAL(8000, OTAHelpers::getRetryDelay(2));   // 8s
}

// Test getRetryDelay() caps at MAX_RETRY_DELAY_MS
void test_retry_delay_capped() {
    TEST_ASSERT_EQUAL(15000, OTAHelpers::getRetryDelay(3));  // Capped at 15s
    TEST_ASSERT_EQUAL(15000, OTAHelpers::getRetryDelay(10)); // Still capped
}

// Test retry constants are defined correctly
void test_retry_constants() {
    TEST_ASSERT_EQUAL(3, OTAHelpers::MAX_RETRY_ATTEMPTS);
    TEST_ASSERT_EQUAL(2000, OTAHelpers::INITIAL_RETRY_DELAY_MS);
    TEST_ASSERT_EQUAL(15000, OTAHelpers::MAX_RETRY_DELAY_MS);
}

#ifdef NATIVE_BUILD
int main(int argc, char **argv) {
    UNITY_BEGIN();
    
    RUN_TEST(test_should_retry_partial_download);
    RUN_TEST(test_should_not_retry_zero_bytes);
    RUN_TEST(test_should_not_retry_complete);
    RUN_TEST(test_retry_delay_exponential);
    RUN_TEST(test_retry_delay_capped);
    RUN_TEST(test_retry_constants);
    
    return UNITY_END();
}
#else
void setup() {
    delay(2000);  // Give time for serial monitor
    UNITY_BEGIN();
    
    RUN_TEST(test_should_retry_partial_download);
    RUN_TEST(test_should_not_retry_zero_bytes);
    RUN_TEST(test_should_not_retry_complete);
    RUN_TEST(test_retry_delay_exponential);
    RUN_TEST(test_retry_delay_capped);
    RUN_TEST(test_retry_constants);
    
    UNITY_END();
}

void loop() {
    // Empty - tests run once in setup()
}
#endif

#endif  // UNIT_TEST
