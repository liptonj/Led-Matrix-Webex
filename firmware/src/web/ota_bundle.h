/**
 * @file ota_bundle.h
 * @brief OTA Bundle Helper Functions
 */

#ifndef OTA_BUNDLE_H
#define OTA_BUNDLE_H

#include <Arduino.h>

namespace OTABundle {

constexpr size_t HEADER_SIZE = 16;
const uint8_t MAGIC[4] = {'L', 'M', 'W', 'B'};

inline uint32_t read_le_u32(const uint8_t* data) {
    return static_cast<uint32_t>(data[0]) |
           (static_cast<uint32_t>(data[1]) << 8) |
           (static_cast<uint32_t>(data[2]) << 16) |
           (static_cast<uint32_t>(data[3]) << 24);
}

inline bool is_bundle(const uint8_t* header) {
    return memcmp(header, MAGIC, sizeof(MAGIC)) == 0;
}

inline void parse_header(const uint8_t* header, size_t& app_size, size_t& fs_size) {
    app_size = read_le_u32(header + 4);
    fs_size = read_le_u32(header + 8);
}

} // namespace OTABundle

#endif // OTA_BUNDLE_H
