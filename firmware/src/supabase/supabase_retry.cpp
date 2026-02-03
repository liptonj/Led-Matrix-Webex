/**
 * @file supabase_retry.cpp
 * @brief Supabase Client Retry Logic Implementation
 * 
 * Handles retry logic with exponential backoff for HTTP requests.
 */

#include "supabase_client.h"
#include "../debug/remote_logger.h"

int SupabaseClient::makeRequestWithRetry(const String& endpoint, const String& method,
                                         const String& body, String& response) {
    // REGRESSION FIX: Implement proper retry with exponential backoff for TLS/network errors
    // Uses SUPABASE_MAX_RETRIES and SUPABASE_RETRY_DELAY_MS from header
    
    // Minimum heap required for TLS operations (internal RAM needed for DMA)
    constexpr uint32_t MIN_HEAP_FOR_TLS = 50000;
    constexpr uint32_t MIN_BLOCK_FOR_TLS = 30000;
    
    int httpCode = 0;
    int retryCount = 0;
    unsigned long retryDelayMs = SUPABASE_RETRY_DELAY_MS;
    
    while (retryCount < SUPABASE_MAX_RETRIES) {
        // Check heap before attempting request (except first try)
        if (retryCount > 0) {
            uint32_t freeHeap = ESP.getFreeHeap();
            uint32_t maxBlock = ESP.getMaxAllocHeap();
            
            if (freeHeap < MIN_HEAP_FOR_TLS || maxBlock < MIN_BLOCK_FOR_TLS) {
                Serial.printf("[SUPABASE] Retry %d/%d skipped - low heap: %lu free, %lu block\n",
                             retryCount + 1, SUPABASE_MAX_RETRIES, 
                             (unsigned long)freeHeap, (unsigned long)maxBlock);
                // Wait and let memory stabilize
                delay(retryDelayMs);
                retryDelayMs = min(retryDelayMs * 2, 10000UL);  // Cap at 10 seconds
                retryCount++;
                continue;
            }
            
            Serial.printf("[SUPABASE] Retry %d/%d after %lums delay (heap=%lu)\n",
                         retryCount + 1, SUPABASE_MAX_RETRIES, 
                         retryDelayMs, (unsigned long)freeHeap);
        }
        
        httpCode = makeRequest(endpoint, method, body, response, false);
        
        // Rate limited - don't retry
        if (httpCode == -2) {
            return httpCode;
        }
        
        // Success or non-retryable server error
        if (httpCode >= 200 && httpCode < 500 && httpCode != 401) {
            return httpCode;
        }
        
        // Handle 401 by re-authenticating
        if (httpCode == 401) {
            Serial.println("[SUPABASE] Token expired, re-authenticating...");
            invalidateToken();
            if (ensureAuthenticated()) {
                // Retry with new token
                httpCode = makeRequest(endpoint, method, body, response, false);
                if (httpCode >= 200 && httpCode < 500) {
                    return httpCode;
                }
            }
        }
        
        // Handle TLS/network errors (negative HTTP codes)
        // -11 = HTTPC_ERROR_READ_TIMEOUT (the main issue we're fixing)
        // -1 to -10 = Other connection errors
        if (httpCode < 0) {
            const char* errorDesc = "unknown";
            switch (httpCode) {
                case -1: errorDesc = "connection_refused"; break;
                case -2: errorDesc = "send_header_failed"; break;
                case -3: errorDesc = "send_payload_failed"; break;
                case -4: errorDesc = "not_connected"; break;
                case -5: errorDesc = "connection_lost"; break;
                case -6: errorDesc = "no_stream"; break;
                case -7: errorDesc = "no_http_server"; break;
                case -8: errorDesc = "too_less_ram"; break;
                case -9: errorDesc = "encoding"; break;
                case -10: errorDesc = "stream_write"; break;
                case -11: errorDesc = "read_timeout"; break;
            }
            
            Serial.printf("[SUPABASE] %s failed: HTTP %d (%s) on attempt %d/%d\n",
                         endpoint.c_str(), httpCode, errorDesc, 
                         retryCount + 1, SUPABASE_MAX_RETRIES);
            
            // For low RAM error, wait longer
            if (httpCode == -8) {
                retryDelayMs = max(retryDelayMs, 5000UL);
            }
            
            // Wait before retry with exponential backoff
            if (retryCount + 1 < SUPABASE_MAX_RETRIES) {
                delay(retryDelayMs);
                retryDelayMs = min(retryDelayMs * 2, 10000UL);  // Cap at 10 seconds
            }
        }
        
        // Handle 5xx server errors with retry
        if (httpCode >= 500) {
            Serial.printf("[SUPABASE] %s server error: HTTP %d on attempt %d/%d\n",
                         endpoint.c_str(), httpCode, retryCount + 1, SUPABASE_MAX_RETRIES);
            
            if (retryCount + 1 < SUPABASE_MAX_RETRIES) {
                delay(retryDelayMs);
                retryDelayMs = min(retryDelayMs * 2, 10000UL);
            }
        }
        
        retryCount++;
    }
    
    // All retries exhausted
    if (httpCode < 0 || httpCode >= 500) {
        Serial.printf("[SUPABASE] %s failed after %d retries: HTTP %d\n",
                     endpoint.c_str(), SUPABASE_MAX_RETRIES, httpCode);
    }
    
    return httpCode;
}
