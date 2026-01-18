# OTA Updates - Merged Binary Approach

## Overview

This project uses **merged OTA binaries** that combine both the application firmware and LittleFS filesystem into a single binary file. This ensures that the firmware code and web UI assets are always synchronized during over-the-air updates.

## Why Merged Binaries?

### The Problem
Without merged binaries, OTA updates would only flash the application partition, leaving the filesystem partition untouched. This creates version mismatches where:
- ✅ Firmware code is updated to v1.0.4
- ❌ Web UI files remain at v1.0.3
- ⚠️ API endpoints and UI features can become incompatible

### The Solution
Merged binaries combine both partitions at build time with proper offsets:
- ✅ Single binary file for OTA updates
- ✅ Firmware and filesystem always stay in sync
- ✅ No manual intervention needed
- ✅ Simpler deployment process

## Binary Types

The CI/CD pipeline produces two types of binaries for each hardware variant:

### 1. Standalone Binaries (for factory programming)
- `firmware-esp32s3.bin` - Application only
- `littlefs-esp32s3.bin` - Filesystem only
- `bootloader-esp32s3.bin` - Bootloader
- `partitions-esp32s3.bin` - Partition table

Used for: Initial factory programming via USB/UART with esptool.py

### 2. Merged OTA Binaries (for OTA updates)
- `firmware-ota-esp32s3.bin` - Application + Filesystem combined
- `firmware-ota-esp32.bin` - Application + Filesystem combined
- `bootstrap-ota-esp32s3.bin` - Bootstrap app + filesystem combined
- `bootstrap-ota-esp32.bin` - Bootstrap app + filesystem combined

Used for: Over-the-air updates via GitHub Releases

## Partition Layout

### ESP32-S3 (8MB Flash)
```
Partition      Offset      Size        Contents
---------      ------      ----        --------
nvs            0x9000      20KB        Non-volatile storage
otadata        0xe000      8KB         OTA data
factory        0x10000     2MB         Factory firmware
ota_0          0x210000    2MB         OTA partition 0
ota_1          0x410000    2MB         OTA partition 1
spiffs         0x610000    ~2MB        LittleFS filesystem (shared)
```

### ESP32 (4MB Flash)
```
Partition      Offset      Size        Contents
---------      ------      ----        --------
nvs            0x9000      20KB        Non-volatile storage
otadata        0xe000      8KB         OTA data
factory        0x10000     1.25MB      Factory firmware
ota_0          0x150000    1.25MB      OTA partition 0
ota_1          0x290000    1.25MB      OTA partition 1
spiffs         0x3D0000    192KB       LittleFS filesystem (shared)
```

## How Merged Binaries Work

The merged binary contains both the application and filesystem at specific offsets:

### ESP32-S3 Merged Binary Structure
```
Offset 0x0:       Application firmware (goes to ota_0 @ 0x210000)
Offset 0x400000:  LittleFS filesystem (goes to spiffs @ 0x610000)
```

### ESP32 Merged Binary Structure
```
Offset 0x0:       Application firmware (goes to ota_0 @ 0x150000)
Offset 0x280000:  LittleFS filesystem (goes to spiffs @ 0x3D0000)
```

When the ESP32's OTA system writes the merged binary, it:
1. Writes the app section to the next available OTA partition (ota_0 or ota_1)
2. Writes the filesystem section to the spiffs partition
3. Updates the OTA data partition to boot from the new app
4. Reboots

## CI/CD Build Process

The GitHub Actions workflow (`.github/workflows/ci.yml`) performs these steps:

### For Each Hardware Variant (ESP32-S3 and ESP32)

1. **Build Application**
   ```bash
   pio run -e esp32s3
   ```

2. **Build Filesystem Image**
   ```bash
   pio run -t buildfs -e esp32s3
   ```

3. **Create Merged Binary**
   ```bash
   python -m esptool merge_bin \
     -o firmware-ota-esp32s3.bin \
     --flash_mode dio \
     --flash_freq 80m \
     --flash_size 8MB \
     0x0 firmware.bin \
     0x400000 littlefs.bin
   ```

4. **Package for Release**
   - Standalone binaries → For factory programming
   - Merged OTA binary → For OTA updates
   - ZIP archives → Complete packages

## OTA Update Priority Logic

The OTA downloader searches for binaries in this priority order:

### Priority 200 (Highest - Preferred)
- `firmware-ota-esp32s3.bin` - Merged binary for ESP32-S3
- `firmware-ota-esp32.bin` - Merged binary for ESP32
- `bootstrap-ota-esp32s3.bin` - Bootstrap merged for ESP32-S3
- `bootstrap-ota-esp32.bin` - Bootstrap merged for ESP32

### Priority 100 (High - Fallback)
- `firmware-esp32s3.bin` - Chip-specific firmware only
- `firmware-esp32.bin` - Chip-specific firmware only

### Priority 50 (Medium - Legacy)
- `firmware.bin` - Generic firmware

### Priority 10 (Low - Last Resort)
- Any other `.bin` file (excluding bootstrap)

## Usage

### For End Users
No action required! The OTA system automatically:
1. Checks for updates from GitHub Releases
2. Downloads the appropriate merged binary
3. Flashes both firmware and filesystem
4. Reboots with everything in sync

### For Developers

#### Testing OTA Updates Locally
```bash
# Build merged binary
cd firmware
pio run -e esp32s3
pio run -t buildfs -e esp32s3

# Create merged binary manually
python -m esptool merge_bin \
  -o .pio/build/esp32s3/firmware-ota.bin \
  --flash_mode dio \
  --flash_freq 80m \
  --flash_size 8MB \
  0x0 .pio/build/esp32s3/firmware.bin \
  0x400000 .pio/build/esp32s3/littlefs.bin

# Upload to test server and point OTA URL to it
```

#### Factory Programming New Devices
```bash
# Use separate binaries with esptool.py
esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 \
  write_flash -z \
  0x0 bootloader.bin \
  0x8000 partitions.bin \
  0x10000 firmware.bin \
  0x610000 littlefs.bin
```

## Troubleshooting

### OTA Update Fails
1. Check GitHub release has the merged binary (e.g., `firmware-ota-esp32s3.bin`)
2. Verify file size is larger than standalone firmware (includes filesystem)
3. Check serial logs for download errors

### Web UI Not Updated After OTA
1. Clear browser cache (the merged binary should prevent this)
2. Check if the correct merged binary was used
3. Verify the CI build succeeded in creating the merged binary

### Out of Memory During OTA
- Merged binaries are larger than standalone firmware
- ESP32 (4MB) has limited space - may need to reduce web assets
- ESP32-S3 (8MB) should have sufficient space

## Future Improvements

Potential enhancements to consider:
- [ ] Delta updates (only send changed blocks)
- [ ] Compressed filesystem images
- [ ] Separate filesystem update endpoint (for advanced users)
- [ ] Update verification with checksums
- [ ] Rollback on failed updates

## References

- [ESP-IDF OTA Documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/system/ota.html)
- [LittleFS Documentation](https://github.com/littlefs-project/littlefs)
- [Esptool.py merge_bin Command](https://docs.espressif.com/projects/esptool/en/latest/esp32/esptool/basic-commands.html#merge-binaries-for-flashing-merge-bin)
