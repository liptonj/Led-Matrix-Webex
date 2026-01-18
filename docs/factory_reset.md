# Factory Reset Guide

## Overview

The factory reset feature performs a **complete reset** that returns the device to its bootstrap/factory state, as if it were freshly programmed from the factory.

## What Gets Reset

### 1. **NVS Configuration (Non-Volatile Storage)**
All device configuration is cleared:
- ✅ WiFi credentials
- ✅ Device name and display name
- ✅ Webex OAuth tokens and credentials
- ✅ MQTT broker configuration
- ✅ xAPI device configuration
- ✅ OTA update settings
- ✅ All user preferences

### 2. **OTA Data Partition**
The OTA data partition is erased, which tells the bootloader to:
- ✅ Boot from the **factory partition** (bootstrap firmware)
- ✅ Ignore any OTA-installed firmware in ota_0 or ota_1

### 3. **Filesystem Partition (LittleFS)**
The entire filesystem is erased:
- ✅ Any cached web UI files
- ✅ Any log files or temporary data
- ✅ Ensures fresh start on next boot

### 4. **OTA Partitions (Optional)**
Both OTA partitions (ota_0 and ota_1) are erased:
- ✅ Frees up flash space
- ✅ Removes any installed firmware updates
- ✅ Forces device to use factory/bootstrap firmware

## What Does NOT Get Reset

- ❌ **Factory partition** - The bootstrap firmware remains intact
- ❌ **Bootloader** - Not touched
- ❌ **Partition table** - Not modified
- ❌ **Hardware configuration** - Flash chip, PSRAM, etc.

## How to Trigger a Factory Reset

### From Web Interface

1. Navigate to device web interface (http://device-name.local or IP address)
2. Go to **Settings** page
3. Scroll to **Factory Reset** section
4. Click **"Factory Reset"** button
5. Confirm the action
6. Device will reset and reboot to bootstrap firmware

### From Serial Console

If you have serial access, you can trigger it programmatically:
```cpp
config_manager.factoryReset();
delay(1000);
ESP.restart();
```

### From API

POST request to `/api/factory-reset`:
```bash
curl -X POST http://device-ip/api/factory-reset
```

## After Factory Reset

The device will boot into the **bootstrap firmware**, which provides:

### Bootstrap Setup Wizard
1. **WiFi Provisioning**
   - Creates WiFi AP: `ESP32-Setup-XXXXXX`
   - Connect to configure WiFi credentials

2. **OTA Configuration**
   - Set GitHub releases URL for firmware updates
   - Configure automatic update preferences

3. **Initial Firmware Installation**
   - Download and install main firmware from GitHub
   - Or upload firmware binary manually

### What You'll Need to Reconfigure
After factory reset, you'll need to set up again:
- ☐ WiFi credentials
- ☐ Device name
- ☐ OTA update URL (or use default)
- ☐ Download/install main firmware
- ☐ Webex OAuth credentials (if using Webex integration)
- ☐ MQTT broker (if using sensor integration)
- ☐ All other application settings

## Partition Layout After Reset

```
┌──────────────────────────────────────────┐
│ BOOTLOADER                                │  ← Untouched
├──────────────────────────────────────────┤
│ Partition Table                           │  ← Untouched
├──────────────────────────────────────────┤
│ NVS (Config)                 [ERASED ✓]  │
├──────────────────────────────────────────┤
│ OTA Data                     [ERASED ✓]  │
├──────────────────────────────────────────┤
│ FACTORY (Bootstrap)          [ACTIVE ✓]  │  ← Device boots here
├──────────────────────────────────────────┤
│ OTA_0 Partition              [ERASED ✓]  │
├──────────────────────────────────────────┤
│ OTA_1 Partition              [ERASED ✓]  │
├──────────────────────────────────────────┤
│ SPIFFS/LittleFS              [ERASED ✓]  │
└──────────────────────────────────────────┘
```

## Technical Details

### Implementation

The factory reset performs these operations in order:

```cpp
void ConfigManager::factoryReset() {
    // 1. Clear NVS configuration
    preferences.clear();
    
    // 2. Erase OTA data partition (forces boot to factory)
    esp_partition_erase_range(otadata_partition, ...);
    
    // 3. Erase filesystem partition
    esp_partition_erase_range(spiffs_partition, ...);
    
    // 4. Erase OTA partitions
    esp_partition_erase_range(ota_0, ...);
    esp_partition_erase_range(ota_1, ...);
    
    // Device reboots to factory partition
}
```

### Boot Process After Reset

1. **Bootloader starts**
2. **Reads OTA data** → Empty/erased
3. **Falls back to factory partition**
4. **Bootstrap firmware starts**
5. **Detects no WiFi config**
6. **Starts WiFi AP for provisioning**

## Use Cases

### When to Use Factory Reset

- ✅ Selling/transferring device to another user
- ✅ Major configuration corruption
- ✅ Want to start completely fresh
- ✅ Testing initial setup flow
- ✅ Troubleshooting boot issues
- ✅ Changing device purpose/role
- ✅ Before RMA/returning device

### When NOT to Use Factory Reset

- ❌ Just want to clear Webex tokens → Use token reset
- ❌ Just want to change WiFi → Update WiFi config
- ❌ Just want to update firmware → Use OTA update
- ❌ Just want to reset display settings → Update settings individually

## Recovery Options

### If Factory Reset Fails

If the factory reset doesn't complete properly:

1. **Manual Reset via Serial**
   ```bash
   esptool.py erase_region 0x9000 0x6000    # Erase NVS + OTA data
   esptool.py erase_region 0x3D0000 0x30000 # Erase filesystem (4MB)
   # Or for 8MB:
   esptool.py erase_region 0x610000 0x1F0000 # Erase filesystem (8MB)
   ```

2. **Full Factory Flash**
   Re-flash the bootstrap firmware:
   ```bash
   cd firmware_bootstrap
   pio run -e esp32s3 -t upload
   ```

3. **Complete Flash Erase**
   Nuclear option - erase everything:
   ```bash
   esptool.py erase_flash
   # Then reflash bootloader, partitions, and bootstrap firmware
   ```

## Security Considerations

⚠️ **Important Security Notes:**

1. **Data is NOT Cryptographically Erased**
   - Flash cells are erased but data might be recoverable with specialized tools
   - For high-security scenarios, consider full flash erase

2. **Credentials in NVS**
   - WiFi passwords are erased
   - OAuth tokens are cleared
   - Certificates (if any) are removed

3. **Web UI Access**
   - Factory reset can be triggered from web UI
   - Consider adding authentication if device is exposed to untrusted networks

## Troubleshooting

### Reset Complete But Still Boots to Main Firmware

**Possible causes:**
- OTA data partition not fully erased
- Factory partition is corrupted

**Solution:**
```bash
# Force erase OTA data via serial
esptool.py erase_region 0xe000 0x2000
```

### Device Won't Boot After Reset

**Possible causes:**
- Factory partition was accidentally erased
- Bootloader corruption

**Solution:**
Re-flash factory/bootstrap firmware via USB:
```bash
cd firmware_bootstrap
pio run -e esp32s3 -t upload
```

### Reset Takes Long Time

This is normal! Erasing flash partitions can take 10-30 seconds depending on size:
- ESP32 (4MB): ~10 seconds
- ESP32-S3 (8MB): ~20-30 seconds

### Device Reboots During Reset

The factory reset erases partitions before rebooting. If power is lost during erase:
- Configuration might be partially erased
- OTA partitions might be partially erased
- Device should still boot to factory partition
- Re-run factory reset to complete the process

## Related Commands

### Check Current Boot Partition
```cpp
const esp_partition_t* running = esp_ota_get_running_partition();
Serial.printf("Running from: %s\n", running->label);
// Should show "factory" after reset
```

### Manually Set Boot to Factory
```cpp
esp_ota_set_boot_partition(factory_partition);
```

### List All Partitions
```cpp
esp_partition_iterator_t it = esp_partition_find(ESP_PARTITION_TYPE_ANY, ESP_PARTITION_SUBTYPE_ANY, NULL);
while (it != NULL) {
    const esp_partition_t* part = esp_partition_get(it);
    Serial.printf("%s @ 0x%x (%d bytes)\n", part->label, part->address, part->size);
    it = esp_partition_next(it);
}
```

## References

- [ESP-IDF Partition API](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/storage/partition.html)
- [ESP-IDF OTA Updates](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/system/ota.html)
- [ESP32 Flash Layout](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/partition-tables.html)
