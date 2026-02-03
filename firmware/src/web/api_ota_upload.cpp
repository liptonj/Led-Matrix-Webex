/**
 * @file api_ota_upload.cpp
 * @brief OTA Firmware Upload Handlers
 * 
 * Handles chunked OTA uploads including bundle format (firmware + filesystem)
 * - Chunk processing (handleOTAUploadChunk)
 * - Upload completion (handleOTAUploadComplete)
 * - Filesystem upload handlers
 */

#include "web_server.h"
#include "web_helpers.h"
#include "ota_bundle.h"
#include <Update.h>
#include <LittleFS.h>
#include <esp_ota_ops.h>
#include <ArduinoJson.h>
#include "../debug/remote_logger.h"

void WebServerManager::handleOTAUploadChunk(AsyncWebServerRequest* request,
                                            const String& filename,
                                            size_t index,
                                            uint8_t* data,
                                            size_t len,
                                            bool final,
                                            size_t total) {
    // Progress logging state (static across calls)
    static int last_web_progress = -1;

    if (index == 0) {
        ota_upload_in_progress = true;
        ota_upload_error = "";
        ota_upload_size = total > 0 ? total : request->contentLength();
        ota_bundle_header_filled = 0;
        ota_bundle_mode = false;
        ota_bundle_header_flushed = false;
        ota_bundle_app_size = 0;
        ota_bundle_fs_size = 0;
        ota_bundle_app_written = 0;
        ota_bundle_fs_written = 0;
        ota_bundle_fs_started = false;
        last_web_progress = -1;  // Reset on new upload

        Serial.printf("[WEB] OTA upload start: %s (%u bytes)\n",
                      filename.c_str(), static_cast<unsigned>(ota_upload_size));
        Serial.printf("[WEB] Starting heap: %lu bytes\n", (unsigned long)ESP.getFreeHeap());
    }

    if (ota_upload_error.isEmpty()) {
        size_t offset = 0;

        // Read and parse bundle header if needed
        if (ota_bundle_header_filled < OTABundle::HEADER_SIZE) {
            size_t to_copy = min(OTABundle::HEADER_SIZE - ota_bundle_header_filled, len);
            memcpy(ota_bundle_header + ota_bundle_header_filled, data, to_copy);
            ota_bundle_header_filled += to_copy;
            offset += to_copy;

            // Header complete - check if bundle
            if (ota_bundle_header_filled == OTABundle::HEADER_SIZE) {
                if (OTABundle::is_bundle(ota_bundle_header)) {
                    ota_bundle_mode = true;
                    OTABundle::parse_header(ota_bundle_header, ota_bundle_app_size, ota_bundle_fs_size);

                    Serial.printf("[WEB] OTA bundle detected: app=%u fs=%u\n",
                                  static_cast<unsigned>(ota_bundle_app_size),
                                  static_cast<unsigned>(ota_bundle_fs_size));

                    // Get current running partition for logging
                    const esp_partition_t* running = esp_ota_get_running_partition();
                    if (running) {
                        Serial.printf("[WEB] Currently running from: %s\n", running->label);
                    }
                    
                    ota_upload_target = esp_ota_get_next_update_partition(nullptr);
                    if (!ota_upload_target) {
                        ota_upload_error = "No OTA partition available";
                    } else {
                        Serial.printf("[WEB] OTA target partition: %s (addr=0x%06x, size=%u bytes)\n",
                                      ota_upload_target->label,
                                      static_cast<unsigned>(ota_upload_target->address),
                                      static_cast<unsigned>(ota_upload_target->size));
                    }

                    // Start app update - MUST specify partition label to write to correct partition
                    if (ota_upload_error.isEmpty() && ota_upload_target) {
                        const char* ota_label = ota_upload_target->label;
                    if (!Update.begin(ota_bundle_app_size, U_FLASH, -1, LOW, ota_label)) {
                        ota_upload_error = Update.errorString();
                        RLOG_ERROR("ota-web", "Update.begin app failed: %s", ota_upload_error.c_str());
                    }
                    }
                } else {
                    // Not a bundle - regular firmware
                    size_t firmware_total = ota_upload_size;
                    if (firmware_total == 0) {
                        ota_upload_error = "Missing content length";
                    } else {
                        // Get current running partition for logging
                        const esp_partition_t* running = esp_ota_get_running_partition();
                        if (running) {
                            Serial.printf("[WEB] Currently running from: %s\n", running->label);
                        }
                        
                        ota_upload_target = esp_ota_get_next_update_partition(nullptr);
                        if (!ota_upload_target) {
                            ota_upload_error = "No OTA partition available";
                        } else {
                            Serial.printf("[WEB] OTA target partition: %s (addr=0x%06x, size=%u bytes)\n",
                                          ota_upload_target->label,
                                          static_cast<unsigned>(ota_upload_target->address),
                                          static_cast<unsigned>(ota_upload_target->size));
                        }
                    }
                    // Start firmware update - MUST specify partition label to write to correct partition
                    if (ota_upload_error.isEmpty() && ota_upload_target) {
                        const char* ota_label = ota_upload_target->label;
                    if (!Update.begin(firmware_total, U_FLASH, -1, LOW, ota_label)) {
                        ota_upload_error = Update.errorString();
                        RLOG_ERROR("ota-web", "Update.begin firmware failed: %s", ota_upload_error.c_str());
                    }
                    }
                }
            } else {
                // Header not complete yet
                if (final) {
                    ota_upload_error = "Incomplete OTA upload";
                }
                return;
            }
        }

        // Process payload
        if (ota_bundle_mode) {
            // Bundle mode - write app then FS
            const uint8_t* ptr = data + offset;
            size_t remaining = len - offset;

            while (remaining > 0 && ota_upload_error.isEmpty()) {
                if (ota_bundle_app_written < ota_bundle_app_size) {
                    // Writing app
                    size_t to_write = min(remaining, ota_bundle_app_size - ota_bundle_app_written);
                    if (Update.write(const_cast<uint8_t*>(ptr), to_write) != to_write) {
                        ota_upload_error = Update.errorString();
                        break;
                    }
                    ota_bundle_app_written += to_write;
                    ptr += to_write;
                    remaining -= to_write;

                    // App complete - start FS
                    if (ota_bundle_app_written == ota_bundle_app_size) {
                        if (!Update.end(true)) {
                            ota_upload_error = Update.errorString();
                            break;
                        }
                        if (ota_upload_target) {
                        Serial.printf("[WEB] Setting boot partition to: %s\n", ota_upload_target->label);
                        esp_err_t err = esp_ota_set_boot_partition(ota_upload_target);
                        if (err != ESP_OK) {
                            RLOG_ERROR("ota-web", "Failed to set boot partition: %s", esp_err_to_name(err));
                            ota_upload_error = "Failed to set boot partition";
                            break;
                            } else {
                                // Verify boot partition was set correctly
                                const esp_partition_t* boot_partition = esp_ota_get_boot_partition();
                                if (boot_partition && strcmp(boot_partition->label, ota_upload_target->label) == 0) {
                                    Serial.printf("[WEB] Boot partition verified: %s\n", boot_partition->label);
                                } else {
                                    Serial.printf("[WEB] WARNING: Boot partition verification failed!\n");
                                }
                            }
                        }
                        Serial.println("[WEB] OTA bundle app complete, starting FS");

                        LittleFS.end();
                        if (!Update.begin(ota_bundle_fs_size, U_SPIFFS)) {
                            ota_upload_error = Update.errorString();
                            RLOG_ERROR("ota-web", "Update.begin FS failed: %s", ota_upload_error.c_str());
                            break;
                        }
                        ota_bundle_fs_started = true;
                    }
                } else {
                    // Writing FS
                    size_t to_write = min(remaining, ota_bundle_fs_size - ota_bundle_fs_written);
                    if (Update.write(const_cast<uint8_t*>(ptr), to_write) != to_write) {
                        ota_upload_error = Update.errorString();
                        break;
                    }
                    ota_bundle_fs_written += to_write;
                    ptr += to_write;
                    remaining -= to_write;
                }
            }
        } else {
            // Regular firmware mode
            if (!ota_bundle_header_flushed) {
                // Write buffered header
                if (Update.write(ota_bundle_header, ota_bundle_header_filled) != ota_bundle_header_filled) {
                    ota_upload_error = Update.errorString();
                }
                ota_bundle_header_flushed = true;
            }

            if (ota_upload_error.isEmpty() && offset < len) {
                if (Update.write(data + offset, len - offset) != (len - offset)) {
                    ota_upload_error = Update.errorString();
                }
            }
        }

        // Progress logging every 10% with heap monitoring
        size_t total_written = ota_bundle_mode ? 
            (ota_bundle_app_written + ota_bundle_fs_written) : 
            (index + len);
        size_t total_size = ota_bundle_mode ? 
            (ota_bundle_app_size + ota_bundle_fs_size) : 
            ota_upload_size;

        if (total_size > 0) {
            int progress = (total_written * 100) / total_size;
            if (progress / 10 > last_web_progress / 10) {
                last_web_progress = progress;
                uint32_t freeHeap = ESP.getFreeHeap();
                Serial.printf("[WEB] Upload: %d%% (heap: %u bytes)\n", progress, freeHeap);
                
                // Abort if heap critically low
                if (freeHeap < 50000 && ota_upload_error.isEmpty()) {
                    ota_upload_error = "Heap too low during upload";
                    RLOG_ERROR("ota-web", "Heap critically low: %u bytes at %d%%", freeHeap, progress);
                }
            }
        }
    }

    if (final) {
        if (ota_upload_error.isEmpty()) {
            if (ota_bundle_mode) {
                // Verify bundle completion
                if (ota_bundle_app_written != ota_bundle_app_size ||
                    ota_bundle_fs_written != ota_bundle_fs_size) {
                    ota_upload_error = "OTA bundle incomplete";
                } else if (ota_bundle_fs_started && !Update.end(true)) {
                    ota_upload_error = Update.errorString();
                }
                // Verify boot partition is set correctly (it should have been set when app completed)
                if (ota_upload_error.isEmpty() && ota_upload_target) {
                    const esp_partition_t* boot_partition = esp_ota_get_boot_partition();
                    if (boot_partition && strcmp(boot_partition->label, ota_upload_target->label) == 0) {
                        Serial.printf("[WEB] Boot partition verified for bundle: %s\n", boot_partition->label);
                    } else {
                        Serial.printf("[WEB] WARNING: Boot partition not set correctly! Expected: %s, Got: %s\n",
                                      ota_upload_target ? ota_upload_target->label : "NULL",
                                      boot_partition ? boot_partition->label : "NULL");
                        // Try to set it again
                        esp_err_t err = esp_ota_set_boot_partition(ota_upload_target);
                        if (err != ESP_OK) {
                            Serial.printf("[WEB] ERROR: Failed to set boot partition: %s\n", esp_err_to_name(err));
                            ota_upload_error = "Failed to set boot partition";
                        } else {
                            Serial.printf("[WEB] Boot partition set successfully: %s\n", ota_upload_target->label);
                        }
                    }
                }
            } else {
                // Regular firmware
                if (!Update.end(true)) {
                    ota_upload_error = Update.errorString();
                }
                if (ota_upload_error.isEmpty() && ota_upload_target) {
                    Serial.printf("[WEB] Setting boot partition to: %s\n", ota_upload_target->label);
                    esp_err_t err = esp_ota_set_boot_partition(ota_upload_target);
                    if (err != ESP_OK) {
                        RLOG_ERROR("ota-web", "Failed to set boot partition: %s", esp_err_to_name(err));
                        ota_upload_error = "Failed to set boot partition";
                    } else {
                        // Verify boot partition was set correctly
                        const esp_partition_t* boot_partition = esp_ota_get_boot_partition();
                        if (boot_partition && strcmp(boot_partition->label, ota_upload_target->label) == 0) {
                            Serial.printf("[WEB] Boot partition verified: %s\n", boot_partition->label);
                        } else {
                            Serial.printf("[WEB] WARNING: Boot partition verification failed!\n");
                        }
                    }
                }
            }
        } else {
            Update.abort();
        }

        ota_upload_in_progress = false;
        Serial.printf("[WEB] OTA upload %s (%u bytes)\n",
                      ota_upload_error.isEmpty() ? "complete" : "failed",
                      static_cast<unsigned>(ota_upload_size));
        if (!ota_upload_error.isEmpty()) {
            RLOG_ERROR("ota-web", "OTA error: %s", ota_upload_error.c_str());
        } else {
            // OTA successful - schedule reboot
            Serial.println("[WEB] OTA successful! Scheduling reboot...");
            pending_reboot = true;
            pending_reboot_time = millis() + 1000;
            pending_boot_partition = nullptr;
        }
    }
}

void WebServerManager::handleOTAUploadComplete(AsyncWebServerRequest* request) {
    JsonDocument doc;
    
    if (ota_upload_error.isEmpty()) {
        doc["success"] = true;
        doc["message"] = "Firmware update complete, rebooting...";
        sendJsonResponse(request, 200, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
    } else {
        doc["success"] = false;
        doc["error"] = ota_upload_error;
        sendJsonResponse(request, 500, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
    }
}

void WebServerManager::handleOTAFilesystemUploadChunk(AsyncWebServerRequest* request,
                                                       const String& filename,
                                                       size_t index,
                                                       uint8_t* data,
                                                       size_t len,
                                                       bool final) {
    // Filesystem-only upload (legacy - not typically used anymore)
    if (index == 0) {
        ota_upload_in_progress = true;
        ota_upload_error = "";
        Serial.printf("[WEB] Filesystem upload start: %s\n", filename.c_str());
        
        LittleFS.end();
        if (!Update.begin(request->contentLength(), U_SPIFFS)) {
            ota_upload_error = Update.errorString();
            RLOG_ERROR("ota-web", "FS Update.begin failed: %s", ota_upload_error.c_str());
        }
    }

    if (ota_upload_error.isEmpty() && len > 0) {
        if (Update.write(data, len) != len) {
            ota_upload_error = Update.errorString();
        }
    }

    if (final) {
        if (ota_upload_error.isEmpty()) {
            if (!Update.end(true)) {
                ota_upload_error = Update.errorString();
            }
        } else {
            Update.abort();
        }

        ota_upload_in_progress = false;
        Serial.printf("[WEB] Filesystem upload %s\n",
                      ota_upload_error.isEmpty() ? "complete" : "failed");
        if (!ota_upload_error.isEmpty()) {
            RLOG_ERROR("ota-web", "FS error: %s", ota_upload_error.c_str());
        }
    }
}

void WebServerManager::handleOTAFilesystemUploadComplete(AsyncWebServerRequest* request) {
    JsonDocument doc;
    
    if (ota_upload_error.isEmpty()) {
        doc["success"] = true;
        doc["message"] = "Filesystem update complete";
        sendJsonResponse(request, 200, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
    } else {
        doc["success"] = false;
        doc["error"] = ota_upload_error;
        sendJsonResponse(request, 500, doc, [this](AsyncWebServerResponse* r) { addCorsHeaders(r); });
    }
}
