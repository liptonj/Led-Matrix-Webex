/**
 * @file web_server.cpp
 * @brief Async Web Server Core Implementation
 * 
 * This file contains the core web server functionality:
 * - Server initialization and lifecycle
 * - Captive portal setup
 * - Reboot handling
 * - CORS support
 * 
 * Route registration is split into web_routes.cpp
 * API handlers are split into separate files:
 * - api_status.cpp: Status and configuration handlers
 * - api_wifi.cpp: WiFi scan and save handlers
 * - api_webex.cpp: Webex OAuth handlers
 * - api_ota.cpp: OTA check and update handlers
 * - api_ota_upload.cpp: OTA firmware upload handler
 * - api_embedded.cpp: Embedded app status handlers
 * - api_modules.cpp: Module management handlers
 */

#include "web_server.h"
#include "../display/matrix_display.h"
#include "../core/dependencies.h"
#include "../debug/log_system.h"
#include <WiFi.h>
#include <LittleFS.h>
#include <esp_ota_ops.h>

static const char* TAG = "WEBSERVER";

// DNS port for captive portal
#define DNS_PORT 53

WebServerManager::WebServerManager()
    : server(nullptr), dns_server(nullptr), config_manager(nullptr), app_state(nullptr),
      module_manager(nullptr), running(false), captive_portal_active(false),
      ota_upload_in_progress(false), ota_upload_error(""), ota_upload_size(0),
      ota_bundle_header_filled(0), ota_bundle_mode(false),
      ota_bundle_header_flushed(false), ota_bundle_app_size(0), ota_bundle_fs_size(0),
      ota_bundle_app_written(0), ota_bundle_fs_written(0), ota_bundle_fs_started(false),
      config_body_buffer(""), config_body_expected(0),
      embedded_body_buffer(""), embedded_body_expected(0),
      ota_upload_target(nullptr),
      pending_reboot(false), pending_reboot_time(0), pending_boot_partition(nullptr),
      mdns_manager(nullptr) {
    memset(ota_bundle_header, 0, sizeof(ota_bundle_header));
}

WebServerManager::~WebServerManager() {
    stop();
}

void WebServerManager::stop() {
    if (!running && !server && !dns_server) {
        return;
    }
    
    ESP_LOGI(TAG, "Stopping web server...");
    
    if (server) {
        server->end();
        delete server;
        server = nullptr;
    }
    if (dns_server) {
        dns_server->stop();
        delete dns_server;
        dns_server = nullptr;
    }
    
    // Unmount LittleFS since serveStatic() handlers had references to it
    // This ensures clean state for OTA filesystem flashing
    LittleFS.end();
    
    running = false;
    captive_portal_active = false;
    ESP_LOGI(TAG, "Web server stopped, LittleFS unmounted");
}

void WebServerManager::begin(ConfigManager* config, AppState* state, ModuleManager* modules, MDNSManager* mdns) {
    if (running || server || dns_server) {
        stop();
    }
    config_manager = config;
    app_state = state;
    module_manager = modules;
    mdns_manager = mdns;

    // Initialize LittleFS for dynamic user content (configs, downloads)
    // Static web assets are now embedded in firmware
    if (!LittleFS.begin(true)) {
        ESP_LOGW(TAG, "Failed to mount LittleFS (dynamic content may be unavailable)");
    }

    // Create server on port 80
    server = new AsyncWebServer(80);

    // Setup routes
    setupRoutes();

    // Setup captive portal if AP is active
    setupCaptivePortal();

    // Start server
    server->begin();
    running = true;

    ESP_LOGI(TAG, "Web server started on port 80");
}

void WebServerManager::loop() {
    // AsyncWebServer handles requests automatically
    if (dns_server && captive_portal_active) {
        dns_server->processNextRequest();
    }
}

void WebServerManager::setupCaptivePortal() {
    IPAddress ap_ip = WiFi.softAPIP();
    if (ap_ip == IPAddress(0, 0, 0, 0)) {
        captive_portal_active = false;
        return;
    }

    if (dns_server) {
        dns_server->stop();
        delete dns_server;
        dns_server = nullptr;
    }

    dns_server = new DNSServer();
    if (dns_server->start(DNS_PORT, "*", ap_ip)) {
        captive_portal_active = true;
        ESP_LOGI(TAG, "Captive portal DNS started");
    } else {
        ESP_LOGW(TAG, "Failed to start captive portal DNS");
        delete dns_server;
        dns_server = nullptr;
        captive_portal_active = false;
    }
}

String WebServerManager::buildRedirectUri() const {
    return "http://webex-display.local/oauth/callback";
}

bool WebServerManager::checkPendingReboot() {
    if (!pending_reboot) {
        return false;
    }
    
    // Fix millis() wraparound: use signed comparison for time deltas
    unsigned long now = millis();
    if ((long)(now - pending_reboot_time) < 0) {
        return false;
    }
    
    ESP_LOGI(TAG, "Executing pending reboot...");
    
    // Clear display before reboot to prevent DMA corruption
    // The display uses I2S DMA which can leave garbage on screen if not properly cleared
    auto& deps = getDependencies();
    deps.display.clear();
    delay(50);  // Allow display DMA to complete the clear operation
    
    // Set boot partition if specified
    if (pending_boot_partition) {
        esp_err_t err = esp_ota_set_boot_partition(pending_boot_partition);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Failed to set boot partition: %s", esp_err_to_name(err));
        } else {
            ESP_LOGI(TAG, "Boot partition set to: %s", pending_boot_partition->label);
        }
    }
    
    delay(100);  // Brief delay for serial output
    ESP.restart();
    return true;  // Won't reach here
}

String WebServerManager::getContentType(const String& filename) {
    if (filename.endsWith(".html")) return "text/html";
    if (filename.endsWith(".css")) return "text/css";
    if (filename.endsWith(".js")) return "application/javascript";
    if (filename.endsWith(".json")) return "application/json";
    if (filename.endsWith(".ico")) return "image/x-icon";
    if (filename.endsWith(".png")) return "image/png";
    if (filename.endsWith(".svg")) return "image/svg+xml";
    return "text/plain";
}

// ============================================================
// CORS Support for Cloud-Hosted Embedded App
// ============================================================
//
// SECURITY NOTE: CORS is configured to allow any origin (Access-Control-Allow-Origin: *)
// This is a known limitation documented in SECURITY_FIXES_APPLIED.md.
//
// Why "*" is required - origins that access this device:
// - Cloud: app.webex.com (embedded app), display.5ls.us, *.supabase.co
// - Local IPs: 192.168.x.x, 10.x.x.x, 172.16-31.x.x (RFC1918 private ranges)
// - mDNS: webex-display.local or user-configured *.local names
// - AP Mode: Browser accessing 192.168.4.1 (captive portal)
// - Dev: localhost:3000, 127.0.0.1:3000
// - ESP Web Tools: unpkg.com, jsdelivr.net, or self-hosted
//
// Mitigations:
// - All sensitive endpoints require X-API-Key header authentication
// - API token is a randomly-generated 32-character hex string
// - Devices are on local networks, not internet-exposed
// - Sensitive data in /api/status is gated behind authentication
//
// ============================================================

bool WebServerManager::isAuthenticated(AsyncWebServerRequest* request) {
    // Skip authentication in AP mode (bootstrapping)
    wifi_mode_t mode = WiFi.getMode();
    if (mode & WIFI_AP) {
        return true;  // No auth required in AP mode
    }
    
    // Get API token from ConfigManager
    String expected_token = config_manager->getApiToken();
    if (expected_token.isEmpty()) {
        return false;  // No token configured
    }
    
    // Check X-API-Key header
    if (request->hasHeader("X-API-Key")) {
        String provided_token = request->header("X-API-Key");
        if (provided_token == expected_token) {
            return true;
        }
    }
    
    // Query parameter authentication removed for security:
    // Tokens in URLs can be logged in server logs, browser history, and referrer headers.
    // Only header-based authentication (X-API-Key) is supported.
    
    return false;
}

void WebServerManager::addCorsHeaders(AsyncWebServerResponse* response) {
    // Allow requests from any origin - see SECURITY NOTE above for justification
    response->addHeader("Access-Control-Allow-Origin", "*");
    response->addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-API-Key");
    response->addHeader("Access-Control-Max-Age", "86400");  // Cache preflight for 24 hours
}

void WebServerManager::handleCorsPreflightRequest(AsyncWebServerRequest* request) {
    AsyncWebServerResponse* response = request->beginResponse(204);
    addCorsHeaders(response);
    request->send(response);
}
