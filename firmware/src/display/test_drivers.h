/**
 * @file test_drivers.h
 * @brief Driver test configurations for troubleshooting display
 * 
 * Uncomment ONE driver at a time to test
 */

#ifndef TEST_DRIVERS_H
#define TEST_DRIVERS_H

// Uncomment ONE of these to test different drivers:

// #define TEST_DRIVER_SHIFTREG    // Generic shift register (default)
#define TEST_DRIVER_FM6126A     // Very common in 64x32 panels
// #define TEST_DRIVER_ICN2038S    // Also common
// #define TEST_DRIVER_MBI5124     // Used in some panels
// #define TEST_DRIVER_FM6047      // Less common
// #define TEST_DRIVER_SM5266P     // Newer panels

#endif // TEST_DRIVERS_H
