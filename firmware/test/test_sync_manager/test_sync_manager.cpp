/**
 * @file test_sync_manager.cpp
 * @brief Unit tests for Sync Manager timing logic
 *
 * Tests verify sync timing calculations, interval management, and edge cases.
 * These are logic tests that don't require the full sync_manager implementation.
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>

// ============================================================================
// Sync Timing Calculations (Standalone Logic Tests)
// ============================================================================

/**
 * @brief Calculate if sync is due based on last sync time and interval
 */
bool isSyncDue(unsigned long lastSyncTime, unsigned long currentTime, unsigned long interval) {
    // Handle millis() wraparound
    unsigned long elapsed;
    if (currentTime >= lastSyncTime) {
        elapsed = currentTime - lastSyncTime;
    } else {
        // Wraparound occurred
        elapsed = (0xFFFFFFFF - lastSyncTime) + currentTime + 1;
    }
    return elapsed >= interval;
}

/**
 * @brief Calculate next sync time
 */
unsigned long getNextSyncTime(unsigned long lastSyncTime, unsigned long interval) {
    return lastSyncTime + interval;
}

// ============================================================================
// Test Sync Interval Calculations
// ============================================================================

void test_sync_interval_30_seconds() {
    const unsigned long HEARTBEAT_INTERVAL = 30000;
    unsigned long lastSync = 0;
    
    // Not due at 29 seconds
    TEST_ASSERT_FALSE(isSyncDue(lastSync, 29000, HEARTBEAT_INTERVAL));
    
    // Due at 30 seconds
    TEST_ASSERT_TRUE(isSyncDue(lastSync, 30000, HEARTBEAT_INTERVAL));
    
    // Due after 30 seconds
    TEST_ASSERT_TRUE(isSyncDue(lastSync, 35000, HEARTBEAT_INTERVAL));
}

void test_sync_interval_60_seconds() {
    const unsigned long FULL_SYNC_INTERVAL = 60000;
    unsigned long lastSync = 0;
    
    // Not due at 59 seconds
    TEST_ASSERT_FALSE(isSyncDue(lastSync, 59000, FULL_SYNC_INTERVAL));
    
    // Due at 60 seconds
    TEST_ASSERT_TRUE(isSyncDue(lastSync, 60000, FULL_SYNC_INTERVAL));
}

void test_next_sync_time_calculation() {
    unsigned long lastSync = 10000;
    unsigned long interval = 30000;
    
    unsigned long nextSync = getNextSyncTime(lastSync, interval);
    
    TEST_ASSERT_EQUAL(40000, nextSync);
}

// ============================================================================
// Test Millis Wraparound Handling
// ============================================================================

void test_millis_wraparound_detection() {
    // Test wraparound from max uint32 to 0
    unsigned long beforeWrap = 0xFFFFFFFF - 5000; // 5 seconds before wrap
    unsigned long afterWrap = 5000; // 5 seconds after wrap
    unsigned long interval = 30000;
    
    // 10 seconds elapsed total, should not be due yet
    TEST_ASSERT_FALSE(isSyncDue(beforeWrap, afterWrap, interval));
}

void test_millis_wraparound_sync_due() {
    // Test sync becomes due across wraparound
    unsigned long beforeWrap = 0xFFFFFFFF - 10000; // 10 seconds before wrap
    unsigned long afterWrap = 25000; // 25 seconds after wrap
    unsigned long interval = 30000;
    
    // 35 seconds elapsed total, should be due
    TEST_ASSERT_TRUE(isSyncDue(beforeWrap, afterWrap, interval));
}

void test_exact_wraparound_point() {
    // Test at exact wraparound point
    unsigned long beforeWrap = 0xFFFFFFFF;
    unsigned long afterWrap = 0;
    unsigned long interval = 1;
    
    // 1ms elapsed, should be due for 1ms interval
    TEST_ASSERT_TRUE(isSyncDue(beforeWrap, afterWrap, interval));
}

// ============================================================================
// Test Multiple Sync Cycles
// ============================================================================

void test_successive_sync_intervals() {
    const unsigned long INTERVAL = 30000;
    unsigned long lastSync = 0;
    
    // First sync at 30s
    TEST_ASSERT_TRUE(isSyncDue(lastSync, 30000, INTERVAL));
    lastSync = 30000;
    
    // Not due immediately after
    TEST_ASSERT_FALSE(isSyncDue(lastSync, 30100, INTERVAL));
    
    // Second sync at 60s
    TEST_ASSERT_TRUE(isSyncDue(lastSync, 60000, INTERVAL));
    lastSync = 60000;
    
    // Third sync at 90s
    TEST_ASSERT_TRUE(isSyncDue(lastSync, 90000, INTERVAL));
}

void test_sync_with_variable_delays() {
    const unsigned long INTERVAL = 30000;
    unsigned long lastSync = 0;
    
    // Sync happens at 31s (1s late)
    TEST_ASSERT_TRUE(isSyncDue(lastSync, 31000, INTERVAL));
    lastSync = 31000;
    
    // Next sync should be 30s from new base (61s)
    TEST_ASSERT_FALSE(isSyncDue(lastSync, 60000, INTERVAL));
    TEST_ASSERT_TRUE(isSyncDue(lastSync, 61000, INTERVAL));
}

// ============================================================================
// Test Edge Cases
// ============================================================================

void test_sync_at_time_zero() {
    unsigned long lastSync = 0;
    unsigned long currentTime = 0;
    unsigned long interval = 30000;
    
    // At time=0, sync should not be due
    TEST_ASSERT_FALSE(isSyncDue(lastSync, currentTime, interval));
}

void test_sync_with_very_small_interval() {
    unsigned long lastSync = 0;
    unsigned long interval = 100; // 100ms
    
    TEST_ASSERT_FALSE(isSyncDue(lastSync, 99, interval));
    TEST_ASSERT_TRUE(isSyncDue(lastSync, 100, interval));
}

void test_sync_with_large_interval() {
    unsigned long lastSync = 0;
    unsigned long interval = 3600000; // 1 hour
    
    TEST_ASSERT_FALSE(isSyncDue(lastSync, 3599999, interval));
    TEST_ASSERT_TRUE(isSyncDue(lastSync, 3600000, interval));
}

void test_same_time_not_due() {
    unsigned long time = 10000;
    unsigned long interval = 30000;
    
    // Same time means 0 elapsed - not due
    TEST_ASSERT_FALSE(isSyncDue(time, time, interval));
}

void test_backward_time_travel() {
    // Current time is before last sync (shouldn't happen but handle gracefully)
    unsigned long lastSync = 50000;
    unsigned long currentTime = 40000;
    unsigned long interval = 30000;
    
    // This appears as a large elapsed time due to unsigned math
    // Should be treated as due
    TEST_ASSERT_TRUE(isSyncDue(lastSync, currentTime, interval));
}

// ============================================================================
// Test Timing Precision
// ============================================================================

void test_sync_boundary_conditions() {
    const unsigned long INTERVAL = 30000;
    unsigned long lastSync = 0;
    
    // Just before - not due
    TEST_ASSERT_FALSE(isSyncDue(lastSync, INTERVAL - 1, INTERVAL));
    
    // Exactly at - due
    TEST_ASSERT_TRUE(isSyncDue(lastSync, INTERVAL, INTERVAL));
    
    // Just after - due
    TEST_ASSERT_TRUE(isSyncDue(lastSync, INTERVAL + 1, INTERVAL));
}

void test_sync_intervals_do_not_drift() {
    // Verify that syncs maintain consistent intervals
    const unsigned long INTERVAL = 30000;
    unsigned long lastSync = 1000;
    
    // First sync due at 31000
    unsigned long firstDue = getNextSyncTime(lastSync, INTERVAL);
    TEST_ASSERT_EQUAL(31000, firstDue);
    
    // Second sync due at 61000
    unsigned long secondDue = getNextSyncTime(firstDue, INTERVAL);
    TEST_ASSERT_EQUAL(61000, secondDue);
    
    // Third sync due at 91000
    unsigned long thirdDue = getNextSyncTime(secondDue, INTERVAL);
    TEST_ASSERT_EQUAL(91000, thirdDue);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_sync_manager_tests() {
    UNITY_BEGIN();
    
    // Sync Interval Tests
    RUN_TEST(test_sync_interval_30_seconds);
    RUN_TEST(test_sync_interval_60_seconds);
    RUN_TEST(test_next_sync_time_calculation);
    
    // Millis Wraparound Tests
    RUN_TEST(test_millis_wraparound_detection);
    RUN_TEST(test_millis_wraparound_sync_due);
    RUN_TEST(test_exact_wraparound_point);
    
    // Multiple Cycle Tests
    RUN_TEST(test_successive_sync_intervals);
    RUN_TEST(test_sync_with_variable_delays);
    
    // Edge Case Tests
    RUN_TEST(test_sync_at_time_zero);
    RUN_TEST(test_sync_with_very_small_interval);
    RUN_TEST(test_sync_with_large_interval);
    RUN_TEST(test_same_time_not_due);
    RUN_TEST(test_backward_time_travel);
    
    // Precision Tests
    RUN_TEST(test_sync_boundary_conditions);
    RUN_TEST(test_sync_intervals_do_not_drift);
    
    UNITY_END();
}

#ifdef NATIVE_BUILD
// Native build uses main()
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    run_sync_manager_tests();
    return 0;
}
#else
// Arduino build uses setup()/loop()
void setup() {
    delay(2000);  // Wait for serial monitor
    run_sync_manager_tests();
}

void loop() {
    // Nothing to do
}
#endif

#endif // UNIT_TEST
