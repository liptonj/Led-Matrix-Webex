# Bridge Reconnection Fix

## Issue
After device reboot, the LED matrix display was not reconnecting properly to the bridge WebSocket server. While WiFi connectivity was working fine, the bridge WebSocket connection was failing to re-establish.

## Root Cause
The WebSocketsClient library has an auto-reconnect feature with a 10-second interval, but there were two problems:

1. **Passive Reconnection Monitoring**: The main loop was not actively monitoring the connection state or triggering manual reconnects when needed.
2. **Insufficient Reconnection Logic**: The `reconnect()` method was only logging status messages rather than actively reinitializing the connection.
3. **No Time Sync Check**: SSL connections require synchronized system time, but reconnection attempts weren't verifying time sync before attempting SSL connections.

## Solution

### 1. Active Connection Monitoring in Main Loop
Added periodic connection health checks in `main.cpp`:

```cpp
// Check if we should be connected but aren't - trigger manual reconnect
// The WebSockets library has auto-reconnect, but we need to ensure it's working
static unsigned long last_connection_check = 0;
if (current_time - last_connection_check > 15000) {  // Check every 15 seconds
    last_connection_check = current_time;
    
    if (!bridge_client.isConnected()) {
        Serial.println("[BRIDGE] Disconnected - waiting for auto-reconnect...");
        bridge_client.reconnect();  // Log reconnect status
    }
}
```

**Why 15 seconds?**
- Library auto-reconnect interval is 10 seconds
- Checking every 15 seconds allows library to attempt auto-reconnect first
- If auto-reconnect fails, manual reconnect provides a fallback

### 2. Enhanced Reconnect Method
Improved `bridge_client.cpp::reconnect()` to actively reinitialize the connection:

```cpp
void BridgeClient::reconnect() {
    // Only attempt reconnect every 30 seconds to reduce spam
    if (millis() - last_reconnect < 30000) {
        return;
    }
    
    // Check if time is synced (required for SSL)
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
        Serial.println("[BRIDGE] Warning: System time not synced - SSL may fail");
        return;  // Don't attempt reconnect without valid time for SSL
    }
    
    // Force disconnect to reset state
    ws_client.disconnect();
    connected = false;
    joined_room = false;
    peer_connected = false;
    
    // Re-register event handler
    ws_client.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
        if (g_bridge_instance) {
            g_bridge_instance->onWebSocketEvent(type, payload, length);
        }
    });
    
    // Reinitialize connection with saved parameters
    if (use_ssl) {
        ws_client.beginSSL(bridge_host.c_str(), bridge_port, ws_path.c_str(), 
                           CA_CERT_GTS_ROOT_R4);
        ws_client.enableHeartbeat(15000, 3000, 2);
    } else {
        ws_client.begin(bridge_host, bridge_port, ws_path);
    }
    ws_client.setReconnectInterval(10000);
}
```

**Key improvements:**
- ✅ Verifies NTP time sync before SSL reconnect
- ✅ Forces full disconnect to reset state
- ✅ Re-registers event handler (ensures callbacks work)
- ✅ Reinitializes with proper SSL/non-SSL configuration
- ✅ Rate-limited to every 30 seconds to prevent spam

### 3. Room Rejoin on Reconnect
Enhanced `WStype_CONNECTED` event handler to ensure proper room rejoining:

```cpp
case WStype_CONNECTED:
    connected = true;
    
    // Reset join state on new connection
    joined_room = false;
    peer_connected = false;
    
    // Send appropriate initial message based on mode
    if (!pairing_code.isEmpty()) {
        Serial.printf("[BRIDGE] Joining room with pairing code: %s\n", pairing_code.c_str());
        sendJoinRoom();
    } else {
        Serial.println("[BRIDGE] Subscribing in legacy mode");
        sendSubscribe();
    }
    break;
```

**Why reset join state?**
- Each new WebSocket connection is fresh
- Server doesn't remember previous join state
- Must explicitly rejoin the pairing room after reconnect

### 4. Improved Logging
Added comprehensive logging for debugging connection issues:

- ✅ Disconnect events show previous connection state
- ✅ Connect events show pairing code and mode
- ✅ Join success events show room code and peer status
- ✅ Auto-reconnect status logged every 15 seconds when disconnected

## Files Modified

1. **firmware/src/main.cpp**
   - Added periodic connection health check (every 15 seconds)
   - Calls `reconnect()` when disconnected but should be connected

2. **firmware/src/bridge/bridge_client.cpp**
   - Enhanced `reconnect()` method to force reinitialize
   - Added time sync check before SSL reconnect
   - Improved connection/disconnection event logging
   - Reset join state on new connection
   - Re-register event handler on reconnect

## Testing Checklist

- [ ] Device reconnects after reboot
- [ ] Device reconnects after network interruption
- [ ] Device rejoins pairing room automatically
- [ ] Embedded app receives status updates after reconnect
- [ ] Serial logs show clear reconnection flow
- [ ] No repeated failed connection attempts (rate limiting works)
- [ ] SSL connections verify time sync before attempting

## Expected Behavior After Fix

**After Device Reboot:**
1. Device boots and connects to WiFi
2. Device initializes bridge client with pairing code
3. WebSocket connects to bridge server
4. Device automatically joins pairing room
5. Embedded app receives connection notification
6. Status updates resume flowing to display

**During Network Interruption:**
1. WebSocket disconnection detected
2. Library auto-reconnect attempts every 10 seconds
3. Manual reconnect check runs every 15 seconds as fallback
4. Upon reconnection, device rejoins room automatically
5. Status updates resume

## Serial Monitor Output Example

```
[BRIDGE] WiFi connected, initializing bridge connection...
[BRIDGE] Using cloud bridge: wss://bridge.5ls.us
[BRIDGE] Connecting to wss://bridge.5ls.us:443/ with pairing code: ABC123
[BRIDGE] ✓ WebSocket connected to bridge.5ls.us
[BRIDGE] Joining room with pairing code: ABC123
[BRIDGE] ═══════════════════════════════════════
[BRIDGE] ✓ Joined room: ABC123
[BRIDGE] ✓ App connected: YES
[BRIDGE] ═══════════════════════════════════════

... (device is running) ...

[BRIDGE] ✗ WebSocket disconnected
[BRIDGE] Connection lost (was connected=1, joined=1)
[BRIDGE] Waiting for auto-reconnect (10s interval)...
[BRIDGE] Disconnected - waiting for auto-reconnect...
[BRIDGE] Attempting manual reconnect to bridge.5ls.us:443 (System time: 14:32:15)
[BRIDGE] Manual reconnect initiated
[BRIDGE] ✓ WebSocket connected to bridge.5ls.us
[BRIDGE] Joining room with pairing code: ABC123
[BRIDGE] ✓ Joined room: ABC123
[BRIDGE] ✓ App connected: YES
```

## Additional Notes

- The library's auto-reconnect is primary mechanism (10s interval)
- Manual reconnect (every 30s) serves as fallback
- Time sync check prevents SSL failures
- Rate limiting prevents connection spam
- Event handler re-registration ensures callbacks work after reconnect
- Connection state fully resets on reconnect (clean slate)

## Version
Implemented in firmware version 1.4.4+
