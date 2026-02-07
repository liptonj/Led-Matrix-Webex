/**
 * @file device_credentials.cpp
 * @brief Device Authentication Credentials Implementation
 */

#include "device_credentials.h"
#include "common/nvs_utils.h"
#include "../debug/log_system.h"
#include <time.h>

static const char* TAG = "AUTH";

#ifndef NATIVE_BUILD
#include <esp_random.h>
#include <rom/crc.h>
#include <mbedtls/sha256.h>
#include <mbedtls/md.h>
#include <mbedtls/base64.h>
#else
// Mock implementations for native builds
#include <cstring>
#include <cstdlib>
#endif

// NVS namespace for device credentials (must match exactly for backward compatibility)
static const char* CREDS_NVS_NAMESPACE = "device_auth";
static const char* CREDS_NVS_KEY_SECRET = "secret";

// Global instance
DeviceCredentials deviceCredentials;

DeviceCredentials::DeviceCredentials()
    : _provisioned(false) {
    memset(_secret, 0, DEVICE_SECRET_SIZE);
}

DeviceCredentials::~DeviceCredentials() {
    clearSecret();
}

bool DeviceCredentials::begin() {
    ESP_LOGI(TAG, "Initializing device credentials...");

    // First, compute serial number from eFuse MAC (always available)
    computeSerialNumber();
    ESP_LOGI(TAG, "Device serial: %s", _serialNumber.c_str());

    // Try to load existing secret from NVS
    if (loadSecretFromNVS()) {
        ESP_LOGI(TAG, "Loaded existing secret from NVS");
        computeKeyHash();
        _provisioned = true;
        return true;
    }

    // No existing secret - generate a new one
    ESP_LOGI(TAG, "Generating new device secret...");
    generateSecret();

    // Save to NVS
    if (!saveSecretToNVS()) {
        ESP_LOGE(TAG, "Failed to save secret to NVS");
        clearSecret();
        return false;
    }

    // Compute key hash for Supabase registration
    computeKeyHash();

    ESP_LOGI(TAG, "New secret generated and saved");
    ESP_LOGI(TAG, "Key hash: %s...", _keyHash.substring(0, 16).c_str());

    _provisioned = true;
    return true;
}

void DeviceCredentials::generateSecret() {
#ifndef NATIVE_BUILD
    // Use hardware RNG for cryptographic randomness
    esp_fill_random(_secret, DEVICE_SECRET_SIZE);
#else
    // For native builds, use stdlib random (not secure, but works for testing)
    for (int i = 0; i < DEVICE_SECRET_SIZE; i++) {
        _secret[i] = rand() & 0xFF;
    }
#endif
}

bool DeviceCredentials::loadSecretFromNVS() {
    NvsScope nvs(CREDS_NVS_NAMESPACE, true);  // Read-only
    if (!nvs.isOpen()) {
        return false;
    }

    size_t len = nvs.getBytesLength(CREDS_NVS_KEY_SECRET);
    if (len != DEVICE_SECRET_SIZE) {
        return false;
    }

    size_t readLen = nvs.getBytes(CREDS_NVS_KEY_SECRET, _secret, DEVICE_SECRET_SIZE);
    return readLen == DEVICE_SECRET_SIZE;
}

bool DeviceCredentials::saveSecretToNVS() {
    NvsScope nvs(CREDS_NVS_NAMESPACE);  // Read-write
    if (!nvs.isOpen()) {
        return false;
    }

    NvsResult result = nvs.putBytes(CREDS_NVS_KEY_SECRET, _secret, DEVICE_SECRET_SIZE);
    return result == NvsResult::OK;
}

void DeviceCredentials::computeSerialNumber() {
#ifndef NATIVE_BUILD
    // Get eFuse MAC address (unique per device)
    uint64_t mac = ESP.getEfuseMac();

    // Convert to byte array for CRC32
    uint8_t macBytes[6];
    macBytes[0] = (mac >> 0) & 0xFF;
    macBytes[1] = (mac >> 8) & 0xFF;
    macBytes[2] = (mac >> 16) & 0xFF;
    macBytes[3] = (mac >> 24) & 0xFF;
    macBytes[4] = (mac >> 32) & 0xFF;
    macBytes[5] = (mac >> 40) & 0xFF;

    // Compute CRC32 of MAC
    uint32_t crc = crc32_le(0, macBytes, 6);

    // Format as 8 uppercase hex characters
    char serial[9];
    snprintf(serial, sizeof(serial), "%08X", crc);
    _serialNumber = String(serial);
#else
    // For native builds, use a placeholder
    _serialNumber = "XXXXXXXX";
#endif
}

void DeviceCredentials::computeKeyHash() {
#ifndef NATIVE_BUILD
    // Compute SHA256 of the secret
    uint8_t hash[32];
    mbedtls_sha256(_secret, DEVICE_SECRET_SIZE, hash, 0);  // 0 = SHA256 (not SHA224)

    // Convert to hex string
    char hexHash[65];
    for (int i = 0; i < 32; i++) {
        snprintf(&hexHash[i * 2], 3, "%02x", hash[i]);
    }
    hexHash[64] = '\0';
    _keyHash = String(hexHash);
#else
    _keyHash = String("mock_key_hash_for_testing_only_0000000000000000000000");
#endif
}

String DeviceCredentials::sha256Hex(const String& data) {
#ifndef NATIVE_BUILD
    uint8_t hash[32];
    mbedtls_sha256((const uint8_t*)data.c_str(), data.length(), hash, 0);

    char hexHash[65];
    for (int i = 0; i < 32; i++) {
        snprintf(&hexHash[i * 2], 3, "%02x", hash[i]);
    }
    hexHash[64] = '\0';
    return String(hexHash);
#else
    return String("mock_sha256_hash");
#endif
}

String DeviceCredentials::signRequest(uint32_t timestamp, const String& body) {
    if (!_provisioned) {
        ESP_LOGE(TAG, "Cannot sign - not provisioned");
        return "";
    }

#ifndef NATIVE_BUILD
    // Compute SHA256 of body
    String bodyHash = sha256Hex(body);

    // Build message: serial:timestamp:bodyHash
    String message = _serialNumber + ":" + String(timestamp) + ":" + bodyHash;

    // HMAC-SHA256 using EVP-style multi-step API (replaces deprecated mbedtls_md_hmac)
    uint8_t hmacResult[32];
    mbedtls_md_context_t ctx;
    int ret;

    mbedtls_md_init(&ctx);

    const mbedtls_md_info_t* mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (mdInfo == nullptr) {
        ESP_LOGE(TAG, "SHA256 not available");
        return "";
    }

    ret = mbedtls_md_setup(&ctx, mdInfo, 1);  // 1 = use HMAC
    if (ret != 0) {
        ESP_LOGE(TAG, "HMAC setup failed: %d", ret);
        mbedtls_md_free(&ctx);
        return "";
    }

    ret = mbedtls_md_hmac_starts(&ctx, (const uint8_t*)_keyHash.c_str(), _keyHash.length());
    if (ret != 0) {
        ESP_LOGE(TAG, "HMAC starts failed: %d", ret);
        mbedtls_md_free(&ctx);
        return "";
    }

    ret = mbedtls_md_hmac_update(&ctx, (const uint8_t*)message.c_str(), message.length());
    if (ret != 0) {
        ESP_LOGE(TAG, "HMAC update failed: %d", ret);
        mbedtls_md_free(&ctx);
        return "";
    }

    ret = mbedtls_md_hmac_finish(&ctx, hmacResult);
    if (ret != 0) {
        ESP_LOGE(TAG, "HMAC finish failed: %d", ret);
        mbedtls_md_free(&ctx);
        return "";
    }

    mbedtls_md_free(&ctx);

    // Base64 encode the result
    unsigned char base64[64];
    size_t base64Len;

    ret = mbedtls_base64_encode(base64, sizeof(base64), &base64Len, hmacResult, 32);
    if (ret != 0) {
        ESP_LOGE(TAG, "Base64 encoding failed: %d", ret);
        return "";
    }

    return String((char*)base64, base64Len);
#else
    return String("mock_signature");
#endif
}

uint32_t DeviceCredentials::getTimestamp() {
    time_t now;
    time(&now);
    return (uint32_t)now;
}

String DeviceCredentials::getDeviceId() const {
    // Format: webex-display-XXXX (last 4 chars of serial)
    String suffix = _serialNumber.substring(4);  // Last 4 chars of 8-char serial
    return "webex-display-" + suffix;
}

bool DeviceCredentials::resetCredentials() {
    NvsScope nvs(CREDS_NVS_NAMESPACE);
    if (!nvs.isOpen()) {
        return false;
    }

    NvsResult result = nvs.clear();
    if (result != NvsResult::OK) {
        return false;
    }

    clearSecret();
    _provisioned = false;
    _keyHash = "";

    ESP_LOGI(TAG, "Credentials reset - will regenerate on next boot");
    return true;
}

void DeviceCredentials::clearSecret() {
    // Securely clear secret from memory
    memset(_secret, 0, DEVICE_SECRET_SIZE);
}
