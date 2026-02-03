/**
 * @file WiFiClientSecure.h
 * @brief Mock WiFiClientSecure for native simulation
 */

#ifndef WIFICLIENTSECURE_H
#define WIFICLIENTSECURE_H

#include "WiFiClient.h"

/**
 * @brief Mock WiFiClientSecure for native simulation
 * 
 * Extends WiFiClient with TLS-related methods.
 */
class WiFiClientSecure : public WiFiClient {
public:
    WiFiClientSecure() : WiFiClient(), _insecure(false) {}
    virtual ~WiFiClientSecure() = default;
    
    // Connection methods with timeout
    bool connect(const char* host, uint16_t port, int32_t timeout) {
        return WiFiClient::connect(host, port);
    }
    
    // TLS configuration
    void setInsecure() { 
        _insecure = true; 
        printf("[WiFiClientSecure] SSL certificate verification disabled\n");
    }
    
    void setCACert(const char* rootCA) { 
        _ca_cert = rootCA; 
        _insecure = false;
        printf("[WiFiClientSecure] CA certificate set\n");
    }
    
    void setCertificate(const char* client_ca) { _client_cert = client_ca; }
    void setPrivateKey(const char* private_key) { _private_key = private_key; }
    
    // For testing
    void setMockConnectSuccess(bool success) { setConnected(success); }
    bool isInsecure() const { return _insecure; }
    const char* getCACert() const { return _ca_cert; }
    
private:
    bool _insecure;
    const char* _ca_cert = nullptr;
    const char* _client_cert = nullptr;
    const char* _private_key = nullptr;
};

#endif // WIFICLIENTSECURE_H
