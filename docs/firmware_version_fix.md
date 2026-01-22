# Firmware Version Display Fix

## Problem

The firmware was displaying the ESP-IDF version instead of the actual firmware version in the OTA partition information:

```
OTA_0 Version: esp-idf: v4.4.7 38eeba213a
```

This should show:
```
OTA_0 Version: 1.1.10
```

## Root Cause

The issue was with the ESP32 app descriptor (`esp_app_desc_t` structure) that is embedded in every firmware binary. This descriptor is read by `esp_ota_get_partition_description()` to display partition version information.

### Technical Background

1. **App Descriptor Structure**: ESP-IDF embeds an `esp_app_desc_t` structure in a special `.rodata_desc` section of every firmware binary
2. **Pre-compiled Framework**: Arduino-ESP32 v3.x uses pre-compiled ESP-IDF libraries where the app descriptor is already compiled
3. **Version Source**: The app descriptor's version field comes from the `PROJECT_VER` macro at compile time
4. **Framework Limitation**: Since Arduino-ESP32 libraries are pre-compiled, our build-time `PROJECT_VER` defines don't reach the app descriptor in the framework library

## Solution

We implemented a **post-build binary patching** approach that modifies the firmware binary after compilation to inject the correct version.

### Implementation

#### 1. Version Script (`scripts/version.py`)

- Reads the firmware version from `platformio.ini` [version] section
- Sets `PROJECT_VER` environment variable and compiler defines
- Executes before compilation (pre-build script)

#### 2. App Descriptor Patcher (`scripts/patch_app_desc.py`)

- Executes after the firmware binary is built (post-build script)
- Locates the app descriptor in the binary using the magic number `0xABCD5432`
- Patches the version field (32 bytes at offset +16 from magic) with the actual firmware version
- Verifies the patch was successful

#### 3. platformio.ini Configuration

```ini
[version]
firmware_version = 1.1.10

[esp32s3_common]
extra_scripts = pre:scripts/version.py, post:scripts/patch_app_desc.py, scripts/upload_all.py, scripts/ota_bin.py
```

### App Descriptor Structure

```c
typedef struct {
    uint32_t magic_word;        // offset 0:  0xABCD5432
    uint32_t secure_version;    // offset 4:  secure boot version
    uint32_t reserv1[2];        // offset 8:  reserved
    char version[32];           // offset 16: VERSION STRING (patched)
    char project_name[32];      // offset 48: project name
    char time[16];              // offset 80: compile time
    char date[16];              // offset 96: compile date
    char idf_ver[32];           // offset 112: IDF version
    uint8_t app_elf_sha256[32]; // offset 144: SHA256
    uint32_t reserv2[20];       // offset 176: reserved
} esp_app_desc_t; // Total: 256 bytes
```

## Files Modified

### Main Firmware
- `firmware/platformio.ini` - Added version patching scripts
- `firmware/scripts/version.py` - Version injection (updated)
- `firmware/scripts/patch_app_desc.py` - New binary patcher

### Bootstrap Firmware
- `firmware_bootstrap/platformio.ini` - Added version patching scripts
- `firmware_bootstrap/scripts/version.py` - Version injection (copied)
- `firmware_bootstrap/scripts/patch_app_desc.py` - Binary patcher (copied)

## Verification

### Build Output
```
[PATCH] Patching app descriptor with version: 1.1.10
[PATCH] Found app descriptor at offset 32
[PATCH] Successfully patched version to: 1.1.10
[PATCH] Verification: Version in binary is now: 1.1.10
```

### Binary Verification
```python
import struct
with open('firmware.bin', 'rb') as f:
    data = f.read()
    magic = struct.pack('<I', 0xABCD5432)
    pos = data.find(magic)
    version = data[pos+16:pos+48].decode('utf-8').rstrip('\x00')
    print(f'Version: {version}')  # Output: Version: 1.1.10
```

### Runtime Display
When viewing partition information via `/api/status`:
```json
{
  "partitions": {
    "ota_0": {
      "version": "1.1.10",
      "size": 2424832
    }
  }
}
```

## Why Not Override the App Descriptor?

We initially attempted to override the `esp_app_desc` symbol with our own definition, but discovered:

1. **Not Weak in Pre-compiled Library**: The Arduino-ESP32 v3.x framework has `esp_app_desc` as a regular symbol (not weak) in the pre-compiled `libapp_update.a`
2. **Linker Error**: Attempting to define our own `esp_app_desc` results in: `multiple definition of 'esp_app_desc'`
3. **Symbol Type**: `nm` shows it as `R` (read-only data), not `W` (weak)

While ESP-IDF 5.x documentation mentions the app descriptor can be overridden, this applies to native ESP-IDF builds, not Arduino framework builds with pre-compiled libraries.

## Benefits

1. **Accurate Version Display**: Users can now see the actual firmware version in partition information
2. **OTA Tracking**: Proper version tracking for OTA updates
3. **Debugging**: Easier to identify which firmware version is running on a partition
4. **No Runtime Overhead**: Patching happens at build time, no runtime performance impact

## Notes

- The patch is applied to both `firmware.bin` and OTA bundles (`firmware-ota-*.bin`)
- Works for both ESP32-S3 and ESP32 (standard) builds
- Bootstrap firmware also includes the same patching mechanism
- Build warnings about `IDF_VER` redefinition were cleaned up
