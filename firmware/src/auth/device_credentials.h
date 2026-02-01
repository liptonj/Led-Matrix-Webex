/**
 * @file device_credentials.h
 * @brief Device Authentication Credentials Manager
 *
 * Manages device secret storage (eFuse or NVS), serial number generation,
 * and HMAC-SHA256 request signing for Supabase authentication.
 */

#ifndef DEVICE_CREDENTIALS_H
#define DEVICE_CREDENTIALS_H

#include <Arduino.h>

// Device secret size (32 bytes = 256 bits)
#define DEVICE_SECRET_SIZE 32

// Serial number length (8 hex characters from CRC32)
#define DEVICE_SERIAL_LENGTH 8

/**
 * @brief Device Credentials Manager
 *
 * Handles:
 * - Device secret generation and secure storage (NVS with eFuse option)
 * - Serial number generation from eFuse MAC (CRC32 format)
 * - Key hash computation (SHA256 of secret for Supabase storage)
 * - HMAC-SHA256 request signing for authenticated API calls
 */
class DeviceCredentials {
public:
    DeviceCredentials();
    ~DeviceCredentials();

    /**
     * @brief Initialize credentials (load or generate)
     * @return true if credentials are ready
     */
    bool begin();

    /**
     * @brief Check if device has been provisioned (secret exists)
     * @return true if secret is loaded/generated
     */
    bool isProvisioned() const { return _provisioned; }

    /**
     * @brief Get device serial number (8-char CRC32 of eFuse MAC)
     * @return Serial number string
     */
    String getSerialNumber() const { return _serialNumber; }

    /**
     * @brief Get key hash (SHA256 of device secret, hex encoded)
     * Used for Supabase device registration
     * @return Key hash string (64 hex characters)
     */
    String getKeyHash() const { return _keyHash; }

    /**
     * @brief Sign a request with HMAC-SHA256
     *
     * Computes HMAC-SHA256(message, key_hash) where:
     * message = serial + ":" + timestamp + ":" + sha256(body)
     *
     * @param timestamp Unix timestamp (seconds)
     * @param body Request body (empty string for GET requests)
     * @return Base64-encoded signature
     */
    String signRequest(uint32_t timestamp, const String& body = "");

    /**
     * @brief Get current timestamp for request signing
     * @return Unix timestamp in seconds
     */
    static uint32_t getTimestamp();

    /**
     * @brief Compute SHA256 hash of data
     * @param data Input data
     * @return Hex-encoded hash (64 characters)
     */
    static String sha256Hex(const String& data);

    /**
     * @brief Get device ID in standard format (webex-display-XXXX)
     * @return Device ID string
     */
    String getDeviceId() const;

    /**
     * @brief Factory reset credentials (if not eFuse burned)
     * @return true if reset successful
     */
    bool resetCredentials();

private:
    bool _provisioned;
    String _serialNumber;
    String _keyHash;
    uint8_t _secret[DEVICE_SECRET_SIZE];

    /**
     * @brief Generate new random secret
     */
    void generateSecret();

    /**
     * @brief Load secret from NVS
     * @return true if loaded successfully
     */
    bool loadSecretFromNVS();

    /**
     * @brief Save secret to NVS
     * @return true if saved successfully
     */
    bool saveSecretToNVS();

    /**
     * @brief Compute serial number from eFuse MAC using CRC32
     */
    void computeSerialNumber();

    /**
     * @brief Compute key hash from secret
     */
    void computeKeyHash();

    /**
     * @brief Clear secret from memory
     */
    void clearSecret();
};

// Global instance
extern DeviceCredentials deviceCredentials;

#endif // DEVICE_CREDENTIALS_H
