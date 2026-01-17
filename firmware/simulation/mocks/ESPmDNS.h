/**
 * @file ESPmDNS.h
 * @brief Mock ESP32 mDNS for native simulation
 */

#ifndef ESP_MDNS_H
#define ESP_MDNS_H

#include <vector>
#include "Arduino.h"

class MDNSResponder {
public:
    bool begin(const char* hostname) {
        _hostname = hostname;
        printf("[mDNS] Started with hostname '%s.local'\n", hostname);
        return true;
    }

    void end() {
        printf("[mDNS] Stopped\n");
    }

    bool addService(const char* service, const char* proto, uint16_t port) {
        printf("[mDNS] Added service %s.%s on port %d\n", service, proto, port);
        return true;
    }

    bool addServiceTxt(const char* service, const char* proto, const char* key, const char* value) {
        printf("[mDNS] Added TXT record %s=%s for %s.%s\n", key, value, service, proto);
        return true;
    }

    int queryService(const char* service, const char* proto) {
        printf("[mDNS] Query for %s.%s (simulated: 0 results)\n", service, proto);
        _queryResults.clear();
        // Simulate finding a bridge service for testing
        if (String(service) == "_webex-bridge") {
            printf("[mDNS] Simulating bridge discovery\n");
            QueryResult result;
            result.hostname = "bridge-server";
            result.ip = IPAddress(192, 168, 1, 50);
            result.port = 8080;
            _queryResults.push_back(result);
            return 1;
        }
        return 0;
    }

    String hostname(int idx) {
        if (idx < static_cast<int>(_queryResults.size())) {
            return _queryResults[idx].hostname;
        }
        return "";
    }

    IPAddress IP(int idx) {
        if (idx < static_cast<int>(_queryResults.size())) {
            return _queryResults[idx].ip;
        }
        return IPAddress(0, 0, 0, 0);
    }

    uint16_t port(int idx) {
        if (idx < static_cast<int>(_queryResults.size())) {
            return _queryResults[idx].port;
        }
        return 0;
    }

    String txt(int idx, const char* key) {
        return "";
    }

    void update() {}

private:
    String _hostname;

    struct QueryResult {
        String hostname;
        IPAddress ip;
        uint16_t port;
    };
    std::vector<QueryResult> _queryResults;
};

extern MDNSResponder MDNS;

#endif // ESP_MDNS_H
