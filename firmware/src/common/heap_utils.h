/**
 * @file heap_utils.h
 * @brief Shared heap monitoring utilities
 * 
 * Consolidates heap checking patterns used throughout the firmware.
 * Provides consistent thresholds and checking functions for memory management.
 */

#pragma once

#include <Arduino.h>

#ifndef NATIVE_BUILD
#include <esp_heap_caps.h>
#endif

namespace HeapUtils {

// Recommended heap thresholds (based on existing code patterns)
constexpr uint32_t HEAP_MIN_FOR_TLS = 45000;        // From supabase_realtime.cpp
constexpr uint32_t HEAP_MIN_FOR_WEBSOCKET = 50000;  // From realtime operations
constexpr uint32_t HEAP_MIN_FOR_OTA = 80000;        // From OTA operations
constexpr uint32_t HEAP_CRITICAL = 20000;           // Emergency threshold
constexpr uint32_t HEAP_WARNING = 30000;            // Warning threshold

// Block size requirements
constexpr uint32_t BLOCK_MIN_FOR_TLS = 16384;      // Minimum contiguous block for TLS
constexpr uint32_t BLOCK_MIN_FOR_WEBSOCKET = 16384; // Minimum contiguous block for WebSocket

#ifdef NATIVE_BUILD
// Mock implementations for native test environment
inline bool hasMinimumHeap(uint32_t required) {
    (void)required;
    return true;
}

inline bool hasMinimumHeapWithBlock(uint32_t required, uint32_t minBlock) {
    (void)required;
    (void)minBlock;
    return true;
}

inline bool hasMinimumHeapWithInternalBlock(uint32_t minFree, uint32_t minBlock) {
    (void)minFree;
    (void)minBlock;
    return true;
}

inline bool hasSafeHeapForTls() {
    return true;
}

inline bool hasSafeHeapForWebSocket() {
    return true;
}

inline bool hasSafeHeapForOta() {
    return true;
}

inline bool isHeapCritical() {
    return false;
}

inline bool isHeapLow() {
    return false;
}

inline uint32_t getFreeHeap() {
    return 100000; // Mock value
}

inline uint32_t getMaxAllocBlock() {
    return 50000; // Mock value
}

inline uint32_t getMaxAllocInternalBlock() {
    return 30000; // Mock value
}

inline void logHeapStatus(const char* context) {
    (void)context;
    Serial.printf("[HEAP] %s: free=100000, max_block=50000 (mock)\n", context);
}

#else
// Real implementations for ESP32

/**
 * @brief Check if enough heap is available
 * @param required Minimum free heap bytes required
 * @return true if heap has at least required bytes free
 */
inline bool hasMinimumHeap(uint32_t required) {
    return ESP.getFreeHeap() >= required;
}

/**
 * @brief Check heap with largest block requirement
 * @param required Minimum free heap bytes required
 * @param minBlock Minimum largest contiguous block required (uses MALLOC_CAP_8BIT for total heap)
 * @return true if both heap and block requirements are met
 */
inline bool hasMinimumHeapWithBlock(uint32_t required, uint32_t minBlock) {
    return ESP.getFreeHeap() >= required && 
           heap_caps_get_largest_free_block(MALLOC_CAP_8BIT) >= minBlock;
}

/**
 * @brief Check heap for TLS operations (requires internal RAM)
 * @param minFree Minimum free heap bytes required
 * @param minBlock Minimum largest contiguous block in internal RAM required
 * @return true if heap is safe for TLS operations
 */
inline bool hasMinimumHeapWithInternalBlock(uint32_t minFree, uint32_t minBlock) {
    return ESP.getFreeHeap() >= minFree &&
           heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL) >= minBlock;
}

/**
 * @brief Convenience function: Check if heap is safe for TLS operations
 * Uses internal RAM check (MALLOC_CAP_INTERNAL) as TLS requires DMA-capable memory
 * @return true if heap is safe for TLS operations
 */
inline bool hasSafeHeapForTls() {
    return hasMinimumHeapWithInternalBlock(HEAP_MIN_FOR_TLS, BLOCK_MIN_FOR_TLS);
}

/**
 * @brief Convenience function: Check if heap is safe for WebSocket operations
 * @return true if heap is safe for WebSocket operations
 */
inline bool hasSafeHeapForWebSocket() {
    return hasMinimumHeapWithBlock(HEAP_MIN_FOR_WEBSOCKET, BLOCK_MIN_FOR_WEBSOCKET);
}

/**
 * @brief Convenience function: Check if heap is safe for OTA operations
 * @return true if heap is safe for OTA operations
 */
inline bool hasSafeHeapForOta() {
    return hasMinimumHeap(HEAP_MIN_FOR_OTA);
}

/**
 * @brief Check if heap is at critical level
 * @return true if free heap is below critical threshold
 */
inline bool isHeapCritical() {
    return ESP.getFreeHeap() < HEAP_CRITICAL;
}

/**
 * @brief Check if heap is low (warning level)
 * @return true if free heap is below warning threshold
 */
inline bool isHeapLow() {
    return ESP.getFreeHeap() < HEAP_WARNING;
}

/**
 * @brief Get current free heap
 * @return Free heap in bytes
 */
inline uint32_t getFreeHeap() {
    return ESP.getFreeHeap();
}

/**
 * @brief Get maximum allocatable block size (total heap)
 * @return Largest free block in bytes (MALLOC_CAP_8BIT)
 */
inline uint32_t getMaxAllocBlock() {
    return heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
}

/**
 * @brief Get maximum allocatable block size in internal RAM
 * @return Largest free block in internal RAM (MALLOC_CAP_INTERNAL)
 */
inline uint32_t getMaxAllocInternalBlock() {
    return heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
}

/**
 * @brief Log heap status with context
 * @param context Context string for logging (e.g., "before TLS", "after OTA")
 */
inline void logHeapStatus(const char* context) {
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t maxBlock = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    uint32_t maxInternalBlock = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
    Serial.printf("[HEAP] %s: free=%u, max_block=%u, max_internal_block=%u\n",
        context, freeHeap, maxBlock, maxInternalBlock);
}

#endif // NATIVE_BUILD

/**
 * @brief Log heap status remotely (for remote logging)
 * @param context Context string for logging
 * 
 * @note This function requires RemoteLogger to be initialized.
 * It's declared here but implemented separately to avoid circular dependencies.
 */
void logHeapStatusRemote(const char* context);

} // namespace HeapUtils
