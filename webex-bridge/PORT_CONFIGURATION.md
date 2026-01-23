# Bridge Server Port Configuration

## Current Configuration

The bridge server is configured to run on port **8080** by default.

**Important:** You mentioned the bridge runs on a **non-standard port**. Please verify the actual port and update configurations accordingly.

## How to Find the Actual Port

### Method 1: Check Home Assistant Addon Configuration

1. Open Home Assistant
2. Navigate to **Settings → Add-ons**
3. Click **Webex Bridge**
4. Check the **Configuration** tab
5. Look for the `ws_port` setting

### Method 2: Check Bridge Logs

Look for this line when the bridge starts:

```
WebSocket server started on port XXXX
```

or

```
Webex Bridge Server is running on port XXXX
```

### Method 3: Check Running Process

If running standalone:

```bash
# Find the bridge process
ps aux | grep "node.*bridge"

# Check what port it's listening on
netstat -an | grep LISTEN | grep node
```

## Files to Update

Once you know the actual port, update these files:

### 1. Home Assistant Addon Config

**File:** `webex-bridge/config.yaml`

```yaml
options:
  ws_port: YOUR_ACTUAL_PORT
  log_level: "info"
```

### 2. Bridge Discovery Config

**File:** `website/public/api/bridge-config.json`

```json
{
  "version": 1,
  "bridge": {
    "url": "wss://bridge.5ls.us",
    "fallback_url": "ws://homeassistant.local:YOUR_ACTUAL_PORT"
  },
  "features": {
    "pairing_enabled": true
  },
  "updated_at": "2026-01-22T00:00:00Z"
}
```

### 3. Cloudflare Tunnel Configuration

Ensure your Cloudflare tunnel forwards to the correct port:

```yaml
# In your Cloudflare tunnel config
ingress:
  - hostname: bridge.5ls.us
    service: http://localhost:YOUR_ACTUAL_PORT
```

## Port Requirements

- **Local Network:** ESP32 devices will discover via mDNS and connect on the actual port
- **Cloud (Cloudflare):** Cloudflare terminates SSL on port 443 and forwards to your local port
- **No SSL Required Locally:** The bridge runs plain WebSocket (ws://), Cloudflare handles SSL

## Testing After Configuration

1. **Test local connection:**
   ```bash
   wscat -c ws://homeassistant.local:YOUR_ACTUAL_PORT
   ```

2. **Test cloud connection:**
   ```bash
   wscat -c wss://bridge.5ls.us
   ```

3. **Test mDNS discovery:**
   ```bash
   dns-sd -B _webex-bridge._tcp
   ```

4. **Deploy firmware and check ESP32 logs:**
   Look for: `[BRIDGE] Connected to bridge.5ls.us`

## Current Port Assumptions

The following files currently assume **port 8080**:

- `website/public/api/bridge-config.json`: Line 5 - `fallback_url`
- `webex-bridge/config.yaml`: Line 28 - `ws_port`
- `bridge/env.example`: Line 11 - `WS_PORT`

**Action Required:** Verify the actual port and update all three files if different from 8080.

## Notes

- Port 8080 is a common alternative HTTP port and is generally firewall-friendly
- If you're using a different port, make sure:
  - Your router/firewall allows connections on that port
  - The Cloudflare tunnel is configured to forward to that port
  - The mDNS advertisement includes the correct port (it should automatically)
