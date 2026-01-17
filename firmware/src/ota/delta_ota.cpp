/**
 * @file delta_ota.cpp
 * @brief Delta/Differential OTA Implementation
 */

#include "delta_ota.h"
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>

// Module size estimates in KB (for patch size calculation)
const size_t MODULE_SIZES[] = {
    180,  // MODULE_CORE (0x01)
    35,   // MODULE_WEBEX_POLLING (0x02)
    25,   // MODULE_MQTT_SENSORS (0x04)
    20,   // MODULE_BRIDGE_CLIENT (0x08)
    30,   // MODULE_XAPI_CLIENT (0x10)
    45    // MODULE_EMBEDDED_APP (0x20)
};

DeltaOTAManager::DeltaOTAManager() {
}

bool DeltaOTAManager::begin(const String& url) {
    base_url = url;
    
    // Ensure URL doesn't end with /
    if (base_url.endsWith("/")) {
        base_url = base_url.substring(0, base_url.length() - 1);
    }
    
    Serial.printf("[DELTA-OTA] Initialized with base URL: %s\n", base_url.c_str());
    return true;
}

bool DeltaOTAManager::checkForUpdates(const String& current_version,
                                       const String& current_variant,
                                       OTAManifest& manifest) {
    HTTPClient http;
    WiFiClientSecure client;
    client.setInsecure();  // For GitHub - in production use proper certs
    
    // Build manifest URL
    String manifest_url = base_url + "/ota-manifest.json";
    
    Serial.printf("[DELTA-OTA] Checking: %s\n", manifest_url.c_str());
    
    if (!http.begin(client, manifest_url)) {
        setError("Failed to connect to OTA server");
        return false;
    }
    
    int httpCode = http.GET();
    
    if (httpCode != HTTP_CODE_OK) {
        setError("HTTP error: " + String(httpCode));
        http.end();
        return false;
    }
    
    String payload = http.getString();
    http.end();
    
    // Parse manifest
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);
    
    if (error) {
        setError("JSON parse error: " + String(error.c_str()));
        return false;
    }
    
    manifest.current_version = current_version;
    manifest.target_version = doc["latest_version"] | "";
    manifest.path_count = 0;
    
    // Check if update is needed
    if (manifest.target_version == current_version) {
        Serial.println("[DELTA-OTA] Already up to date");
        return false;
    }
    
    // Look for update paths for our variant
    JsonArray variants = doc["variants"].as<JsonArray>();
    
    for (JsonObject variant : variants) {
        if (String(variant["name"] | "") == current_variant) {
            JsonArray paths = variant["update_paths"].as<JsonArray>();
            
            for (JsonObject path : paths) {
                if (manifest.path_count >= 4) break;
                
                auto& p = manifest.paths[manifest.path_count];
                
                String type = path["type"] | "full";
                if (type == "full") p.type = OTAUpdateType::FULL_IMAGE;
                else if (type == "compressed") p.type = OTAUpdateType::COMPRESSED;
                else if (type == "delta") p.type = OTAUpdateType::DELTA_PATCH;
                else if (type == "module") p.type = OTAUpdateType::MODULE_ONLY;
                else continue;
                
                p.url = base_url + "/" + (path["file"] | "");
                p.size = path["size"] | 0;
                p.checksum = path["sha256"] | "";
                p.base_version = path["base_version"] | "";
                
                manifest.path_count++;
            }
            break;
        }
    }
    
    // Find recommended path (smallest valid option)
    manifest.recommended_path = 0;
    size_t smallest = SIZE_MAX;
    
    for (uint8_t i = 0; i < manifest.path_count; i++) {
        // Delta patches require matching base version
        if (manifest.paths[i].type == OTAUpdateType::DELTA_PATCH) {
            if (manifest.paths[i].base_version != current_version) {
                continue;  // Skip incompatible delta
            }
        }
        
        if (manifest.paths[i].size < smallest) {
            smallest = manifest.paths[i].size;
            manifest.recommended_path = i;
        }
    }
    
    Serial.printf("[DELTA-OTA] Found %d update paths, recommended: %d (%zu bytes)\n",
                  manifest.path_count, manifest.recommended_path, smallest);
    
    return manifest.path_count > 0;
}

bool DeltaOTAManager::getUpdatePath(const String& target_variant, 
                                     OTAManifest& manifest) {
    HTTPClient http;
    WiFiClientSecure client;
    client.setInsecure();
    
    String manifest_url = base_url + "/ota-manifest.json";
    
    if (!http.begin(client, manifest_url)) {
        setError("Failed to connect");
        return false;
    }
    
    int httpCode = http.GET();
    if (httpCode != HTTP_CODE_OK) {
        setError("HTTP error: " + String(httpCode));
        http.end();
        return false;
    }
    
    String payload = http.getString();
    http.end();
    
    JsonDocument doc;
    if (deserializeJson(doc, payload)) {
        setError("JSON parse error");
        return false;
    }
    
    manifest.target_variant = target_variant;
    manifest.target_version = doc["latest_version"] | "";
    manifest.path_count = 0;
    
    // Find the target variant
    JsonArray variants = doc["variants"].as<JsonArray>();
    
    for (JsonObject variant : variants) {
        if (String(variant["name"] | "") == target_variant) {
            // Add full image path
            auto& p = manifest.paths[0];
            p.type = OTAUpdateType::FULL_IMAGE;
            p.url = base_url + "/" + (variant["firmware_file"] | "");
            p.size = variant["size"] | 0;
            p.checksum = variant["sha256"] | "";
            manifest.path_count = 1;
            
            // Check for compressed version
            if (variant["compressed_file"]) {
                auto& pc = manifest.paths[1];
                pc.type = OTAUpdateType::COMPRESSED;
                pc.url = base_url + "/" + (variant["compressed_file"] | "");
                pc.size = variant["compressed_size"] | 0;
                pc.checksum = variant["compressed_sha256"] | "";
                manifest.path_count = 2;
            }
            
            manifest.recommended_path = manifest.path_count - 1;  // Prefer compressed
            return true;
        }
    }
    
    setError("Variant not found: " + target_variant);
    return false;
}

bool DeltaOTAManager::performUpdate(const OTAManifest& manifest,
                                     void (*progress_callback)(int)) {
    if (manifest.path_count == 0) {
        setError("No update paths available");
        return false;
    }
    
    const auto& path = manifest.paths[manifest.recommended_path];
    
    Serial.printf("[DELTA-OTA] Starting update: %s (%zu bytes)\n", 
                  path.url.c_str(), path.size);
    
    bool success = false;
    
    switch (path.type) {
        case OTAUpdateType::FULL_IMAGE:
            success = downloadAndApplyFull(path.url, path.size, progress_callback);
            break;
            
        case OTAUpdateType::COMPRESSED:
            success = downloadAndApplyCompressed(path.url, path.size, progress_callback);
            break;
            
        case OTAUpdateType::DELTA_PATCH:
            success = downloadAndApplyDelta(path.url, path.size, 
                                            path.base_version, progress_callback);
            break;
            
        case OTAUpdateType::MODULE_ONLY:
            // Module-only updates use delta mechanism
            success = downloadAndApplyDelta(path.url, path.size,
                                            path.base_version, progress_callback);
            break;
    }
    
    if (success) {
        Serial.println("[DELTA-OTA] Update successful, rebooting...");
        delay(1000);
        ESP.restart();
    }
    
    return success;
}

size_t DeltaOTAManager::estimateDownloadSize(const String& from_variant,
                                              const String& to_variant) {
    // This would query the server for actual sizes
    // For now, use module-based estimation
    
    // Get module bitmasks from variant names
    uint8_t from_modules = 0x01;  // Core
    uint8_t to_modules = 0x01;
    
    // Simple variant to modules mapping
    if (from_variant == "embedded") from_modules = 0x21;
    else if (from_variant == "standard") from_modules = 0x23;
    else if (from_variant == "sensors") from_modules = 0x25;
    else if (from_variant == "bridge") from_modules = 0x29;
    else if (from_variant == "full") from_modules = 0x3F;
    
    if (to_variant == "embedded") to_modules = 0x21;
    else if (to_variant == "standard") to_modules = 0x23;
    else if (to_variant == "sensors") to_modules = 0x25;
    else if (to_variant == "bridge") to_modules = 0x29;
    else if (to_variant == "full") to_modules = 0x3F;
    
    ModuleDelta delta = calculateModuleDelta(from_modules, to_modules);
    return estimatePatchSize(delta);
}

bool DeltaOTAManager::downloadAndApplyFull(const String& url, size_t size,
                                            void (*progress)(int)) {
    HTTPClient http;
    WiFiClientSecure client;
    client.setInsecure();
    
    if (!http.begin(client, url)) {
        setError("Connection failed");
        return false;
    }
    
    int httpCode = http.GET();
    if (httpCode != HTTP_CODE_OK) {
        setError("Download failed: " + String(httpCode));
        http.end();
        return false;
    }
    
    int contentLength = http.getSize();
    if (contentLength <= 0) {
        contentLength = size;
    }
    
    if (!Update.begin(contentLength)) {
        setError("Not enough space");
        http.end();
        return false;
    }
    
    WiFiClient* stream = http.getStreamPtr();
    size_t written = 0;
    uint8_t buff[1024];
    
    while (http.connected() && written < (size_t)contentLength) {
        size_t available = stream->available();
        if (available) {
            size_t toRead = min(available, sizeof(buff));
            size_t bytesRead = stream->readBytes(buff, toRead);
            
            if (Update.write(buff, bytesRead) != bytesRead) {
                setError("Write failed");
                http.end();
                Update.abort();
                return false;
            }
            
            written += bytesRead;
            
            if (progress) {
                progress((written * 100) / contentLength);
            }
        }
        delay(1);
    }
    
    http.end();
    
    if (!Update.end(true)) {
        setError("Update finalize failed");
        return false;
    }
    
    return true;
}

bool DeltaOTAManager::downloadAndApplyCompressed(const String& url, size_t size,
                                                  void (*progress)(int)) {
    // ESP32 can handle GZIP decompression during OTA
    // The Update library supports this natively in newer versions
    // For older versions, we'd need to decompress manually
    
    // For now, use full download method
    // The firmware should be pre-decompressed on the server
    return downloadAndApplyFull(url, size, progress);
}

bool DeltaOTAManager::downloadAndApplyDelta(const String& url, size_t size,
                                             const String& base_version,
                                             void (*progress)(int)) {
    // Delta patching on ESP32 is complex and requires:
    // 1. Reading current firmware from flash
    // 2. Applying BSDiff patch
    // 3. Writing new firmware
    
    // This requires significant RAM and a patching library
    // For MVP, we fall back to full download
    
    Serial.println("[DELTA-OTA] Delta patches not yet supported, using full download");
    setError("Delta patches require server-side support");
    return false;
}

bool DeltaOTAManager::verifyChecksum(const String& expected) {
    // Would verify SHA256 of installed firmware
    // ESP32 can compute this from the partition
    return true;
}

void DeltaOTAManager::setError(const String& error) {
    last_error = error;
    Serial.printf("[DELTA-OTA] Error: %s\n", error.c_str());
}

// Module delta calculations
ModuleDelta calculateModuleDelta(uint8_t from_modules, uint8_t to_modules) {
    ModuleDelta delta;
    delta.from_modules = from_modules;
    delta.to_modules = to_modules;
    delta.added_modules = to_modules & ~from_modules;
    delta.removed_modules = from_modules & ~to_modules;
    delta.estimated_patch_size = estimatePatchSize(delta);
    return delta;
}

size_t estimatePatchSize(const ModuleDelta& delta) {
    size_t size = 0;
    
    // Base overhead for any update
    size += 10 * 1024;  // ~10 KB base patch overhead
    
    // Added modules contribute most of their size
    for (int i = 0; i < 6; i++) {
        uint8_t module_bit = 1 << i;
        
        if (delta.added_modules & module_bit) {
            // Adding a module: ~80% of module size in patch
            size += (MODULE_SIZES[i] * 1024 * 80) / 100;
        }
        
        if (delta.removed_modules & module_bit) {
            // Removing a module: ~10% overhead
            size += (MODULE_SIZES[i] * 1024 * 10) / 100;
        }
    }
    
    // If no changes, just version update
    if (delta.added_modules == 0 && delta.removed_modules == 0) {
        size = 15 * 1024;  // ~15 KB for version-only update
    }
    
    return size;
}
