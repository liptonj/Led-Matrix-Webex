#pragma once

#include <stddef.h>

// Reduce TLS buffer sizes where supported to lower heap pressure.
template <typename T>
static inline auto configureSecureClientBuffers(T& client, size_t rx, size_t tx, int)
    -> decltype(client.setBufferSizes(rx, tx), void()) {
    client.setBufferSizes(rx, tx);
}

template <typename T>
static inline void configureSecureClientBuffers(T&, size_t, size_t, long) {}

template <typename T>
static inline void configureSecureClient(T& client, size_t rx = 4096, size_t tx = 4096) {
    configureSecureClientBuffers(client, rx, tx, 0);
}

/**
 * @brief Configure secure client with TLS verification
 * 
 * Consolidates the common pattern of:
 * 1. Setting buffer sizes (configureSecureClient)
 * 2. Conditionally setting CA cert or setInsecure based on config
 * 
 * This eliminates duplicate TLS setup code across 8+ files.
 * 
 * @param client WiFiClientSecure instance
 * @param caCert CA certificate bundle to use when TLS verification is enabled
 * @param verifyTls Whether to verify TLS (true = use caCert, false = setInsecure)
 * @param rx Receive buffer size (default 4096)
 * @param tx Transmit buffer size (default 4096)
 */
template <typename T>
static inline void configureSecureClientWithTls(T& client, const char* caCert, 
                                                bool verifyTls, size_t rx = 4096, size_t tx = 4096) {
    configureSecureClientBuffers(client, rx, tx, 0);
    if (verifyTls) {
        client.setCACert(caCert);
    } else {
        client.setInsecure();
    }
}
