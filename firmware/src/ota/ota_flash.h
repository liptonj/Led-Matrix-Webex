/**
 * @file ota_flash.h
 * @brief OTA Flash and Partition Operations Header
 */

#ifndef OTA_FLASH_H
#define OTA_FLASH_H

#include <Arduino.h>
#ifndef NATIVE_BUILD
#include <esp_partition.h>
#endif

namespace OTAManagerFlash {

#ifndef NATIVE_BUILD
/**
 * @brief Get the target OTA partition for firmware updates
 * @return Pointer to target partition, or nullptr if none available
 */
const esp_partition_t* getTargetPartition();
#endif

/**
 * @brief Begin an OTA update operation
 * @param contentLength Size of the update in bytes
 * @param update_type Update type (U_FLASH or U_SPIFFS)
 * @param target_partition Target partition (for U_FLASH) or nullptr
 * @return true if update began successfully
 */
bool beginUpdate(size_t contentLength, int update_type, const esp_partition_t* target_partition);

/**
 * @brief Finalize an OTA update operation
 * @param update_type Update type (U_FLASH or U_SPIFFS)
 * @param target_partition Target partition (for U_FLASH) or nullptr
 * @param version Version string to store in NVS
 * @return true if update finalized successfully
 */
bool finalizeUpdate(int update_type, const esp_partition_t* target_partition, const String& version);

}  // namespace OTAManagerFlash

#endif  // OTA_FLASH_H
