# Webex Integration Setup Guide

## Overview

This guide walks you through setting up the Webex integration for the LED Matrix display. You'll need to create a Webex Integration and configure OAuth2 authentication.

## Prerequisites

- A Webex account (free or paid)
- Access to the Webex Developer Portal

## Step 1: Create a Webex Integration

1. Go to https://developer.webex.com/my-apps
2. Click **Create a New App**
3. Select **Integration**
4. Fill in the details:
   - **Integration Name**: LED Matrix Status Display
   - **Icon**: Upload a suitable icon or use the default
   - **Description**: ESP32 LED matrix for displaying Webex presence
   - **Redirect URI**: `http://webex-display.local/oauth/callback`
   - **Scopes**: Select the following:
     - `spark:people_read` - Required for presence status
     - `spark:xapi_statuses` - Optional, for RoomOS device status

5. Click **Create Integration**
6. **Save your Client ID and Client Secret** - you'll need these for configuration

## Step 2: Configure the ESP32

### Option A: Via Web UI (Recommended)

1. Power on the ESP32 with the matrix connected
2. Connect to the `Webex-Display-Setup` WiFi network (password: `webexdisplay`)
3. Open http://192.168.4.1 in your browser
4. Go to **Webex Settings**
5. Enter your Client ID and Client Secret
6. Click **Connect to Webex**
7. You'll be redirected to Webex to authorize the app
8. After authorization, you'll be redirected back to the ESP32

### Option B: Via Configuration File

1. Edit `firmware/include/secrets.h` with your credentials:
   ```cpp
   #define WEBEX_CLIENT_ID "your_client_id"
   #define WEBEX_CLIENT_SECRET "your_client_secret"
   ```
2. Flash the firmware
3. Complete OAuth via the web UI

## Step 3: (Optional) Enable xAPI for RoomOS Device

If you have a Webex Room device (Room Kit, Desk Pro, Board, etc.), you can get real-time camera and microphone status.

### Enable xAPI Access

1. Log in to Webex Control Hub: https://admin.webex.com
2. Go to **Devices** and select your device
3. Under **Configurations**, enable:
   - **xAPI over WebSocket**: On
   - **HttpClient Mode**: On

### Add xAPI Scope

Ensure your integration includes the `spark:xapi_statuses` scope.

### Configure in ESP32

1. Go to the ESP32 web UI
2. Navigate to **Webex Settings** > **RoomOS Device**
3. Enter your device ID or let the ESP32 auto-discover it
4. Enable **xAPI WebSocket** connection

## Step 4: (Optional) Set Up the Bridge Server

For real-time presence updates without a RoomOS device, use the Node.js bridge server.

### Get a Refresh Token

1. Use the Webex OAuth flow to get an initial access token
2. The bridge server will automatically refresh tokens

### Configure the Bridge

1. Copy `bridge/env.example` to `bridge/.env`
2. Add your credentials:
   ```
   WEBEX_CLIENT_ID=your_client_id
   WEBEX_CLIENT_SECRET=your_client_secret
   WEBEX_REFRESH_TOKEN=your_refresh_token
   ```
3. Run the bridge: `npm start`

## OAuth2 Flow Details

### Authorization URL

```
https://webexapis.com/v1/authorize?
  client_id={CLIENT_ID}&
  response_type=code&
  redirect_uri={REDIRECT_URI}&
  scope=spark:people_read%20spark:xapi_statuses&
  state={RANDOM_STATE}
```

### Token Exchange

```
POST https://webexapis.com/v1/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}&
code={AUTH_CODE}&
redirect_uri={REDIRECT_URI}
```

### Token Refresh

```
POST https://webexapis.com/v1/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}&
refresh_token={REFRESH_TOKEN}
```

## API Endpoints Used

### People API (Presence)

```
GET https://webexapis.com/v1/people/me
Authorization: Bearer {ACCESS_TOKEN}
```

Response:
```json
{
  "id": "...",
  "displayName": "John Doe",
  "status": "active",
  "lastActivity": "2026-01-16T10:30:00.000Z"
}
```

Status values:
- `active` - User is online and active
- `inactive` - User is online but idle
- `DoNotDisturb` - User has DND enabled
- `OutOfOffice` - User is out of office
- `busy` - User is in a meeting
- `pending` - Status is being determined

### xAPI (RoomOS Device Status)

```
GET https://webexapis.com/v1/xapi/status?deviceId={DEVICE_ID}&name=Audio.Microphones.Mute
Authorization: Bearer {ACCESS_TOKEN}
```

## Troubleshooting

### "Invalid redirect URI" Error

- Ensure your redirect URI exactly matches what's configured in the Webex integration
- The ESP32 must be accessible at `webex-display.local` or use its IP address

### "Scope not authorized" Error

- Check that you selected the required scopes when creating the integration
- Re-authorize if scopes were added after initial authorization

### Token Refresh Failing

- Refresh tokens expire after 90 days of inactivity
- Re-authorize if the refresh token has expired

### Rate Limiting (429 Error)

- The ESP32 enforces a minimum 20-second polling interval
- Automatic backoff doubles the interval on 429 responses
