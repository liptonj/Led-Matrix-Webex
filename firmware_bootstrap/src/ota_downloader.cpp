/**
 * @file ota_downloader.cpp
 * @brief OTA Firmware Downloader Implementation
 */

#include "ota_downloader.h"
#include "debug.h"
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Update.h>
#include <LittleFS.h>

OTADownloader::OTADownloader()
    : config_store(nullptr)
    , status(OTAStatus::IDLE)
    , progress(0)
    , progress_callback(nullptr)
    , release_count(0)
    , releases_cached(false)
    , release_fetch_error("")
    , last_release_fetch_ms(0) {
    // Initialize releases array
    for (int i = 0; i < MAX_RELEASES; i++) {
        releases[i].valid = false;
    }
}

OTADownloader::~OTADownloader() {
}

namespace {
void logConnectivityProbe(const char* host, uint16_t port) {
    IPAddress resolved;
    if (WiFi.hostByName(host, resolved)) {
        Serial.printf("[OTA] DNS %s -> %s\n", host, resolved.toString().c_str());
    } else {
        Serial.printf("[OTA] DNS lookup failed for %s\n", host);
        return;
    }

    WiFiClient tcp_client;
    Serial.printf("[OTA] TCP probe %s:%u\n", host, port);
    if (tcp_client.connect(resolved, port)) {
        Serial.println("[OTA] TCP probe connected");
        tcp_client.stop();
    } else {
        Serial.println("[OTA] TCP probe failed");
    }
}
}  // namespace

void OTADownloader::begin(ConfigStore* config) {
    config_store = config;
    Serial.println("[OTA] Downloader initialized");
}

void OTADownloader::updateStatus(OTAStatus new_status, const String& message) {
    status = new_status;
    status_message = message;
    Serial.printf("[OTA] %s\n", message.c_str());
}

void OTADownloader::updateProgress(int new_progress, const String& message) {
    progress = new_progress;
    status_message = message;
    
    if (progress_callback) {
        progress_callback(progress, message.c_str());
    }
    
    Serial.printf("[OTA] %d%% - %s\n", progress, message.c_str());
}

bool OTADownloader::checkAndInstall() {
    if (!config_store) {
        updateStatus(OTAStatus::ERROR_NO_URL, "Config store not initialized");
        return false;
    }

    String ota_url = config_store->getOTAUrl();
    if (ota_url.isEmpty()) {
        updateStatus(OTAStatus::ERROR_NO_URL, "No OTA URL configured");
        return false;
    }

    updateStatus(OTAStatus::CHECKING, "Checking for firmware...");
    updateProgress(5, "Fetching release info...");

    // Check if direct .bin URL
    if (ota_url.endsWith(".bin")) {
        // Direct firmware URL - install it (filesystem unchanged)
        return downloadAndInstall(ota_url, "");
    }
    
    // Website manifest URL (manifest.json) - preferred method
    if (ota_url.endsWith("manifest.json")) {
        Serial.println("[OTA] Using website manifest for firmware download");
        return checkAndInstallFromManifest(ota_url);
    }
    
    // GitHub releases URL - legacy fallback
    if (ota_url.indexOf("api.github.com") >= 0 || ota_url.indexOf("/releases") >= 0) {
        // Fetch releases (excluding prereleases for auto-install)
        int count = fetchAvailableReleases(false);  // false = skip prereleases
        
        if (count == 0) {
            updateStatus(OTAStatus::ERROR_NO_FIRMWARE, "No stable releases found");
            return false;
        }
        
        // Update progress after successful fetch
        updateProgress(10, "Found releases, downloading...");
        
        // Install the first (newest) stable release
        Serial.printf("[OTA] Auto-installing latest stable: %s\n", releases[0].version.c_str());
        return installRelease(0);
    }
    
    updateStatus(OTAStatus::ERROR_PARSE, "Invalid OTA URL format");
    return false;
}

bool OTADownloader::checkAndInstallFromManifest(const String& manifest_url) {
    Serial.printf("[OTA] Fetching manifest from %s\n", manifest_url.c_str());
    updateProgress(8, "Fetching manifest...");
    
    WiFiClientSecure client;
    client.setInsecure();  // Skip certificate validation
    
    HTTPClient http;
    http.begin(client, manifest_url);
    http.addHeader("User-Agent", "ESP32-Bootstrap");
    http.setTimeout(30000);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    
    int http_code = http.GET();
    
    if (http_code != HTTP_CODE_OK) {
        Serial.printf("[OTA] Manifest fetch failed: %d\n", http_code);
        updateStatus(OTAStatus::ERROR_DOWNLOAD, String("Manifest fetch failed: ") + String(http_code));
        http.end();
        return false;
    }
    
    String payload = http.getString();
    http.end();
    
    Serial.printf("[OTA] Received manifest: %d bytes\n", payload.length());
    
    // Parse manifest JSON
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);
    
    if (error) {
        Serial.printf("[OTA] Manifest parse error: %s\n", error.c_str());
        updateStatus(OTAStatus::ERROR_PARSE, String("Manifest parse error: ") + error.c_str());
        return false;
    }
    
    // Extract version info
    String version = doc["version"].as<String>();
    String build_id = doc["build_id"].as<String>();
    
    Serial.printf("[OTA] Manifest version: %s (build: %s)\n", version.c_str(), build_id.c_str());
    
    // Determine board type
    #if defined(ESP32_S3_BOARD)
    const char* board_type = "esp32s3";
    #else
    const char* board_type = "esp32";
    #endif
    
    // Get bundle URL for this board
    String bundle_url = doc["bundle"][board_type]["url"].as<String>();
    
    if (bundle_url.isEmpty()) {
        Serial.printf("[OTA] No bundle found for %s in manifest\n", board_type);
        updateStatus(OTAStatus::ERROR_NO_FIRMWARE, String("No firmware for ") + board_type);
        return false;
    }
    
    Serial.printf("[OTA] Bundle URL: %s\n", bundle_url.c_str());
    updateProgress(10, "Downloading " + version + "...");
    
    // Download and install the LMWB bundle
    return downloadAndInstallBundle(bundle_url);
}

bool OTADownloader::downloadAndInstallBundle(const String& bundle_url) {
    Serial.printf("[OTA] Downloading LMWB bundle from %s\n", bundle_url.c_str());
    updateProgress(15, "Downloading bundle...");
    
    WiFiClientSecure client;
    client.setInsecure();
    
    HTTPClient http;
    http.begin(client, bundle_url);
    http.addHeader("User-Agent", "ESP32-Bootstrap");
    http.setTimeout(120000);  // 2 minute timeout for large downloads
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    
    int http_code = http.GET();
    
    if (http_code != HTTP_CODE_OK) {
        Serial.printf("[OTA] Bundle download failed: %d\n", http_code);
        updateStatus(OTAStatus::ERROR_DOWNLOAD, String("Download failed: HTTP ") + String(http_code));
        http.end();
        return false;
    }
    
    int content_length = http.getSize();
    Serial.printf("[OTA] Bundle size: %d bytes\n", content_length);
    
    if (content_length <= 16) {
        updateStatus(OTAStatus::ERROR_PARSE, "Bundle too small");
        http.end();
        return false;
    }
    
    WiFiClient* stream = http.getStreamPtr();
    
    // Read LMWB header (16 bytes)
    uint8_t header[16];
    size_t header_read = 0;
    unsigned long header_start = millis();
    
    while (header_read < 16) {
        if (millis() - header_start > 10000) {
            updateStatus(OTAStatus::ERROR_DOWNLOAD, "Header timeout");
            http.end();
            return false;
        }
        if (stream->available()) {
            int bytes = stream->readBytes(header + header_read, 16 - header_read);
            if (bytes > 0) header_read += bytes;
        }
        delay(5);
    }
    
    // Verify LMWB magic
    if (header[0] != 'L' || header[1] != 'M' || header[2] != 'W' || header[3] != 'B') {
        Serial.println("[OTA] Invalid bundle magic - not LMWB format");
        updateStatus(OTAStatus::ERROR_PARSE, "Invalid bundle format");
        http.end();
        return false;
    }
    
    // Parse header (little-endian)
    size_t app_size = header[4] | (header[5] << 8) | (header[6] << 16) | (header[7] << 24);
    size_t fs_size = header[8] | (header[9] << 8) | (header[10] << 16) | (header[11] << 24);
    
    Serial.printf("[OTA] Bundle: app=%u bytes, fs=%u bytes\n", app_size, fs_size);
    updateProgress(20, "Installing firmware...");
    
    // Phase 1: Flash firmware
    if (!Update.begin(app_size, U_FLASH)) {
        Serial.printf("[OTA] Update.begin failed: %s\n", Update.errorString());
        updateStatus(OTAStatus::ERROR_FLASH, String("Flash error: ") + Update.errorString());
        http.end();
        return false;
    }
    
    uint8_t buffer[4096];
    size_t written = 0;
    
    while (written < app_size) {
        size_t available = stream->available();
        if (available == 0) {
            if (!stream->connected()) break;
            delay(10);
            continue;
        }
        
        size_t to_read = min(min(available, sizeof(buffer)), app_size - written);
        int bytes_read = stream->readBytes(buffer, to_read);
        
        if (bytes_read > 0) {
            size_t bytes_written = Update.write(buffer, bytes_read);
            if (bytes_written != (size_t)bytes_read) {
                updateStatus(OTAStatus::ERROR_FLASH, "Flash write error");
                Update.abort();
                http.end();
                return false;
            }
            written += bytes_written;
            
            int progress = 20 + (written * 50) / app_size;
            updateProgress(progress, String("Firmware: ") + String(written / 1024) + "KB");
        }
    }
    
    if (!Update.end(true)) {
        updateStatus(OTAStatus::ERROR_VERIFY, String("Verify error: ") + Update.errorString());
        http.end();
        return false;
    }
    
    Serial.println("[OTA] Firmware flashed, installing filesystem...");
    updateProgress(75, "Installing filesystem...");
    
    // Phase 2: Flash LittleFS
    LittleFS.end();
    
    if (!Update.begin(fs_size, U_SPIFFS)) {
        Serial.printf("[OTA] FS Update.begin failed: %s\n", Update.errorString());
        updateStatus(OTAStatus::ERROR_FLASH, String("FS error: ") + Update.errorString());
        http.end();
        return false;
    }
    
    written = 0;
    while (written < fs_size) {
        size_t available = stream->available();
        if (available == 0) {
            if (!stream->connected()) break;
            delay(10);
            continue;
        }
        
        size_t to_read = min(min(available, sizeof(buffer)), fs_size - written);
        int bytes_read = stream->readBytes(buffer, to_read);
        
        if (bytes_read > 0) {
            size_t bytes_written = Update.write(buffer, bytes_read);
            if (bytes_written != (size_t)bytes_read) {
                updateStatus(OTAStatus::ERROR_FLASH, "FS write error");
                Update.abort();
                http.end();
                return false;
            }
            written += bytes_written;
            
            int progress = 75 + (written * 20) / fs_size;
            updateProgress(progress, String("Filesystem: ") + String(written / 1024) + "KB");
        }
    }
    
    if (!Update.end(true)) {
        updateStatus(OTAStatus::ERROR_VERIFY, String("FS verify error: ") + Update.errorString());
        http.end();
        return false;
    }
    
    http.end();
    
    updateStatus(OTAStatus::SUCCESS, "Update complete!");
    updateProgress(100, "Rebooting...");
    
    Serial.println("[OTA] Bundle update complete, rebooting in 2 seconds...");
    delay(2000);
    ESP.restart();
    return true;
}

bool OTADownloader::downloadAndInstall(const String& firmware_url, const String& littlefs_url) {
    if (firmware_url.isEmpty()) {
        updateStatus(OTAStatus::ERROR_NO_FIRMWARE, "No firmware URL provided");
        return false;
    }

    updateStatus(OTAStatus::DOWNLOADING, "Downloading firmware...");
    updateProgress(15, "Starting firmware download...");

    if (!downloadAndInstallBinary(firmware_url, U_FLASH, "Firmware", 15, 70)) {
        return false;
    }

    if (littlefs_url.isEmpty()) {
        updateStatus(OTAStatus::SUCCESS, "Firmware updated (filesystem unchanged)");
        updateProgress(100, "Rebooting...");
        Serial.println("[OTA] Firmware update complete (LittleFS unchanged), rebooting...");
        delay(2000);
        ESP.restart();
        return true;
    }

    updateStatus(OTAStatus::DOWNLOADING, "Downloading LittleFS...");
    updateProgress(75, "Starting LittleFS download...");

    if (!downloadAndInstallBinary(littlefs_url, U_SPIFFS, "LittleFS", 75, 95)) {
        return false;
    }

    updateStatus(OTAStatus::SUCCESS, "Firmware + LittleFS updated!");
    updateProgress(100, "Rebooting...");

    Serial.println("[OTA] Firmware and LittleFS update complete, rebooting in 2 seconds...");
    delay(2000);
    ESP.restart();
    return true;
}

bool OTADownloader::selectReleaseAssets(const JsonArray& assets, String& firmware_url, String& littlefs_url) {
    int firmware_priority = 0;
    int littlefs_priority = 0;

    for (JsonObject asset : assets) {
        String name = asset["name"].as<String>();
        String name_lower = name;
        name_lower.toLowerCase();

        if (!name_lower.endsWith(".bin")) {
            continue;
        }

        if (name_lower.indexOf("bootstrap") >= 0) {
            continue;
        }

        if (name_lower.indexOf("fullflash") >= 0) {
            continue;
        }

        const String download = asset["browser_download_url"].as<String>();

        if (name_lower.indexOf("littlefs") >= 0 || name_lower.indexOf("spiffs") >= 0) {
            int priority = 0;
            #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 200;
            }
            #else
            if (name_lower.indexOf("esp32") >= 0 &&
                name_lower.indexOf("esp32s3") < 0 &&
                name_lower.indexOf("esp32-s3") < 0) {
                priority = 200;
            }
            #endif
            if (name_lower == "littlefs.bin" || name_lower == "spiffs.bin") {
                priority = max(priority, 50);
            }
            if (priority > littlefs_priority) {
                littlefs_priority = priority;
                littlefs_url = download;
            }
            continue;
        }

        if (name_lower.indexOf("ota") >= 0) {
            continue;  // Skip merged OTA binaries for streaming updates
        }

        if (name_lower.indexOf("firmware") >= 0) {
            int priority = 0;
            #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 200;
            }
            #else
            if (name_lower.indexOf("esp32") >= 0 &&
                name_lower.indexOf("esp32s3") < 0 &&
                name_lower.indexOf("esp32-s3") < 0) {
                priority = 200;
            }
            #endif
            if (name_lower == "firmware.bin") {
                priority = max(priority, 50);
            }
            if (priority > firmware_priority) {
                firmware_priority = priority;
                firmware_url = download;
            }
        }
    }

    return firmware_priority > 0 && littlefs_priority > 0;
}

bool OTADownloader::downloadAndInstallBinary(const String& url,
                                             int update_type,
                                             const char* label,
                                             int start_progress,
                                             int end_progress) {
    WiFiClientSecure client;
    client.setInsecure();  // Skip certificate validation

    HTTPClient http;
    http.begin(client, url);
    http.addHeader("User-Agent", "ESP32-Bootstrap");
    http.setTimeout(static_cast<uint16_t>(OTA_DOWNLOAD_TIMEOUT_MS / 1000));  // Convert to seconds for HTTP timeout

    // Follow redirects (GitHub uses redirects for downloads)
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

    int http_code = http.GET();

    if (http_code != HTTP_CODE_OK) {
        updateStatus(OTAStatus::ERROR_DOWNLOAD, 
                    String("Download failed: HTTP ") + String(http_code));
        http.end();
        return false;
    }

    int content_length = http.getSize();

    if (content_length <= 0) {
        updateStatus(OTAStatus::ERROR_DOWNLOAD, "Invalid content length");
        http.end();
        return false;
    }

    Serial.printf("[OTA] %s size: %d bytes\n", label, content_length);
    updateProgress(start_progress, String("Downloading ") + String(content_length / 1024) + "KB...");

    if (update_type == U_SPIFFS) {
        LittleFS.end();
    }

    if (!Update.begin(content_length, update_type)) {
        updateStatus(OTAStatus::ERROR_FLASH, 
                    String("Not enough space: ") + Update.errorString());
        http.end();
        return false;
    }

    updateStatus(OTAStatus::FLASHING, String("Flashing ") + label + "...");

    // Stream download to flash
    WiFiClient* stream = http.getStreamPtr();
    uint8_t buffer[OTA_BUFFER_SIZE];
    size_t written = 0;

    unsigned long start_time = millis();

    while (written < static_cast<size_t>(content_length)) {
        // Check timeout
        if (millis() - start_time > OTA_DOWNLOAD_TIMEOUT_MS) {
            updateStatus(OTAStatus::ERROR_DOWNLOAD, "Download timeout");
            Update.abort();
            http.end();
            return false;
        }

        size_t available = stream->available();
        if (available == 0) {
            delay(10);
            continue;
        }

        size_t to_read = min(available, sizeof(buffer));
        size_t bytes_read = stream->readBytes(buffer, to_read);

        if (bytes_read == 0) {
            continue;
        }

        size_t bytes_written = Update.write(buffer, bytes_read);
        if (bytes_written != bytes_read) {
            updateStatus(OTAStatus::ERROR_FLASH, 
                        String("Flash write error: ") + Update.errorString());
            Update.abort();
            http.end();
            return false;
        }

        written += bytes_written;

        int progress = start_progress +
            static_cast<int>((written * (end_progress - start_progress)) / content_length);
        updateProgress(progress,
                      String("Flashing: ") + String(written / 1024) + "/" + 
                      String(content_length / 1024) + "KB");
    }

    http.end();
    updateProgress(end_progress, "Verifying checksum...");

    if (!Update.end(true)) {
        updateStatus(OTAStatus::ERROR_VERIFY, 
                    String("Verification failed: ") + Update.errorString());
        return false;
    }

    Serial.printf("[OTA] %s update applied\n", label);
    return true;
}

OTAStatus OTADownloader::getStatus() const {
    return status;
}

String OTADownloader::getStatusMessage() const {
    return status_message;
}

int OTADownloader::getProgress() const {
    return progress;
}

void OTADownloader::setProgressCallback(OTAProgressCallback callback) {
    progress_callback = callback;
}

bool OTADownloader::isBetaVersion(const String& version) {
    String lower = version;
    lower.toLowerCase();
    return lower.indexOf("beta") >= 0 || 
           lower.indexOf("alpha") >= 0 || 
           lower.indexOf("rc") >= 0 ||
           lower.indexOf("dev") >= 0 ||
           lower.indexOf("pre") >= 0;
}

int OTADownloader::fetchAvailableReleases(bool include_prereleases) {
    LOG_FUNC_ENTRY(OTA_TAG);
    
    last_release_fetch_ms = millis();
    release_fetch_error = "";
    
    Serial.println("[OTA] ==========================================");
    Serial.printf("[OTA] Fetch releases request (include prereleases: %s)\n", 
                  include_prereleases ? "yes" : "no");

    if (!config_store) {
        LOG_ERROR(OTA_TAG, "Config store is null");
        release_fetch_error = "Config store not initialized";
        Serial.println("[OTA] ==========================================");
        return 0;
    }
    
    // Reset releases array
    release_count = 0;
    for (int i = 0; i < MAX_RELEASES; i++) {
        releases[i].valid = false;
    }
    
    // Build releases list URL (not just /latest)
    String ota_url = config_store->getOTAUrl();
    String releases_url = ota_url;
    
    LOG_DEBUG(OTA_TAG, "OTA URL from config: %s", ota_url.c_str());
    
    // Convert /latest to full releases list
    if (releases_url.endsWith("/latest")) {
        releases_url = releases_url.substring(0, releases_url.length() - 7);
        LOG_DEBUG(OTA_TAG, "Converted to releases list URL: %s", releases_url.c_str());
    }
    
    // Add pagination limit to reduce memory usage and speed up fetch
    // Limit to 10 releases per page (only fetch first page)
    if (releases_url.indexOf('?') >= 0) {
        releases_url += "&per_page=10";
    } else {
        releases_url += "?per_page=10";
    }
    
    LOG_INFO(OTA_TAG, "Fetching releases from: %s", releases_url.c_str());

    logConnectivityProbe("api.github.com", 443);
    
    WiFiClientSecure client;
    client.setInsecure();
    LOG_DEBUG(OTA_TAG, "Created WiFiClientSecure (insecure mode)");
    
    HTTPClient http;
    http.begin(client, releases_url);
    http.addHeader("User-Agent", "ESP32-Bootstrap");
    http.addHeader("Accept", "application/vnd.github.v3+json");
    http.setTimeout(60000);  // 60 seconds - increased from 30s for slower networks
    LOG_DEBUG(OTA_TAG, "HTTP client configured, timeout=60s");
    
    // Retry logic: attempt up to 2 times
    int max_attempts = 2;
    int http_code = -1;
    String payload;
    
    Serial.printf("[OTA] Will attempt up to %d times with 60s timeout per attempt\n", max_attempts);
    
    for (int attempt = 1; attempt <= max_attempts; attempt++) {
        if (attempt > 1) {
            LOG_INFO(OTA_TAG, "Retry attempt %d/%d...", attempt, max_attempts);
            Serial.printf("[OTA] Retry attempt %d/%d after failure\n", attempt, max_attempts);
            delay(2000);  // Wait 2 seconds before retry
        }
        
        LOG_DEBUG(OTA_TAG, "Starting HTTP GET request (attempt %d)...", attempt);
        Serial.printf("[OTA] → Sending HTTP GET (attempt %d/%d)...\n", attempt, max_attempts);
        unsigned long req_start = millis();
        
        http_code = http.GET();
        
        unsigned long req_duration = millis() - req_start;
        LOG_DEBUG(OTA_TAG, "HTTP response code: %d", http_code);
        Serial.printf("[OTA] ← HTTP response: %d (took %lu ms)\n", http_code, req_duration);
        
        if (http_code == HTTP_CODE_OK) {
            payload = http.getString();
            LOG_DEBUG(OTA_TAG, "Received %d bytes from GitHub", payload.length());
            Serial.printf("[OTA] ✓ Successfully received %d bytes\n", payload.length());
            break;  // Success, exit retry loop
        } else if (http_code > 0) {
            // HTTP error (4xx, 5xx)
            LOG_ERROR(OTA_TAG, "HTTP error: %d", http_code);
            if (attempt == max_attempts) {
                // Last attempt failed
                if (http_code == 403) {
                    release_fetch_error = "GitHub API rate limit exceeded";
                } else if (http_code == 404) {
                    release_fetch_error = "Repository or releases not found (404)";
                } else if (http_code >= 500) {
                    release_fetch_error = String("GitHub server error (") + String(http_code) + ")";
                } else {
                    release_fetch_error = String("HTTP error: ") + String(http_code);
                }
            }
        } else {
            // Connection error (timeout, DNS, etc.)
            LOG_ERROR(OTA_TAG, "Connection error: %d", http_code);
            if (attempt == max_attempts) {
                if (http_code == HTTPC_ERROR_CONNECTION_REFUSED) {
                    release_fetch_error = "Connection refused - check network";
                } else if (http_code == HTTPC_ERROR_CONNECTION_LOST) {
                    release_fetch_error = "Connection lost - check WiFi";
                } else if (http_code == HTTPC_ERROR_READ_TIMEOUT) {
                    release_fetch_error = "Request timeout - slow network";
                } else {
                    release_fetch_error = String("Connection error: ") + String(http_code);
                }
            }
        }
    }
    
    http.end();
    
    // Check if all attempts failed
    if (http_code != HTTP_CODE_OK) {
        Serial.printf("[OTA] All %d attempts failed. Error: %s\n", max_attempts, release_fetch_error.c_str());
        return 0;
    }
    
    // Parse JSON array of releases
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);
    
    if (error) {
        Serial.printf("[OTA] JSON parse error: %s\n", error.c_str());
        // Provide more detailed error message
        if (error == DeserializationError::NoMemory) {
            release_fetch_error = "Out of memory parsing releases (too many releases)";
        } else if (error == DeserializationError::InvalidInput) {
            release_fetch_error = "Invalid JSON format from GitHub";
        } else if (error == DeserializationError::IncompleteInput) {
            release_fetch_error = "Incomplete JSON response from GitHub";
        } else {
            release_fetch_error = String("JSON parse error: ") + error.c_str();
        }
        return 0;
    }
    
    // Handle both array (all releases) and object (single release)
    JsonArray releasesArray;
    if (doc.is<JsonArray>()) {
        releasesArray = doc.as<JsonArray>();
    } else {
        // Single release object - not an array
        Serial.println("[OTA] Single release found");
        // We'll handle this case specially
    }
    
    Serial.printf("[OTA] Found %d releases\n", releasesArray.size());
    
    for (JsonObject release : releasesArray) {
        if (release_count >= MAX_RELEASES) break;
        
        bool is_prerelease = release["prerelease"].as<bool>();
        String tag = release["tag_name"].as<String>();
        
        // Skip prereleases if not requested
        if (is_prerelease && !include_prereleases) {
            Serial.printf("[OTA] Skipping prerelease: %s\n", tag.c_str());
            continue;
        }
        
        // Also check version string for beta indicators
        if (!include_prereleases && isBetaVersion(tag)) {
            Serial.printf("[OTA] Skipping beta version: %s\n", tag.c_str());
            continue;
        }
        
        // Find firmware + LittleFS assets for this chip
        JsonArray assets = release["assets"].as<JsonArray>();
        String firmware_url = "";
        String littlefs_url = "";

        if (!selectReleaseAssets(assets, firmware_url, littlefs_url)) {
            continue;
        }

        releases[release_count].version = tag;
        releases[release_count].firmware_url = firmware_url;
        releases[release_count].littlefs_url = littlefs_url;
        releases[release_count].is_prerelease = is_prerelease || isBetaVersion(tag);
        releases[release_count].published_at = release["published_at"].as<String>();
        releases[release_count].valid = true;

        Serial.printf("[OTA] Release %d: %s %s\n", 
                      release_count, 
                      tag.c_str(), 
                      releases[release_count].is_prerelease ? "(beta)" : "(stable)");

        release_count++;
    }
    
    Serial.printf("[OTA] Total valid releases: %d\n", release_count);
    
    // Provide helpful feedback if no releases found
    if (release_count == 0) {
        if (releasesArray.size() > 0) {
            release_fetch_error = "No compatible firmware found in releases";
            Serial.println("[OTA] No releases matched the filter criteria or had compatible firmware");
        } else {
            release_fetch_error = "No releases published in repository";
            Serial.println("[OTA] Repository has no releases");
        }
    } else {
        releases_cached = true;
        release_fetch_error = "";
    }
    
    Serial.println("[OTA] ==========================================");
    return release_count;
}

ReleaseInfo OTADownloader::getRelease(int index) const {
    if (index >= 0 && index < release_count && releases[index].valid) {
        return releases[index];
    }
    
    ReleaseInfo empty;
    empty.valid = false;
    return empty;
}

bool OTADownloader::installRelease(int index) {
    if (index < 0 || index >= release_count || !releases[index].valid) {
        updateStatus(OTAStatus::ERROR_NO_FIRMWARE, "Invalid release index");
        return false;
    }
    
    ReleaseInfo& release = releases[index];
    Serial.printf("[OTA] Installing release: %s\n", release.version.c_str());
    updateProgress(10, "Installing " + release.version);
    
    return downloadAndInstall(release.firmware_url, release.littlefs_url);
}
