/**
 * @file api_mdns.cpp
 * @brief mDNS API handlers
 */

#include "web_server.h"
#include "../discovery/mdns_manager.h"
#include <ArduinoJson.h>
#include <WiFi.h>

void WebServerManager::handleMdnsRestart(AsyncWebServerRequest* request) {
    JsonDocument doc;

    if (!mdns_manager) {
        doc["success"] = false;
        doc["error"] = "mDNS manager not available";
        String response;
        serializeJson(doc, response);
        request->send(500, "application/json", response);
        return;
    }

    if (WiFi.status() != WL_CONNECTED) {
        doc["success"] = false;
        doc["error"] = "WiFi not connected";
        String response;
        serializeJson(doc, response);
        request->send(409, "application/json", response);
        return;
    }

    mdns_manager->end();
    if (!mdns_manager->begin(config_manager->getDeviceName())) {
        doc["success"] = false;
        doc["error"] = "mDNS restart failed";
        String response;
        serializeJson(doc, response);
        request->send(500, "application/json", response);
        return;
    }

    mdns_manager->advertiseHTTP(80);
    doc["success"] = true;
    doc["hostname"] = mdns_manager->getHostname();
    doc["ip_address"] = WiFi.localIP().toString();

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}
