/**
 * @file improv_handler.cpp
 * @brief Improv Wi-Fi Serial Protocol Handler Implementation
 */

#include "improv_handler.h"
#include "../display/matrix_display.h"
#include "../common/board_utils.h"
#include "../debug/log_system.h"
#include <WiFi.h>

static const char* TAG = "IMPROV";

// Static instance for callbacks
ImprovHandler* ImprovHandler::instance = nullptr;

// Global instance
ImprovHandler improv_handler;

ImprovHandler::ImprovHandler()
    : improv(nullptr),
      config_manager(nullptr),
      app_state(nullptr),
      matrix_display(nullptr),
      provisioning_active(false),
      configured_via_improv(false),
      initialized(false) {
}

ImprovHandler::~ImprovHandler() {
    if (improv) {
        delete improv;
        improv = nullptr;
    }
}

void ImprovHandler::begin(Stream* serial, ConfigManager* config, AppState* state, MatrixDisplay* display) {
    config_manager = config;
    app_state = state;
    matrix_display = display;
    provisioning_active = false;
    configured_via_improv = false;
    instance = this;
    
    ESP_LOGI(TAG, "Initializing Improv Wi-Fi handler...");
    
    // Create improv instance with serial stream
    if (improv) {
        delete improv;
        improv = nullptr;
    }
    improv = new ImprovWiFi(serial);
    
    // Set device info for Improv
    // ChipFamily, firmware name, firmware version, device name
    String device_name = "webex-display";
    if (config_manager) {
        device_name = config_manager->getDeviceName();
    }
    
    // Detect chip family at runtime
    ImprovTypes::ChipFamily chipFamily;
    uint8_t chipFamilyId = getChipFamilyId();
    switch (chipFamilyId) {
        case 4: chipFamily = ImprovTypes::ChipFamily::CF_ESP32_S3; break;
        case 2: chipFamily = ImprovTypes::ChipFamily::CF_ESP32_S2; break;
        case 5: chipFamily = ImprovTypes::ChipFamily::CF_ESP32_C3; break;
        default: chipFamily = ImprovTypes::ChipFamily::CF_ESP32; break;
    }
    ESP_LOGI(TAG, "Detected chip family: %s", getBoardType().c_str());
    
    // Build device URL for Improv redirect after WiFi provisioning
    // This redirects users to the website's provision page for auto-approval
    // {LOCAL_IPV4} is replaced by the library with the device's actual IP
    #ifdef WEBSITE_URL
    String deviceUrl = String(WEBSITE_URL) + "/user/install/provision?ip={LOCAL_IPV4}";
    #else
    String deviceUrl = "http://{LOCAL_IPV4}";  // Fallback to device's local web interface
    #endif
    
    improv->setDeviceInfo(
        chipFamily,
        "LED Matrix Webex Display",
        FIRMWARE_VERSION,
        device_name.c_str(),
        deviceUrl.c_str()
    );
    
    // Set callbacks - use library's built-in WiFi connection (no custom callback)
    // The library's tryConnectToWifi uses vTaskDelay which allows other tasks to run
    improv->onImprovConnected(onImprovConnected);
    improv->onImprovError(onImprovError);
    
    // NOTE: We intentionally do NOT set a custom connect callback
    // The library's built-in connection handler works better with ESP Web Tools
    // because it uses proper FreeRTOS delays
    
    initialized = true;
    ESP_LOGI(TAG, "Improv Wi-Fi handler ready");
    ESP_LOGI(TAG, "Device will respond to Improv WiFi provisioning requests");
}

void ImprovHandler::loop() {
    if (!initialized || !improv) return;
    
    // Process incoming Improv commands
    improv->handleSerial();
}

bool ImprovHandler::isProvisioning() const {
    return provisioning_active;
}

bool ImprovHandler::wasConfiguredViaImprov() const {
    return configured_via_improv;
}

// Static callback: Handle successful Improv connection
// This is called AFTER the library successfully connects to WiFi
void ImprovHandler::onImprovConnected(const char* ssid, const char* password) {
    if (!instance) return;
    
    ESP_LOGI(TAG, "Successfully connected to: %s", ssid);
    ESP_LOGI(TAG, "IP Address: %s", WiFi.localIP().toString().c_str());
    
    // Disable WiFi power save (important for LED matrix timing)
    WiFi.setSleep(WIFI_PS_NONE);
    
    // Save credentials to config for reconnection on reboot
    if (instance->config_manager) {
        instance->config_manager->setWiFiCredentials(String(ssid), String(password));
        ESP_LOGI(TAG, "WiFi credentials saved to config");
    }
    
    // Update app state
    if (instance->app_state) {
        instance->app_state->wifi_connected = true;
    }
    
    instance->configured_via_improv = true;
    
    // Show connected status on display (hostname shown later after mDNS init)
    if (instance->matrix_display) {
        instance->matrix_display->showUnconfigured(WiFi.localIP().toString(), "");
    }
}

// Static callback: Handle Improv errors
void ImprovHandler::onImprovError(ImprovTypes::Error error) {
    switch (error) {
        case ImprovTypes::Error::ERROR_NONE:
            break;
        case ImprovTypes::Error::ERROR_INVALID_RPC:
            ESP_LOGE(TAG, "Error: Invalid RPC packet");
            break;
        case ImprovTypes::Error::ERROR_UNKNOWN_RPC:
            ESP_LOGE(TAG, "Error: Unknown RPC command");
            break;
        case ImprovTypes::Error::ERROR_UNABLE_TO_CONNECT:
            ESP_LOGE(TAG, "Error: Unable to connect to WiFi");
            // Don't update display here - main loop will handle it
            // (will show AP mode screen if in AP mode, or allow retry)
            break;
        case ImprovTypes::Error::ERROR_NOT_AUTHORIZED:
            ESP_LOGE(TAG, "Error: Not authorized");
            break;
        default:
            ESP_LOGE(TAG, "Error: Unknown error code %d", (int)error);
            break;
    }
}
