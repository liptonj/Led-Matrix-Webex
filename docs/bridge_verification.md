# Bridge Server Verification Guide

This guide provides steps to verify and troubleshoot the bridge server configuration.

## Prerequisites

- Bridge server running in Home Assistant (or standalone)
- Access to the same network as the ESP32 device
- Terminal access with `dns-sd` (macOS/Linux) or Bonjour Browser

## Verification Steps

### 1. Verify Bridge Server is Running

**Home Assistant Users:**

```bash
# Check if addon is running
ha addons info webex_bridge

# View bridge addon logs
ha addons logs webex_bridge

# Look for this line in the logs:
# "WebSocket server started on port XXXX"
```

**Standalone Node.js:**

```bash
# Check if process is running
ps aux | grep "node.*bridge"

# Check logs for startup message
# Should see: "Webex Bridge Server is running on port XXXX"
```

### 2. Identify the Actual Port

The bridge server may run on a non-standard port. Check:

**From Home Assistant Addon Configuration:**
1. Open Home Assistant
2. Go to Settings → Add-ons
3. Click "Webex Bridge"
4. Check the "ws_port" setting (default: 8080)

**From Bridge Logs:**
Look for the line:
```
WebSocket server started on port XXXX
```

**Important:** Note this port number - you'll need it for configuration!

### 3. Test Local Network Connectivity

**Test with wscat:**

```bash
# Install wscat if needed
npm install -g wscat

# Test plain WebSocket connection (replace PORT with actual port)
wscat -c ws://homeassistant.local:PORT

# Or use the bridge server's IP directly
wscat -c ws://192.168.X.X:PORT

# Expected result: Connection successful, you should see a JSON message
```

### 4. Verify mDNS Advertisement

**macOS/Linux:**

```bash
# Discover all Webex bridge services
dns-sd -B _webex-bridge._tcp

# Should see something like:
# Browsing for _webex-bridge._tcp
# Timestamp A/R Flags if Domain Service Type Instance Name
# XX:XX:XX.XXX Add     2   4  local. _webex-bridge._tcp. webex-bridge
```

**Query specific service details:**

```bash
# Get full service information
dns-sd -L "webex-bridge" _webex-bridge._tcp

# Should show:
# - Hostname
# - Port number
# - IP address
```

**Windows:**
- Download and use [Bonjour Browser](https://hobbyistsoftware.com/bonjourbrowser)
- Look for "_webex-bridge._tcp" in the service list

### 5. Test Cloud Connection (Cloudflare Tunnel)

```bash
# Test SSL WebSocket connection through Cloudflare
wscat -c wss://bridge.5ls.us

# Expected result: Connection successful with JSON message
# If this fails, check Cloudflare tunnel configuration
```

### 6. Verify Cloudflare Tunnel Configuration

**Check tunnel forwarding:**
1. Log into Cloudflare dashboard
2. Go to Zero Trust → Access → Tunnels
3. Find your tunnel and check:
   - Public hostname: `bridge.5ls.us`
   - Service: Should point to `http://localhost:PORT` or `http://homeassistant.local:PORT`
   - Port matches the actual bridge port

**Important:** Cloudflare does SSL termination, so:
- External: `wss://bridge.5ls.us:443` (SSL)
- Internal: `ws://homeassistant.local:PORT` (plain WebSocket)

### 7. Update Configuration Files

Once you've verified the actual port, update these files:

**File: `website/public/api/bridge-config.json`**

```json
{
  "version": 1,
  "bridge": {
    "url": "wss://bridge.5ls.us",
    "fallback_url": "ws://homeassistant.local:ACTUAL_PORT"
  },
  "features": {
    "pairing_enabled": true
  },
  "updated_at": "2026-01-22T00:00:00Z"
}
```

Replace `ACTUAL_PORT` with the port from step 2.

**File: `webex-bridge/config.yaml`**

```yaml
options:
  ws_port: ACTUAL_PORT  # Update if different from 8080
  log_level: "info"
```

## Common Issues and Solutions

### Issue 1: mDNS Not Found

**Symptoms:**
- ESP32 logs show: "No bridge server found"
- `dns-sd` doesn't list the service

**Solutions:**
1. Restart bridge server
2. Check bridge logs for mDNS errors
3. Verify bridge is on the same network/VLAN as ESP32
4. Check router doesn't block multicast (mDNS uses multicast DNS)

### Issue 2: SSL Connection Fails

**Symptoms:**
- ESP32 logs show: "SSL/Certificate error detected!"
- Connection timeouts when using `wss://`

**Solutions:**
1. Verify time is synced on ESP32 (required for cert validation)
2. Check CA certificates are included in firmware
3. Verify Cloudflare tunnel is running

### Issue 3: Port Mismatch

**Symptoms:**
- mDNS finds bridge but connection fails
- Local connection works but wrong port

**Solutions:**
1. Check actual port in bridge logs
2. Update `bridge-config.json` with correct port
3. Restart ESP32 after config update

### Issue 4: Cloudflare Tunnel Not Forwarding

**Symptoms:**
- `wscat -c wss://bridge.5ls.us` times out
- Embedded app can't connect

**Solutions:**
1. Check tunnel status in Cloudflare dashboard
2. Verify service URL matches bridge port
3. Test local bridge directly to isolate issue
4. Check Cloudflare tunnel logs

## Testing Matrix

After verification, test these scenarios:

| Scenario | Expected Result |
|----------|----------------|
| ESP32 on home network + bridge running | Should connect via mDNS or cloud |
| ESP32 on remote network | Should connect via Cloudflare tunnel |
| Bridge restart | ESP32 should reconnect automatically |
| Cloudflare tunnel down | ESP32 should fall back to local mDNS |
| mDNS blocked | ESP32 should still connect via cloud |

## Logging and Debugging

**Enable verbose logging on ESP32:**
- Set `LOG_LEVEL=debug` in firmware build
- Watch for detailed mDNS and SSL messages

**Enable verbose logging on bridge:**
- Edit `config.yaml`: `log_level: "debug"`
- Restart bridge addon
- Check logs for WebSocket connection attempts

**Key log messages to look for:**

**ESP32 (successful connection):**
```
[BRIDGE] Using SSL with Cloudflare CA certificates
[BRIDGE] Connected to bridge.5ls.us
[BRIDGE] Joined room: XXXXXX (app connected: 1)
```

**Bridge Server (successful connection):**
```
WebSocket server started on port XXXX
New connection: client-XXXXXXXXXX
Display joined room XXXXXX
```

## Quick Diagnostic Commands

```bash
# One-line checks for quick diagnosis

# 1. Check if bridge process is running
ps aux | grep -E "(node.*bridge|webex.*bridge)"

# 2. Check if port is listening (replace PORT)
netstat -an | grep PORT

# 3. Test local connectivity
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  http://homeassistant.local:PORT/

# 4. Check mDNS
dns-sd -B _webex-bridge._tcp local. | head -20

# 5. Test Cloudflare
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  https://bridge.5ls.us/
```

## Support Information

If issues persist after following this guide:

1. Collect logs from both ESP32 and bridge server
2. Note the actual port number from bridge logs
3. Document which connection methods work/fail:
   - mDNS local discovery
   - Direct local connection (ws://IP:PORT)
   - Cloud connection (wss://bridge.5ls.us)
4. Check network configuration:
   - VLANs that might block mDNS
   - Firewalls blocking WebSocket connections
   - DNS resolution for homeassistant.local
