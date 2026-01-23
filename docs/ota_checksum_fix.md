# OTA Checksum Failure Fix & Bootstrap Protection

## Problem 1: Checksum Errors

OTA updates were failing with a checksum error:

```
E (454262) esp_image: Checksum failed. Calculated 0x31 read 0x32
[WEB] OTA upload failed (2296400 bytes)
[WEB] OTA error: Could Not Activate The Firmware
```

## Root Cause

The `patch_app_desc.py` script was registered as a **post-build** action in `platformio.ini`:

```ini
extra_scripts = pre:scripts/version.py, post:scripts/patch_app_desc.py, ...
```

This script was modifying the firmware binary **after** it was compiled to inject the version string into the ESP-IDF app descriptor. However, this happened **after** the ESP-IDF build system had already calculated and embedded the firmware checksum. When the binary was patched, the checksum no longer matched, causing OTA updates to fail validation on the device.

## Solution

**Removed the `patch_app_desc.py` post-build action** from all `platformio.ini` configurations.

The version is now properly injected **during compilation** via build flags in `platformio.ini`:

```ini
[common]
build_flags_common =
    -DFIRMWARE_VERSION=\"${version.firmware_version}\"
    -DPROJECT_VER=\"${version.firmware_version}\"
    -DAPP_PROJECT_VER=\"${version.firmware_version}\"
```

These flags are processed by the ESP-IDF build system and properly embedded into the app descriptor **before** the checksum is calculated, ensuring the checksum remains valid.

## Changes Made

### 1. Firmware (`firmware/platformio.ini`)

**Removed** `post:scripts/patch_app_desc.py` from:
- Line 60: ESP32-S3 environment
- Line 139-143: ESP32 environment

### 2. Version Injection Flow

The correct version injection flow is now:

1. **Pre-build** (`scripts/version.py`):
   - Reads version from `platformio.ini` `[version]` section
   - Sets build flags: `FIRMWARE_VERSION`, `PROJECT_VER`, `APP_PROJECT_VER`
   - Sets environment variable `PROJECT_VER` for ESP-IDF CMake

2. **Compilation**:
   - ESP-IDF embeds version into app descriptor structure
   - Calculates checksum based on final binary

3. **Post-build** (`scripts/ota_bin.py`):
   - Creates LMWB bundle (firmware + LittleFS)
   - No binary modification, just concatenation

## Verification

To verify the fix works:

1. Build firmware:
   ```bash
   cd firmware
   pio run -e esp32s3
   pio run -e esp32s3 -t buildfs
   ```

2. Check that the version is correct in the binary without post-patching

3. Upload via OTA and verify no checksum errors occur

## Related Files

- `firmware/platformio.ini` - Removed post-build patching
- `firmware/scripts/patch_app_desc.py` - No longer used (can be removed)
- `firmware/scripts/version.py` - Pre-build version injection (still used)
- `firmware/scripts/ota_bin.py` - OTA bundle creation (unchanged)

## ESP-IDF App Descriptor

The ESP-IDF app descriptor (`esp_app_desc_t`) structure contains:

```c
typedef struct {
    uint32_t magic_word;        // 0xABCD5432
    uint32_t secure_version;
    uint32_t reserv1[2];
    char version[32];           // <-- Set via PROJECT_VER during build
    char project_name[32];
    char time[16];
    char date[16];
    char idf_ver[32];
    uint8_t app_elf_sha256[32];
    uint32_t reserv2[20];
} esp_app_desc_t;
```

The version field is automatically populated by ESP-IDF during compilation when `PROJECT_VER` is defined, which happens through our build flags.

## Why This Matters

- **OTA Updates**: Invalid checksums cause OTA updates to be rejected
- **Security**: Checksum validation ensures firmware integrity
- **Reliability**: Proper version injection prevents deployment issues
- **Best Practice**: Version should be baked in during compilation, not patched afterward

---

## Problem 2: Bootstrap Partition Being Overwritten

### Issue

When using `pio run -t upload` or `pio run -t uploadfs`, PlatformIO's default behavior flashes to the **factory partition** (0x10000), which overwrites the bootstrap firmware.

### Partition Layout

| Partition | Offset (8MB) | Offset (4MB) | Purpose |
|-----------|--------------|--------------|---------|
| `factory` | 0x10000 | 0x10000 | Bootstrap firmware - **PROTECTED** |
| `ota_0` | 0x260000 | 0x150000 | Main firmware slot 1 (upload target) |
| `ota_1` | 0x4B0000 | 0x290000 | Main firmware slot 2 (OTA updates) |
| `spiffs` | 0x700000 | 0x3D0000 | LittleFS filesystem |

### Solution

**Automatic Protection**: The upload scripts now automatically redirect all uploads to the OTA partition, protecting the bootstrap.

#### All Upload Commands Are Now Safe

```bash
# Default upload - automatically redirected to ota_0 (SAFE)
pio run -e esp32s3 -t upload

# Build and upload firmware + LittleFS to OTA partition (SAFE)
pio run -e esp32s3 -t upload_all

# Same as upload_all (SAFE)
pio run -e esp32s3 -t upload_ota

# Build OTA bundle and upload to OTA partition (SAFE)
pio run -e esp32s3 -t upload_ota_bin
```

#### Bootstrap Update (Only When Intentional!)

```bash
# DANGER: Overwrites bootstrap firmware!
# Only use this when you intentionally want to update the bootstrap
pio run -e esp32s3 -t upload_factory
```

### How It Works

The `scripts/ota_bin.py` script registers a pre-upload hook that intercepts all upload commands and modifies the flash address:

1. **Pre-upload hook** detects the default upload address (0x10000)
2. **Redirects** the upload to the OTA partition address
3. **Prints a warning** so users know protection is active

```
======================================================================
[BOOTSTRAP PROTECTION] Upload redirected to OTA partition!
[BOOTSTRAP PROTECTION] Target address: 0x260000 (ota_0)
[BOOTSTRAP PROTECTION] Bootstrap at 0x10000 is PROTECTED
======================================================================
```

### Target Addresses

- **ESP32-S3 (8MB)**: Uploads firmware to `0x260000` (ota_0)
- **ESP32 (4MB)**: Uploads firmware to `0x150000` (ota_0)

This ensures the bootstrap at `0x10000` is never accidentally touched during development.

---

## Problem 3: Recovery When Using Other Flashing Tools

### Issue

If someone uses esptool.py directly, Arduino IDE, ESP Flash Download Tool, or another program to flash firmware, the PlatformIO protection won't help.

### Solution: Recovery Scripts

#### Option 1: PlatformIO Recovery (Recommended)

```bash
cd firmware_bootstrap
pio run -e esp32s3 -t flash_bootstrap      # Flash bootstrap only
pio run -e esp32s3 -t flash_bootstrap_all  # Flash bootstrap + LittleFS
```

#### Option 2: Standalone Shell Script

A standalone recovery script that works without PlatformIO:

```bash
# From project root
./scripts/recover_bootstrap.sh                      # Auto-detect port
./scripts/recover_bootstrap.sh /dev/ttyUSB0         # Specific port
./scripts/recover_bootstrap.sh /dev/cu.usbmodem* esp32s3  # macOS + chip type
```

#### Option 3: Manual esptool.py

```bash
# Build bootstrap first
cd firmware_bootstrap
pio run -e esp32s3
pio run -e esp32s3 -t buildfs

# Flash manually with esptool
esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 \
    write_flash 0x10000 .pio/build/esp32s3/firmware.bin
```

### Prevention Tips

1. **Document the partition layout** - Make it clear to all team members
2. **Use PlatformIO** - It has automatic bootstrap protection enabled
3. **Keep bootstrap binary available** - Store a known-good bootstrap.bin for recovery
4. **Label the partitions** - The partition table has descriptive names
