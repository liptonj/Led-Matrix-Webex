# Webex Bridge Add-on

This add-on runs the Webex Bridge server for real-time presence updates to your LED Matrix Display.

## About

The Webex Bridge connects to Webex cloud using OAuth and monitors your presence status in real-time. When your status changes (available, away, in a meeting, etc.), it pushes updates to your ESP32 LED Matrix Display over WebSocket.

## How it works

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

### Option: `webex_client_id` (required)

Your Webex Integration Client ID from the developer portal.

### Option: `webex_client_secret` (required)

Your Webex Integration Client Secret from the developer portal.

### Option: `webex_refresh_token` (required)

The OAuth refresh token obtained from the authorization flow.

### Option: `ws_port`

The WebSocket server port. Default: `8080`

The ESP32 will connect to this port to receive presence updates.

### Option: `log_level`

Logging verbosity. Options: `error`, `warn`, `info`, `debug`. Default: `info`

## Network

This add-on runs with host networking to enable mDNS discovery. The ESP32 will automatically find the bridge at `webex-bridge.local`.

### Firewall

Ensure these ports are accessible on your Home Assistant host:
- **TCP 8080**: WebSocket server (or your configured port)
- **UDP 5353**: mDNS for service discovery

## Troubleshooting

### ESP32 can't find the bridge

1. Check the add-on is running in the Home Assistant UI
2. Verify mDNS is working: `avahi-browse -a | grep webex`
3. Ensure host networking is enabled

### Authentication errors

1. Refresh tokens expire after 90 days of inactivity
2. Regenerate the token using the OAuth flow above
3. Check logs for specific error messages

### View logs

Go to the add-on page in Home Assistant and click the "Log" tab.

## Support

For issues and feature requests, visit:
https://github.com/liptonj/Led-Matrix-Webex/issues
