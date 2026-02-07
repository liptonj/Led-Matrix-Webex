/**
 * @file api_modules.cpp
 * @brief Module Management API Handlers
 */

#include "web_server.h"
#include "../debug/log_system.h"
#include <ArduinoJson.h>

static const char* TAG = "API_MOD";

void WebServerManager::handleGetModules(AsyncWebServerRequest* request) {
    JsonDocument doc;
    
    // Current firmware info
    doc["current_variant"] = module_manager ? module_manager->getCurrentVariant() : "unknown";
    doc["installed_modules"] = module_manager ? module_manager->getInstalledModules() : INSTALLED_MODULES;
    doc["enabled_modules"] = module_manager ? module_manager->getEnabledModules() : INSTALLED_MODULES;
    
    // List all available modules
    JsonArray modules = doc["modules"].to<JsonArray>();
    
    if (module_manager) {
        auto allModules = module_manager->getAllModules();
        for (const auto* mod : allModules) {
            JsonObject m = modules.add<JsonObject>();
            m["id"] = mod->id;
            m["name"] = mod->name;
            m["description"] = mod->description;
            m["version"] = mod->version;
            m["size_kb"] = mod->size_kb;
            m["installed"] = module_manager->isInstalled(mod->id);
            m["enabled"] = module_manager->isEnabled(mod->id);
            m["ota_filename"] = mod->ota_filename;
        }
    }
    
    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleGetVariants(AsyncWebServerRequest* request) {
    JsonDocument doc;
    
    doc["current_variant"] = module_manager ? module_manager->getCurrentVariant() : "unknown";
    
    // Recommended variant based on enabled modules
    if (module_manager) {
        const FirmwareVariant* recommended = module_manager->getRecommendedVariant();
        if (recommended) {
            doc["recommended"] = recommended->name;
        }
    }
    
    // List all firmware variants
    JsonArray variants = doc["variants"].to<JsonArray>();
    
    if (module_manager) {
        auto allVariants = module_manager->getAllVariants();
        for (const auto* var : allVariants) {
            JsonObject v = variants.add<JsonObject>();
            v["name"] = var->name;
            v["description"] = var->description;
            v["modules"] = var->modules;
            v["filename"] = var->filename;
            v["size_kb"] = var->size_kb;
            v["is_current"] = (var->modules == module_manager->getInstalledModules());
        }
    }
    
    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleSetModuleEnabled(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    if (!module_manager) {
        request->send(503, "application/json", "{\"error\":\"Module manager not available\"}");
        return;
    }
    
    String body = String((char*)data).substring(0, len);
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);
    
    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }
    
    if (!doc["module_id"].is<int>() || !doc["enabled"].is<bool>()) {
        request->send(400, "application/json", "{\"error\":\"module_id and enabled required\"}");
        return;
    }
    
    uint8_t moduleId = doc["module_id"].as<uint8_t>();
    bool enabled = doc["enabled"].as<bool>();
    
    // Check if module is installed
    if (!module_manager->isInstalled(moduleId)) {
        request->send(400, "application/json", "{\"error\":\"Module not installed\"}");
        return;
    }
    
    module_manager->setEnabled(moduleId, enabled);
    
    JsonDocument response;
    response["success"] = true;
    response["module_id"] = moduleId;
    response["enabled"] = module_manager->isEnabled(moduleId);
    response["message"] = enabled ? "Module enabled" : "Module disabled";
    
    // Check if firmware variant change is recommended
    const FirmwareVariant* recommended = module_manager->getRecommendedVariant();
    if (recommended && recommended->modules != module_manager->getInstalledModules()) {
        response["recommended_variant"] = recommended->name;
        response["variant_change_suggested"] = true;
    }
    
    String responseStr;
    serializeJson(response, responseStr);
    request->send(200, "application/json", responseStr);
}

void WebServerManager::handleInstallVariant(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    if (!module_manager) {
        request->send(503, "application/json", "{\"error\":\"Module manager not available\"}");
        return;
    }
    
    String body = String((char*)data).substring(0, len);
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);
    
    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }
    
    if (!doc["variant"].is<const char*>()) {
        request->send(400, "application/json", "{\"error\":\"variant name required\"}");
        return;
    }
    
    const char* variantName = doc["variant"].as<const char*>();
    const FirmwareVariant* variant = module_manager->getVariant(variantName);
    
    if (!variant) {
        request->send(404, "application/json", "{\"error\":\"Variant not found\"}");
        return;
    }
    
    // Build the OTA URL for this variant
    String otaBaseUrl = config_manager->getOTAUrl();
    if (otaBaseUrl.isEmpty()) {
        otaBaseUrl = "https://github.com/liptonj/Led-Matrix-Webex/releases/latest/download";
    }
    
    String firmwareUrl = otaBaseUrl + "/" + String(variant->filename);
    
    JsonDocument response;
    response["success"] = true;
    response["variant"] = variantName;
    response["filename"] = variant->filename;
    response["url"] = firmwareUrl;
    response["size_kb"] = variant->size_kb;
    response["modules"] = variant->modules;
    response["message"] = "Starting OTA update...";
    
    String responseStr;
    serializeJson(response, responseStr);
    request->send(200, "application/json", responseStr);
    
    // Trigger OTA update (handled by OTA manager)
    // The OTA manager will be called after this response
    ESP_LOGI(TAG, "Installing variant: %s from %s", variantName, firmwareUrl.c_str());
    
    // Store the URL for OTA manager to pick up
    config_manager->setOTAUrl(firmwareUrl);
    
    // Note: Actual OTA installation would be triggered here
    // This would call ota_manager.installFromUrl(firmwareUrl)
}
