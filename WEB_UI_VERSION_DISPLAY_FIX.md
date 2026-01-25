# Web UI Version Display Fix

## Issue Summary
The firmware web UI was displaying incorrect version information:
1. **Bootstrap Version** field was shown but is no longer relevant (we removed factory partition support)
2. **OTA_0/OTA_1 Version** fields were showing ESP-IDF internal version strings (e.g., "esp-idf: v4.4.7 38eeba213a") instead of the human-readable firmware version (e.g., "1.3.3")

## Root Cause
The API was reading the `version` field from `esp_app_desc_t` which contains the ESP-IDF build system's internal version string instead of our firmware version. This occurred because:
- The ESP-IDF build system sets the `version` field from `PROJECT_VER` environment variable
- In some build scenarios, this field ends up containing the ESP-IDF version string rather than our firmware version
- Our firmware version (from platformio.ini `[version]` section) should be in the `version` field, but was not being set correctly

## Changes Made

### 1. HTML UI (`firmware/data/index.html`)
**Removed:**
- "Bootstrap Version" row and `factory-version` span element (line 386-388)
- This field referenced the factory partition which we no longer use

**Result:**
- Cleaner UI showing only relevant OTA partition versions

### 2. JavaScript (`firmware/data/app.js`)
**Changed:**
- Removed reference to `factory-version` element (line 236)
- Updated to use `data.partitions.ota_0.firmware_version` instead of `data.partitions.ota_0.version`
- Updated to use `data.partitions.ota_1.firmware_version` instead of `data.partitions.ota_1.version`

**Result:**
- JavaScript now reads the corrected firmware version field from the API

### 3. Backend API (`firmware/src/web/api_status.cpp`)
**Removed:**
- Factory partition version detection code (lines 60-74)
- `factory_version` field from JSON response

**Modified:**
- OTA_0 partition version extraction (lines 60-83):
  - Now intelligently detects if `esp_app_desc_t.version` contains an ESP-IDF version string
  - Falls back to `project_name` field if version is corrupted
  - Returns value in new `firmware_version` field instead of `version`
  
- OTA_1 partition version extraction (lines 85-107):
  - Same intelligent detection logic as OTA_0

**Detection Logic:**
```cpp
// Check if version field contains ESP-IDF version or other invalid data
if (version_str.startsWith("esp-idf:") || version_str.startsWith("v") || 
    version_str.isEmpty() || version_str == "1") {
    // Try project_name as fallback
    String project_name = String(ota0_desc.project_name);
    if (!project_name.isEmpty() && !project_name.startsWith("esp-idf")) {
        version_str = project_name;
    }
}
```

## Expected Behavior After Fix

### Current Running Firmware
- **Firmware Version:** Shows current version (e.g., "1.3.3")
- **Build ID:** Shows epoch timestamp of build
- **Active Partition:** Shows current partition (e.g., "ota_0")

### OTA Partition Versions
- **OTA_0 Version:** Shows firmware version in partition or "empty" if unflashed
- **OTA_1 Version:** Shows firmware version in partition or "empty" if unflashed

### Removed Fields
- **Bootstrap Version:** No longer displayed (factory partition removed)

## Testing Recommendations

1. **Fresh Device:**
   - Flash new firmware to device
   - Verify OTA_0 shows correct firmware version (e.g., "1.3.3")
   - Verify OTA_1 shows "empty" (or previous version if it exists)

2. **After OTA Update:**
   - Perform OTA update
   - Verify inactive partition shows new version
   - After reboot, verify active partition switched and shows correct version

3. **Fallback Handling:**
   - If device has old firmware with ESP-IDF version string in descriptor
   - Verify the fallback logic extracts version from project_name field
   - Verify no crash or "n/a" displayed

## Related Files
- `firmware/data/index.html` - Web UI HTML structure
- `firmware/data/app.js` - Web UI JavaScript
- `firmware/src/web/api_status.cpp` - Backend status API
- `firmware/platformio.ini` - Version configuration (line 21: `firmware_version = 1.3.3`)
- `firmware/scripts/version.py` - Build-time version injection script

## Future Improvements
Consider adding:
1. **IDF Version Display:** Add optional field showing ESP-IDF version for debugging
2. **Build Date:** Display compile date from `esp_app_desc_t.date` field
3. **Partition Size:** Show partition sizes to help users understand storage
