# OTA Partition Version Display Fix

## Problem

The System Information page was showing incorrect version information for OTA partitions:
- **OTA_0 Version**: Displayed "arduino-lib-builder" instead of "1.4.3"
- **OTA_1 Version**: Displayed "empty" (correct, as no firmware was installed there)

The running firmware version displayed correctly as "1.4.3" at the top of the page.

**Critical Question**: What happens if we have OTA_1 installed and want to see the version on both partitions?

## Root Cause

The ESP-IDF framework stores firmware metadata in an `esp_app_desc_t` structure that gets baked into each firmware binary at compile time. This structure contains fields like:
- `version` - Should contain the firmware version (e.g., "1.4.3")
- `project_name` - Should contain the project name
- `idf_ver` - ESP-IDF version string

However, when using the **Arduino framework** with PlatformIO (instead of pure ESP-IDF), the build system doesn't properly populate these fields. Common issues:
- `version` field contains "arduino-lib-builder" (the Arduino library build tool name)
- `project_name` field also contains "arduino-lib-builder" or generic names
- `PROJECT_VER` environment variable and build flags are not passed through to the app descriptor

### Why Binary Patching Doesn't Work

A previous attempt tried to patch the binary after compilation to inject the correct version. This approach had critical flaws:
- **Breaks checksums**: OTA updates verify firmware integrity using SHA256 checksums
- **Invalid signatures**: Post-build modifications invalidate the app descriptor checksum
- **Update failures**: Modified binaries fail OTA update verification

Reference: `firmware/scripts/patch_app_desc.py.deprecated`

## Solution

Implemented a **hybrid approach** using NVS (Non-Volatile Storage) to track partition versions:

### 1. Version Storage in NVS

Added new methods to `ConfigManager` to store and retrieve partition versions:
- `getPartitionVersion(partition_label)` - Read stored version for a partition
- `setPartitionVersion(partition_label, version)` - Store version for a partition
- `clearPartitionVersion(partition_label)` - Clear stored version

Storage keys: `part_ver_ota_0`, `part_ver_ota_1`

### 2. Store Version on Boot

In `main.cpp` setup(), after config_manager initializes:
```cpp
const esp_partition_t* running = esp_ota_get_running_partition();
if (running) {
    config_manager.setPartitionVersion(String(running->label), FIRMWARE_VERSION);
}
```

This ensures the currently running partition's version is always tracked.

### 3. Store Version After OTA Update

In `ota_manager.cpp`, after successfully setting the boot partition:
```cpp
esp_err_t err = esp_ota_set_boot_partition(target_partition);
if (err == ESP_OK) {
    config_manager.setPartitionVersion(String(target_partition->label), latest_version);
}
```

This stores the version of the newly installed firmware.

### 4. Read Version in API

Modified `api_status.cpp` to use a fallback chain:

**For currently running partition:**
1. Use compile-time `FIRMWARE_VERSION` macro (always accurate)

**For non-running partitions:**
1. Try stored version from NVS (from OTA update)
2. If not found, try reading from `esp_app_desc_t`
3. If that's invalid, fall back to "unknown"

```cpp
if (is_running) {
    // Use compile-time version
    ota0_info["firmware_version"] = FIRMWARE_VERSION;
} else {
    // Check NVS storage first
    String stored_version = config_manager->getPartitionVersion("ota_0");
    if (!stored_version.isEmpty()) {
        ota0_info["firmware_version"] = stored_version;
    } else {
        // Fallback to app descriptor (likely broken with Arduino)
        // ... fallback logic ...
    }
}
```

## Scenarios

### Scenario 1: Initial Boot (OTA_0 running, OTA_1 empty)
- **OTA_0**: Running partition → Uses `FIRMWARE_VERSION` → "1.4.3" ✓
- **OTA_1**: Empty → Shows "empty" ✓
- **Stored in NVS**: `part_ver_ota_0 = "1.4.3"`

### Scenario 2: After OTA Update to v1.4.4 (OTA_1 now running)
- **OTA Update**: Writes v1.4.4 to OTA_1, stores in NVS
- **Reboot**: Device boots from OTA_1
- **Boot Process**: Stores `part_ver_ota_1 = "1.4.4"` in NVS
- **Display**:
  - **OTA_1**: Running partition → Uses `FIRMWARE_VERSION` → "1.4.4" ✓
  - **OTA_0**: Non-running → Reads NVS → "1.4.3" ✓

### Scenario 3: After Another Update to v1.4.5 (Back to OTA_0)
- **OTA Update**: Writes v1.4.5 to OTA_0 (overwrites old 1.4.3), stores in NVS
- **Reboot**: Device boots from OTA_0
- **Boot Process**: Updates `part_ver_ota_0 = "1.4.5"` in NVS
- **Display**:
  - **OTA_0**: Running partition → Uses `FIRMWARE_VERSION` → "1.4.5" ✓
  - **OTA_1**: Non-running → Reads NVS → "1.4.4" ✓

## Files Modified

### New/Modified Files
- `firmware/src/config/config_manager.h` - Added partition version methods
- `firmware/src/config/config_manager.cpp` - Implemented NVS storage for partition versions
- `firmware/src/ota/ota_manager.cpp` - Store version after successful OTA update
- `firmware/src/main.cpp` - Store running partition version on boot
- `firmware/src/web/api_status.cpp` - Use NVS-stored versions with fallback logic

### Documentation
- `docs/ota_partition_version_fix.md` - This file

## Impact

- **Current State**: OTA_0 will immediately show "1.4.3" after rebuild/flash (stored on first boot)
- **After OTA Update**: Both partitions will show correct versions
- **No Checksum Issues**: No binary modification, only runtime NVS storage
- **Persistent**: Versions survive reboots and are updated automatically
- **Backward Compatible**: Fallback logic handles partitions without stored versions

## Testing Checklist

- [x] Navigate to System Information page
- [x] Verify OTA_0 shows correct version (1.4.3)
- [ ] Perform OTA update to new version (e.g., 1.4.4)
- [ ] After reboot, verify both partitions show correct versions
- [ ] Perform another OTA update (back to alternate partition)
- [ ] Verify versions are correct and track across multiple updates

## Future Improvements

1. **Migration**: On first boot with this new code, it will populate NVS with current version
2. **Cleanup**: Could add a method to clear all partition version data during factory reset
3. **ESP-IDF Migration**: If we switch from Arduino to pure ESP-IDF, we could remove the workaround and rely on `esp_app_desc_t` directly

## Related Issues

- Arduino framework doesn't properly set `PROJECT_VER` in app descriptor
- Binary patching breaks OTA checksums (previous failed approach)
- Need to track versions across multiple partition swaps
