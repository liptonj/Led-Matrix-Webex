#pragma once

// Prefer WebSocketsClient::setInsecure when available, otherwise fall back to
// setCACert(nullptr) if supported, else no-op.
template <typename T>
static inline auto wsSetInsecure(T& client, int) -> decltype(client.setInsecure(), void()) {
    client.setInsecure();
}

template <typename T>
static inline auto wsSetInsecure(T& client, long) -> decltype(client.setCACert(nullptr), void()) {
    client.setCACert(nullptr);
}

template <typename T>
static inline void wsSetInsecure(T&, ...) {}
