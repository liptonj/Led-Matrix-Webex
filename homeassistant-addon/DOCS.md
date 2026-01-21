# Webex Bridge Add-on

This add-on runs the Webex Bridge server for real-time presence and status updates to your LED Matrix Display.

## About

The Webex Bridge provides two modes of operation:

1. **Pairing Mode (Recommended)**: The bridge acts as a relay between the Webex Embedded App (running in your browser/Webex client) and your ESP32 LED Matrix Display, enabling real-time status sync without the display needing direct Webex authentication.

2. **Legacy OAuth Mode**: The bridge connects directly to Webex cloud using OAuth and monitors your presence status.

## How Pairing Mode Works

```
Webex Embedded App  →  Bridge (this add-on)  →  ESP32 LED Matrix
    (WSS/WS)              (Pairing Room)            (WS)
```

1. The ESP32 display generates a 6-character pairing code and shows it on screen
2. The display connects to this bridge and joins a "room" with that code
3. You open the Webex Embedded App and enter the pairing code
4. The app connects to the same room through this bridge
5. Status updates from the app are instantly relayed to the display

### Benefits of Pairing Mode

- **No OAuth setup required** - No need for Webex developer credentials on the display
- **Works with Webex Embedded Apps** - Bypasses browser mixed-content restrictions
- **Real-time updates** - Instant status sync via WebSocket
- **Multiple displays** - Each display gets its own pairing code

## How Legacy OAuth Mode Works

```
Webex Cloud  →  Bridge (this add-on)  →  ESP32 LED Matrix
   (OAuth)         (WebSocket)            (WiFi)
```

1. The bridge authenticates with Webex using your OAuth credentials
2. It subscribes to presence updates via the Webex Mercury WebSocket
3. When your status changes, it pushes the update to connected ESP32 devices
4. The ESP32 discovers the bridge automatically via mDNS

## Prerequisites

Before configuring this add-on, you need to create a Webex Integration:

1. Go to [Webex Developer Portal](https://developer.webex.com/my-apps)
2. Click "Create a New App" → "Integration"
3. Fill in the required fields:
   - **Name**: LED Matrix Display (or any name)
   - **Redirect URI**: `http://localhost:8080/callback` (for initial token)
   - **Scopes**: Select `spark:people_read`
4. Save and note your **Client ID** and **Client Secret**

### Getting the Refresh Token

You need a one-time OAuth flow to get the refresh token:

1. Visit this URL (replace YOUR_CLIENT_ID):
   ```
   https://webexapis.com/v1/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost:8080/callback&scope=spark:people_read
   ```

2. Login and authorize the app

3. You'll be redirected to `localhost:8080/callback?code=XXXXX`
   - Copy the `code` parameter from the URL

4. Exchange the code for tokens:
   ```bash
   curl -X POST https://webexapis.com/v1/access_token \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=YOUR_CODE" \
     -d "redirect_uri=http://localhost:8080/callback"
   ```

5. Copy the `refresh_token` from the response

## Configuration

### Required Options

### Option: `ws_port`

The WebSocket server port. Default: `8080`

Both the ESP32 display and the Webex Embedded App will connect to this port.

**Important:** If using Cloudflare Tunnel, configure the tunnel to point to this port.

Example configurations:
- Port `8080` → Tunnel service: `http://localhost:8080`
- Port `3000` → Tunnel service: `http://localhost:3000`

### Option: `log_level`

Logging verbosity. Options: `error`, `warn`, `info`, `debug`. Default: `info`

### Optional: Legacy OAuth Mode

If you want to use legacy OAuth mode (direct Webex authentication without the embedded app), configure these additional options:

### Option: `webex_client_id` (optional)

Your Webex Integration Client ID from the developer portal.

### Option: `webex_client_secret` (optional)

Your Webex Integration Client Secret from the developer portal.

### Option: `webex_refresh_token` (optional)

The OAuth refresh token obtained from the authorization flow.

## Quick Start - Pairing Mode

1. **Install and start** this add-on in Home Assistant
2. **Configure the display** to connect to the bridge:
   - Bridge URL: `ws://homeassistant.local:8080` (or your HA IP)
3. The display will show a **6-character pairing code** (e.g., `ABC123`)
4. Open the **Webex Embedded App** at `https://display.5ls.us/embedded/`
5. Enter the bridge URL and pairing code
6. Your status will now sync in real-time!

## Using Cloudflare Tunnel (Recommended)

For the best experience with the Webex Embedded App, expose the bridge through a Cloudflare Tunnel. This provides secure WebSocket (WSS) access from anywhere.

### Setup

1. **Add a public hostname** in your Cloudflare Tunnel configuration:
   - Subdomain: `bridge` (or your preference)
   - Domain: Your domain (e.g., `5ls.us`)
   - Service: `http://localhost:8080`

2. **In the embedded app**, use the tunnel URL:
   - Bridge URL: `wss://bridge.yourdomain.com`

### Benefits

- **No mixed content issues** - HTTPS app connects to WSS bridge
- **Works from anywhere** - Not limited to local network
- **Secure by default** - TLS encryption via Cloudflare
- **No port forwarding** - Works behind NAT/firewalls

### Architecture with Tunnel

```
Webex Embedded App  →  Cloudflare Tunnel  →  HA Add-on  →  ESP32 Display
   (HTTPS)               (WSS/TLS)           (WS:8080)      (WS local)
```

## Network

This add-on runs with host networking to enable mDNS discovery. The ESP32 will automatically find the bridge at `webex-bridge.local`.

### Firewall

Ensure these ports are accessible on your Home Assistant host:
- **TCP 8080**: WebSocket server (or your configured port)
- **UDP 5353**: mDNS for service discovery

## Troubleshooting

### Pairing Mode Issues

#### Embedded app can't connect to bridge

1. Ensure the bridge URL is correct (e.g., `ws://192.168.1.100:8080`)
2. Don't use `homeassistant.local` if mDNS isn't working - use the IP address
3. Check that port 8080 is not blocked by your firewall
4. Verify the add-on is running in Home Assistant

#### Display shows "Peer disconnected"

1. The embedded app may have lost connection - refresh the page
2. Check the bridge logs for connection errors

#### Pairing code not showing on display

1. Ensure the display is configured to connect to the bridge
2. Check the display's web UI for bridge settings
3. Restart the display to regenerate the pairing code

### ESP32 can't find the bridge

1. Check the add-on is running in the Home Assistant UI
2. Verify mDNS is working: `avahi-browse -a | grep webex`
3. Ensure host networking is enabled
4. Try using the IP address instead of hostname

### Authentication errors (Legacy OAuth Mode)

1. Refresh tokens expire after 90 days of inactivity
2. Regenerate the token using the OAuth flow above
3. Check logs for specific error messages

### View logs

Go to the add-on page in Home Assistant and click the "Log" tab.

## Support

For issues and feature requests, visit:
https://github.com/liptonj/Led-Matrix-Webex/issues
