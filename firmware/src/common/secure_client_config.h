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
