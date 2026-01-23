# mDNS Discovery - Bridge Server

## Overview

The Webex Bridge server uses mDNS (Multicast DNS) to advertise itself on the local network, allowing ESP32 devices to automatically discover and connect to the bridge without manual IP configuration.

## How It Works

### Bridge Server (Node.js)

The bridge server advertises itself using the `bonjour-service` library:

- **Service Type**: `_webex-bridge._tcp`
- **Service Name**: Configurable via `MDNS_SERVICE_NAME` environment variable (default: `webex-bridge`)
- **Port**: Configurable via `WS_PORT` environment variable (default: `8080`)
- **TXT Records**:
  - `version`: Bridge version (e.g., "1.0.0")
  - `protocol`: "websocket"

### ESP32 Firmware

The ESP32 firmware searches for the bridge using the ESP-IDF mDNS library:

- **Service Type**: `_webex-bridge._tcp`
- **Discovery**: Performed during initial setup and fallback when manual configuration fails
- **Location**: `firmware/src/discovery/mdns_manager.cpp`

## Configuration

### Environment Variables

Create a `.env` file in the `bridge/` directory:

```bash
# WebSocket Server Port
WS_PORT=8080

# mDNS Service Name (appears as <name>._webex-bridge._tcp.local)
MDNS_SERVICE_NAME=webex-bridge

# Logging Level
LOG_LEVEL=info
```

### Home Assistant Add-on

If running as a Home Assistant add-on, configure via the add-on options:

```yaml
ws_port: 8080
mdns_service_name: "webex-bridge"
log_level: "info"
```

## Testing mDNS Discovery

### Test Script

Use the provided test script to verify mDNS is working:

```bash
cd bridge
node test_mdns.js
```

This will search for `_webex-bridge._tcp` services on the network and display:
- Service name
- Host and IP addresses
- Port number
- TXT records

### Expected Output

When working correctly, you should see:

```
=== mDNS Discovery Test ===

Searching for _webex-bridge._tcp services on the local network...

✓ Found webex-bridge service:
  Name: webex-bridge
  Host: hostname.local
  Port: 8080
  Type: _webex-bridge._tcp
  Full Name: webex-bridge._webex-bridge._tcp.local
  IP Addresses:
    - 192.168.1.100
  TXT Records:
    version: 1.0.0
    protocol: websocket
```

### Manual Discovery Test (Linux/macOS)

Use `avahi-browse` (Linux) or `dns-sd` (macOS):

**Linux:**
```bash
avahi-browse -r _webex-bridge._tcp
```

**macOS:**
```bash
dns-sd -B _webex-bridge._tcp
```

## Troubleshooting

### Bridge Not Discoverable

1. **Check if the bridge is running:**
   ```bash
   cd bridge
   npm run dev
   ```
   Look for log messages:
   ```
   [info]: Starting mDNS service: webex-bridge on port 8080
   [info]: mDNS service published: webex-bridge._webex-bridge._tcp.local:8080
   ```

2. **Verify port configuration:**
   - Ensure `WS_PORT` environment variable matches the actual WebSocket server port
   - Check if the port is not blocked by a firewall

3. **Network interface issues:**
   - mDNS uses multicast UDP on port 5353
   - Some networks (especially VLANs or guest networks) block multicast traffic
   - Ensure the bridge and ESP32 are on the same network segment

4. **Firewall rules:**
   ```bash
   # Linux (allow mDNS)
   sudo ufw allow 5353/udp
   
   # macOS (should be allowed by default)
   ```

5. **Run the test script:**
   ```bash
   node bridge/test_mdns.js
   ```

### ESP32 Cannot Discover Bridge

1. **Check ESP32 logs:**
   - Look for `[MDNS] Searching for bridge server...`
   - Expected: `[MDNS] Found bridge at <ip>:<port>`
   - If failed: `[MDNS] No bridge server found`

2. **Verify service type match:**
   - ESP32 searches for: `_webex-bridge._tcp`
   - Bridge publishes: `_webex-bridge._tcp`
   - These MUST match exactly (case-sensitive)

3. **Network segmentation:**
   - ESP32 and bridge must be on the same network
   - Some routers isolate WiFi clients (AP isolation) - disable this feature
   - VLANs may prevent mDNS propagation

4. **mDNS refresh:**
   - The bridge refreshes its mDNS announcement every 60 seconds
   - TTL is 120 seconds, so the service should remain discoverable
   - Try restarting the bridge server

### Docker/Container Issues

When running in Docker, mDNS can be problematic:

1. **Use host network mode:**
   ```dockerfile
   # Dockerfile
   docker run --net=host webex-bridge
   ```

2. **Home Assistant Add-on:**
   - The config already uses `host_network: true`
   - This ensures mDNS works correctly within Home Assistant

3. **macOS Docker Desktop:**
   - Docker Desktop on macOS doesn't support host networking
   - You may need to run the bridge natively or use a VM

## Port Configuration

The bridge uses a single configurable port for WebSocket connections:

- **Default**: 8080
- **Environment Variable**: `WS_PORT`
- **Home Assistant**: `ws_port` option
- **Exposed in mDNS**: Yes, as part of the service record

**Important**: The port advertised via mDNS MUST match the actual WebSocket server port. The implementation ensures this by:

1. Reading `WS_PORT` from environment
2. Starting WebSocket server on that port
3. Passing the same port to the mDNS service for advertisement

## Architecture

```
┌─────────────────┐
│   ESP32 Device  │
│                 │
│  1. Search for  │
│  _webex-bridge  │
│     ._tcp       │
└────────┬────────┘
         │ mDNS Query
         │ (port 5353/UDP)
         ▼
┌─────────────────────────┐
│   Local Network         │
│   (Multicast DNS)       │
└────────┬────────────────┘
         │ mDNS Response
         │ (IP:8080)
         ▼
┌─────────────────┐
│  Bridge Server  │
│                 │
│  2. Advertises  │
│  webex-bridge   │
│  on port 8080   │
└─────────────────┘
```

## Security Notes

- mDNS broadcasts are unencrypted and visible to all devices on the local network
- Service name and port are publicly visible
- The bridge itself should use TLS/SSL for production deployments
- Consider network segmentation for sensitive deployments

## References

- [mDNS RFC 6762](https://datatracker.ietf.org/doc/html/rfc6762)
- [bonjour-service NPM Package](https://www.npmjs.com/package/bonjour-service)
- [ESP32 mDNS Documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/protocols/mdns.html)
