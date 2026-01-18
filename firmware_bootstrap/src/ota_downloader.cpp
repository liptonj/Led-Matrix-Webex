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
        // Direct firmware URL - install it
        return downloadAndInstall(ota_url);
    }
    
    // GitHub releases URL - fetch all releases
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

bool OTADownloader::fetchFirmwareUrl(const String& releases_url, String& firmware_url) {
    WiFiClientSecure client;
    client.setInsecure();  // Skip certificate validation for simplicity
    
    HTTPClient http;
    http.begin(client, releases_url);
    http.addHeader("User-Agent", "ESP32-Bootstrap");
    http.addHeader("Accept", "application/vnd.github.v3+json");
    http.setTimeout(30000);
    
    int http_code = http.GET();
    
    if (http_code != HTTP_CODE_OK) {
        updateStatus(OTAStatus::ERROR_NETWORK, 
                    String("HTTP error: ") + String(http_code));
        http.end();
        return false;
    }
    
    String payload = http.getString();
    http.end();
    
    // Parse JSON response
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);
    
    if (error) {
        updateStatus(OTAStatus::ERROR_PARSE, 
                    String("JSON parse error: ") + error.c_str());
        return false;
    }
    
    // Look for appropriate firmware in assets
    // Priority: 
    //   1. firmware-ota-esp32s3.bin (merged: app + filesystem, chip-specific ESP32-S3)
    //   2. firmware-ota-esp32.bin (merged: app + filesystem, chip-specific ESP32)
    //   3. firmware-esp32.bin (chip-specific for ESP32)
    //   4. firmware.bin (generic main firmware)
    //   5. Any .bin that's not bootstrap
    JsonArray assets = doc["assets"].as<JsonArray>();
    
    String best_match_url;
    String best_match_name;
    int best_priority = 0;  // Higher is better
    
    for (JsonObject asset : assets) {
        String name = asset["name"].as<String>();
        String name_lower = name;
        name_lower.toLowerCase();
        
        // Skip non-bin files
        if (!name_lower.endsWith(".bin")) {
            continue;
        }
        
        // Skip bootstrap firmware - we want the main app
        if (name_lower.indexOf("bootstrap") >= 0) {
            Serial.printf("[OTA] Skipping bootstrap: %s\n", name.c_str());
            continue;
        }
        
        int priority = 0;
        
        // Check for chip-specific OTA firmware (HIGHEST PRIORITY - includes filesystem)
        #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("ota") >= 0 && 
                (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0)) {
                priority = 200;  // Highest: merged OTA binary for ESP32-S3
            } else if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 100;  // High: chip-specific firmware only
            }
        #else
            // Standard ESP32 - look for esp32 but NOT esp32s3
            if (name_lower.indexOf("ota") >= 0 &&
                (name_lower.indexOf("esp32") >= 0) && 
                (name_lower.indexOf("esp32s3") < 0) && 
                (name_lower.indexOf("esp32-s3") < 0)) {
                priority = 200;  // Highest: merged OTA binary for ESP32
            } else if ((name_lower.indexOf("esp32") >= 0) && 
                (name_lower.indexOf("esp32s3") < 0) && 
                (name_lower.indexOf("esp32-s3") < 0)) {
                priority = 100;  // High: chip-specific firmware only
            }
        #endif
        
        // Generic "firmware.bin" is good (medium priority)
        if (name_lower == "firmware.bin") {
            priority = max(priority, 50);
        }
        
        // Any other .bin file (low priority fallback)
        if (priority == 0) {
            priority = 10;
        }
        
        Serial.printf("[OTA] Candidate: %s (priority %d)\n", name.c_str(), priority);
        
        if (priority > best_priority) {
            best_priority = priority;
            best_match_url = asset["browser_download_url"].as<String>();
            best_match_name = name;
        }
    }
    
    if (best_priority > 0) {
        firmware_url = best_match_url;
        Serial.printf("[OTA] Selected firmware: %s\n", best_match_name.c_str());
        updateProgress(10, "Found firmware: " + best_match_name);
        return true;
    }
    
    updateStatus(OTAStatus::ERROR_NO_FIRMWARE, "No suitable firmware found in release");
    return false;
}

bool OTADownloader::downloadAndInstall(const String& firmware_url) {
    updateStatus(OTAStatus::DOWNLOADING, "Downloading firmware...");
    updateProgress(15, "Starting download...");
    
    WiFiClientSecure client;
    client.setInsecure();  // Skip certificate validation
    
    HTTPClient http;
    http.begin(client, firmware_url);
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
    
    Serial.printf("[OTA] Firmware size: %d bytes\n", content_length);
    updateProgress(20, String("Downloading ") + String(content_length / 1024) + "KB...");
    
    // Start OTA update
    if (!Update.begin(content_length)) {
        updateStatus(OTAStatus::ERROR_FLASH, 
                    String("Not enough space: ") + Update.errorString());
        http.end();
        return false;
    }
    
    updateStatus(OTAStatus::FLASHING, "Flashing firmware...");
    
    // Stream download to flash
    WiFiClient* stream = http.getStreamPtr();
    uint8_t buffer[OTA_BUFFER_SIZE];
    size_t written = 0;
    
    unsigned long start_time = millis();
    
    while (written < content_length) {
        // Check timeout
        if (millis() - start_time > OTA_DOWNLOAD_TIMEOUT_MS) {
            updateStatus(OTAStatus::ERROR_DOWNLOAD, "Download timeout");
            Update.abort();
            http.end();
            return false;
        }
        
        // Read available data
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
        
        // Write to flash
        size_t bytes_written = Update.write(buffer, bytes_read);
        if (bytes_written != bytes_read) {
            updateStatus(OTAStatus::ERROR_FLASH, 
                        String("Flash write error: ") + Update.errorString());
            Update.abort();
            http.end();
            return false;
        }
        
        written += bytes_written;
        
        // Update progress (20-90%)
        int download_progress = 20 + (written * 70 / content_length);
        updateProgress(download_progress, 
                      String("Flashing: ") + String(written / 1024) + "/" + 
                      String(content_length / 1024) + "KB");
    }
    
    http.end();
    
    updateProgress(95, "Verifying...");
    
    // Finalize update
    if (!Update.end(true)) {
        updateStatus(OTAStatus::ERROR_VERIFY, 
                    String("Verification failed: ") + Update.errorString());
        return false;
    }
    
    updateStatus(OTAStatus::SUCCESS, "Update successful!");
    updateProgress(100, "Rebooting...");
    
    Serial.println("[OTA] Firmware update complete, rebooting in 2 seconds...");
    delay(2000);
    
    ESP.restart();
    
    return true;  // Won't reach here
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
        
        // Find firmware asset for this chip
        JsonArray assets = release["assets"].as<JsonArray>();
        String firmware_url = "";
        int best_priority = 0;
        
        for (JsonObject asset : assets) {
            String name = asset["name"].as<String>();
            String name_lower = name;
            name_lower.toLowerCase();
            
            // Skip non-bin and bootstrap files
            if (!name_lower.endsWith(".bin") || name_lower.indexOf("bootstrap") >= 0) {
                continue;
            }
            
            int priority = 0;
            
            // Prioritize merged OTA binaries (include filesystem)
            #if defined(ESP32_S3_BOARD)
            if (name_lower.indexOf("ota") >= 0 && 
                (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0)) {
                priority = 200;  // Highest: merged OTA binary
            } else if (name_lower.indexOf("esp32s3") >= 0 || name_lower.indexOf("esp32-s3") >= 0) {
                priority = 100;  // High: chip-specific firmware only
            }
            #else
            if (name_lower.indexOf("ota") >= 0 &&
                (name_lower.indexOf("esp32") >= 0) && 
                (name_lower.indexOf("esp32s3") < 0) && 
                (name_lower.indexOf("esp32-s3") < 0)) {
                priority = 200;  // Highest: merged OTA binary
            } else if ((name_lower.indexOf("esp32") >= 0) && 
                (name_lower.indexOf("esp32s3") < 0) && 
                (name_lower.indexOf("esp32-s3") < 0)) {
                priority = 100;  // High: chip-specific firmware only
            }
            #endif
            
            // Fallback to generic firmware.bin
            if (name_lower == "firmware.bin" && priority == 0) {
                priority = 50;
            }
            
            if (priority > best_priority) {
                best_priority = priority;
                firmware_url = asset["browser_download_url"].as<String>();
            }
        }
        
        if (!firmware_url.isEmpty()) {
            releases[release_count].version = tag;
            releases[release_count].firmware_url = firmware_url;
            releases[release_count].is_prerelease = is_prerelease || isBetaVersion(tag);
            releases[release_count].published_at = release["published_at"].as<String>();
            releases[release_count].valid = true;
            
            Serial.printf("[OTA] Release %d: %s %s\n", 
                          release_count, 
                          tag.c_str(), 
                          releases[release_count].is_prerelease ? "(beta)" : "(stable)");
            
            release_count++;
        }
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
    
    return downloadAndInstall(release.firmware_url);
}
