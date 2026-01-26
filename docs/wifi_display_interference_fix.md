# WiFi and Display Interference Fix

## Summary

Fixed critical issue where the LED matrix display showed visual artifacts, flickering, or corruption after configuring WiFi through the captive portal and rebooting.

## Root Cause

**WiFi power save mode interference with I2S DMA timing.**

The ESP32-S3's WiFi radio and I2S DMA (used for LED matrix) share system resources. When WiFi power save is enabled (the default), the radio performs periodic modem sleep cycles that interfere with the precise timing required for the LED matrix display (120Hz refresh rate).

This manifests as:
- Display flickering
- Color corruption (wrong colors)
- Garbled or random pixels
- Horizontal lines/artifacts
- Issues worse during WiFi activity (scanning, connecting, data transfer)

## The Fix

### 1. Disable WiFi Power Save at Startup

```cpp
// In wifi_manager.cpp - setupWiFi()
void WiFiManager::setupWiFi() {
    // CRITICAL: Disable WiFi power save FIRST to prevent display interference
    WiFi.setSleep(WIFI_PS_NONE);
    Serial.println("[WIFI] WiFi power save disabled (prevents display interference)");
    
    // ... rest of WiFi initialization
}
```

**Key Points:**
- Set **once** at the start of WiFi initialization
- Applied **before** any WiFi operations (scan, connect, etc.)
- Ensures stable display regardless of WiFi mode (AP, STA, scanning, etc.)
- Minimal power impact (~30-50mA) compared to display power (2-4A)

### 2. Clean Up Pending Scans Before Reboot

```cpp
// In api_wifi.cpp - handleWifiSave()
void WebServerManager::handleWifiSave(...) {
    // CRITICAL: Clean up any pending async WiFi scan before rebooting
    int16_t scan_status = WiFi.scanComplete();
    if (scan_status == WIFI_SCAN_RUNNING) {
        Serial.println("[WEB] Cleaning up pending WiFi scan before reboot...");
        WiFi.scanDelete();
    }
    
    // ... save credentials and reboot
}
```

This prevents scan interference during reboot and ensures clean display initialization on next boot.

## Technical Background

### ESP32 Resource Sharing

The ESP32/ESP32-S3 architecture has shared resources between subsystems:

```
┌─────────────────────────────────────┐
│         ESP32-S3 SoC                │
│                                     │
│  ┌──────────┐      ┌──────────┐   │
│  │   WiFi   │◄────►│  I2S DMA │   │
│  │  Radio   │      │  Engine  │   │
│  └──────────┘      └──────────┘   │
│       ▲                  ▲          │
│       │                  │          │
│       └─────Shared───────┘          │
│           Bus/IRQ/Clock              │
└─────────────────────────────────────┘
```

When WiFi enters power save mode:
1. Radio sleeps between beacon intervals
2. IRQ bursts occur when radio wakes
3. Bus arbitration priorities shift
4. I2S DMA timing can be disrupted
5. LED matrix sees timing glitches → visual artifacts

### WiFi Power Save Modes

| Mode | Description | Power | Display Impact |
|------|-------------|-------|----------------|
| `WIFI_PS_NONE` | No power save | Highest | **No interference** ✓ |
| `WIFI_PS_MIN_MODEM` | Light modem sleep | Medium | Occasional glitches |
| `WIFI_PS_MAX_MODEM` | Deep modem sleep (default) | Lowest | **Frequent artifacts** ✗ |

### Display Timing Requirements

The LED matrix requires:
- **120Hz refresh rate** (configurable, min 100Hz)
- **20MHz I2S clock** for data transmission
- **Microsecond-precision timing** for latch/blanking
- **Uninterrupted DMA transfers** for stable output

Any timing disruption → visible artifacts.

## Files Modified

1. **firmware/src/wifi/wifi_manager.cpp**
   - Added `WiFi.setSleep(WIFI_PS_NONE)` at start of `setupWiFi()`
   - Ensures power save is disabled before any WiFi operations
   - Added explanatory comments about display interference

2. **firmware/src/web/api_wifi.cpp**
   - Added scan cleanup before reboot in `handleWifiSave()`
   - Prevents async scan interference during device restart

## Testing Procedure

### Before Fix (Expected Symptoms)
1. Device boots with display working normally
2. Configure WiFi through captive portal at 192.168.4.1
3. Device reboots
4. **Display shows artifacts:** flickering, wrong colors, garbled pixels
5. May worsen during WiFi activity (web requests, data transfer)

### After Fix (Expected Results)
1. Device boots with display working normally
2. Configure WiFi through captive portal
3. Device reboots
4. **Display remains clean and stable** ✓
5. No artifacts during WiFi operations
6. Colors are correct and consistent
7. No flickering or timing issues

### Test Cases

#### Basic Display Stability
```bash
# 1. Flash firmware with fix
pio run --target upload

# 2. Monitor serial output
pio device monitor

# 3. Look for this log line:
# [WIFI] WiFi power save disabled (prevents display interference)

# 4. Visually inspect display:
# - Should show clear startup screen
# - Colors should be accurate
# - No flickering or artifacts
```

#### WiFi Configuration Test
```bash
# 1. Connect to "Webex-Display-Setup" AP
# 2. Open http://192.168.4.1
# 3. Scan networks (should work - see other fix)
# 4. Enter WiFi credentials
# 5. Click Save
# 6. Device reboots
# 7. **Check display immediately after boot**
# 8. Display should be clean with no artifacts
```

#### Stress Test
```bash
# Test display stability during high WiFi activity
# 1. Connect device to WiFi
# 2. Continuously fetch status API:
while true; do
  curl http://<device-ip>/api/status
  sleep 1
done

# 3. Display should remain stable
# 4. No flickering or color changes
```

## Power Consumption Impact

### Analysis

**Display Power:**
- LED Matrix: 2-4A @ 5V = 10-20W
- Full brightness, all white pixels

**WiFi Power (added by fix):**
- With power save: ~100-150mA average
- Without power save (our fix): ~150-200mA average
- **Difference: ~30-50mA = 0.15-0.25W**

**Conclusion:**
- Power increase: **1-2% of total system power**
- Display stability: **Critical for user experience**
- Trade-off: **Absolutely worth it** ✓

### Battery Operation

If running on battery:
- Disabling WiFi power save adds ~30-50mA
- For 5000mAh battery: ~2-3 hours less runtime
- **Better option:** Reduce display brightness to save 10x more power
- Example: 50% brightness saves 1-2A vs 50mA from WiFi

## Troubleshooting

### If Display Still Has Artifacts

1. **Check serial log for power save disable message:**
   ```
   [WIFI] WiFi power save disabled (prevents display interference)
   ```
   If missing → firmware not properly flashed

2. **Check power supply:**
   - Minimum 2.5A @ 5V required
   - Insufficient power causes similar symptoms
   - Try different power adapter

3. **Check wiring:**
   - Loose HUB75 cable can cause artifacts
   - Verify all GND connections solid
   - Check pin assignments match code

4. **Check for other interference:**
   - USB cable quality (for ESP32 power)
   - Nearby RF sources
   - Long wires (reduce length)

### If WiFi Performance Suffers

Disabling power save should **not** impact WiFi performance. In fact, it may improve:
- Lower latency (no wake-up delays)
- More consistent throughput
- Better real-time responsiveness

If issues occur:
- Check WiFi signal strength (should be >-70 dBm)
- Check router settings (QoS, channel congestion)
- May be unrelated to power save setting

## Related Issues and Fixes

This display fix is part of a larger WiFi/display improvements:

1. **Async WiFi Scan** (also fixed)
   - Prevents web server blocking
   - Better user experience

2. **WiFi Power Save Disable** (this fix)
   - Prevents display interference
   - Critical for stability

3. **Scan Cleanup Before Reboot** (this fix)
   - Ensures clean initialization
   - Prevents edge case issues

All three work together to provide stable, reliable operation.

## References

- ESP32 Technical Reference Manual - WiFi Power Save
- ESP-IDF WiFi API Documentation
- ESP32-HUB75-MatrixPanel-I2S-DMA Library Issues
- Community reports of WiFi/I2S interference

## Future Improvements

### Short Term
- Monitor WiFi current consumption via INA219
- Add runtime power save toggle (dev mode)
- Log display glitch events for debugging

### Long Term
- Investigate dynamic power save (enable during idle periods)
- Test with different I2S configurations
- Consider hardware-level isolation (separate power domains)

### Not Recommended
- Trying to use WiFi power save with LED matrix
- Reduces I2S clock speed (causes flicker)
- Using lower refresh rates (visible flicker)

The current solution (disable power save) is the **best practice** for ESP32 + LED matrix applications.
