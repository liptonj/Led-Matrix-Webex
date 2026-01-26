# OTA Partition Version Display Fix

## Problem

The System Information page was showing incorrect version information for OTA partitions:
- **OTA_0 Version**: Displayed "arduino-lib-builder" instead of "1.4.3"
- **OTA_1 Version**: Displayed "empty" (correct, as no firmware was installed there)

The running firmware version displayed correctly as "1.4.3" at the top of the page.

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

Modified `firmware/src/web/api_status.cpp` to use a hybrid approach:

1. **For the currently running partition**: Use the compile-time `FIRMWARE_VERSION` macro
   - This is always accurate because it's defined at compile time from `platformio.ini`
   - Bypasses the broken esp_app_desc_t entirely for the active partition

2. **For non-running partitions**: Try to read from esp_app_desc_t
   - If the version looks invalid (starts with "arduino-lib", "esp-idf:", is empty, etc.)
   - Fall back to checking `project_name` field
   - If that's also invalid, display "unknown"

### Code Changes

```cpp
// Check if this is the currently running partition
bool is_running = (running && ota0->address == running->address);

if (is_running) {
    // Use compile-time version for running partition
    #ifdef FIRMWARE_VERSION
    ota0_info["firmware_version"] = FIRMWARE_VERSION;
    #else
    ota0_info["firmware_version"] = "unknown";
    #endif
} else {
    // Try to read from app descriptor for non-running partitions
    // with fallback logic for invalid values
}
```

## Impact

- **OTA_0 Version**: Now correctly shows "1.4.3" (the running firmware)
- **OTA_1 Version**: Shows "empty" (correct - no firmware installed)
- **No checksum issues**: No binary modification, pure runtime logic
- **Future-proof**: When OTA updates install to OTA_1, it will also show the correct version

## Testing

To verify:
1. Navigate to System Information page in the web UI
2. Check that "OTA_0 Version" shows the same version as "Firmware Version"
3. Perform an OTA update (installs to OTA_1)
4. After update, verify both partitions show correct versions

## Related Files

- `firmware/src/web/api_status.cpp` - Fixed partition version reading logic
- `firmware/platformio.ini` - Version source of truth: `[version] firmware_version = 1.4.3`
- `firmware/scripts/version.py` - Injects FIRMWARE_VERSION at compile time
- `firmware/scripts/patch_app_desc.py.deprecated` - Previous failed approach (binary patching)

## Future Improvements

If we ever switch from Arduino framework to pure ESP-IDF framework, the esp_app_desc_t will be properly populated and we can remove the "is_running" special case. However, the current hybrid approach works correctly for both frameworks.
