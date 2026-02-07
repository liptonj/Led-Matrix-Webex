/**
 * @file loop_heap.cpp
 * @brief Heap monitoring and recovery handlers
 *
 * Handles heap trend monitoring, low heap detection, and recovery actions.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

#include "esp_heap_caps.h"
#include "supabase/supabase_realtime.h"
#include "../core/dependencies.h"
#include "../debug/log_system.h"

static const char* TAG = "HEAP";

// =============================================================================
// HEAP TREND MONITOR IMPLEMENTATION
// =============================================================================

void HeapTrendMonitor::sample(unsigned long now) {
    if (now - last_sample < kSampleIntervalMs) {
        return;
    }
    last_sample = now;
    free_samples[index] = ESP.getFreeHeap();
    block_samples[index] = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    index = (index + 1) % kSamples;
    if (count < kSamples) {
        count++;
    }
}

void HeapTrendMonitor::logIfTrending(unsigned long now) {
    if (count < kSamples || now - last_log < 30000) {
        return;
    }

    bool free_dropping = true;
    bool block_dropping = true;
    uint32_t prev_free = free_samples[(index + kSamples - count) % kSamples];
    uint32_t prev_block = block_samples[(index + kSamples - count) % kSamples];
    for (uint8_t i = 1; i < count; i++) {
        uint8_t idx = (index + kSamples - count + i) % kSamples;
        uint32_t cur_free = free_samples[idx];
        uint32_t cur_block = block_samples[idx];
        if (cur_free + 256 >= prev_free) {
            free_dropping = false;
        }
        if (cur_block + 256 >= prev_block) {
            block_dropping = false;
        }
        prev_free = cur_free;
        prev_block = cur_block;
    }

    if (free_dropping || block_dropping) {
        last_log = now;
        ESP_LOGW(TAG, "Trend warning: free%s block%s (last=%u block=%u)",
                 free_dropping ? "↓" : "-",
                 block_dropping ? "↓" : "-",
                 free_samples[(index + kSamples - 1) % kSamples],
                 block_samples[(index + kSamples - 1) % kSamples]);
    }
}

// =============================================================================
// HEAP UTILITY FUNCTIONS
// =============================================================================

void logHeapStatus(const char* label) {
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t minHeap = ESP.getMinFreeHeap();
    // Log both internal (for TLS operations) and total (includes PSRAM) for complete diagnostics
    uint32_t largestInternal = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
    uint32_t largestTotal = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    ESP_LOGI(TAG, "%s free=%u min=%u largest_internal=%u largest_total=%u",
             label, freeHeap, minHeap, largestInternal, largestTotal);
}

bool hasSafeTlsHeap(uint32_t min_free, uint32_t min_block) {
    // TLS requires contiguous internal RAM (not PSRAM) for DMA operations
    // MALLOC_CAP_INTERNAL excludes PSRAM, ensuring we check actual internal SRAM availability
    return ESP.getFreeHeap() >= min_free &&
           heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL) >= min_block;
}

void handleLowHeapRecovery(LoopContext& ctx) {
    static unsigned long lowHeapSince = 0;
    static unsigned long lastRecovery = 0;
    const uint32_t freeHeap = ESP.getFreeHeap();
    // TLS/HTTPS operations require contiguous internal RAM, not PSRAM
    // Use MALLOC_CAP_INTERNAL to detect actual internal SRAM fragmentation
    const uint32_t largestBlock = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
    const uint32_t kLowHeapFree = 50000;    // Increased from 40000
    const uint32_t kLowHeapBlock = 30000;   // Increased from 25000
    const uint32_t kCriticalFree = 40000;   // Increased from 32000
    const unsigned long kLowHeapDuration = 10000;  // Reduced from 15000 (react faster)
    const unsigned long kCriticalDuration = 2000;  // Reduced from 3000 (react faster)
    const unsigned long kRecoveryCooldown = 30000;

    const bool lowHeap = (freeHeap < kLowHeapFree || largestBlock < kLowHeapBlock);
    const bool criticalHeap = (freeHeap < kCriticalFree);

    if (lowHeap) {
        if (lowHeapSince == 0) {
            lowHeapSince = ctx.current_time;
        }
        const unsigned long duration = ctx.current_time - lowHeapSince;
        if (((duration >= kLowHeapDuration) || (criticalHeap && duration >= kCriticalDuration)) &&
            ctx.current_time - lastRecovery >= kRecoveryCooldown) {
            lastRecovery = ctx.current_time;
            ESP_LOGW(TAG, "Low heap recovery triggered (free=%u block=%u)",
                     freeHeap, largestBlock);
            // Disconnect realtime to free heap
            auto& deps = getDependencies();
            deps.realtime.disconnect();
            ctx.app_state->realtime_defer_until = ctx.current_time + 60000UL;
            ESP_LOGI(TAG, "Freed realtime connection to recover heap");
        }
        return;
    }

    lowHeapSince = 0;
}

void handleHeapMonitoring(LoopContext& ctx, HeapTrendMonitor& heap_trend) {
    static uint32_t last_min_heap_logged = 0;
    uint32_t min_heap = ESP.getMinFreeHeap();
    if (last_min_heap_logged == 0 || min_heap < last_min_heap_logged) {
        last_min_heap_logged = min_heap;
        logHeapStatus("min_free_heap");
    }
    handleLowHeapRecovery(ctx);
    heap_trend.sample(ctx.current_time);
    heap_trend.logIfTrending(ctx.current_time);
}

#endif // !NATIVE_BUILD
