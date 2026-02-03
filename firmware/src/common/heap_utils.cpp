/**
 * @file heap_utils.cpp
 * @brief Implementation of heap utilities remote logging
 */

#include "heap_utils.h"

#ifndef NATIVE_BUILD
#include "../debug/remote_logger.h"
#include <esp_heap_caps.h>

namespace HeapUtils {

void logHeapStatusRemote(const char* context) {
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t maxBlock = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    uint32_t maxInternalBlock = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
    uint32_t minFreeHeap = ESP.getMinFreeHeap();
    
    remoteLogger.info("HEAP", "%s: free=%u, max_block=%u, max_internal_block=%u, min_free=%u",
        context, freeHeap, maxBlock, maxInternalBlock, minFreeHeap);
}

} // namespace HeapUtils

#else
// Native build: stub implementation
namespace HeapUtils {

void logHeapStatusRemote(const char* context) {
    (void)context;
    // No-op for native builds
}

} // namespace HeapUtils

#endif // NATIVE_BUILD
