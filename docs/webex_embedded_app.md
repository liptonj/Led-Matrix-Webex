# Webex Embedded App Integration

This document describes how to use the Webex Embedded App to control your LED Matrix Display directly from within Webex.

## Overview

The LED Matrix Display includes a built-in Webex Embedded App that allows you to:

- **Auto-detect meetings**: When you join a Webex meeting, the display automatically shows "In a Call"
- **Manually set status**: Choose your status (Available, Away, In a Call, DND) with a single tap
- **Sync to multiple displays**: Configure additional displays on your network to all show the same status
- **No bridge server required**: The app runs directly on the display hardware

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         Webex Client                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Embedded App (iframe)                         │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  • Webex SDK detects meeting state                  │  │  │
│  │  │  • User can manually select status                  │  │  │
│  │  │  • Sends HTTP POST to display(s)                    │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP POST /api/embedded/status
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LED Matrix Display                            │
│                    (ESP32 + HUB75 Panel)                        │
│                                                                  │
│  • Receives status updates via REST API                         │
│  • Updates LED matrix with status icon and text                 │
│  • Serves embedded app from LittleFS                            │
└─────────────────────────────────────────────────────────────────┘
```

## Setup Instructions

### Step 1: Register the Embedded App in Webex Developer Portal

1. Go to [Webex Developer Portal](https://developer.webex.com)
2. Navigate to **My Webex Apps** → **Create a New App**
3. Select **Embedded App**
4. Fill in the app details:
   - **App Name**: LED Matrix Status Display
   - **Description**: Control your LED matrix busy light from Webex
   - **App Hub URL**: `http://webex-display.local/embedded/` (replace with your display's hostname)
   - **Valid Domains**: `webex-display.local` (or your display's IP address)

5. Click **Create**

### Step 2: Find Your Display's Address

When your display first boots or is waiting for configuration, it will show:

```
    SETUP
Open in Webex:
webex-di...
/embedded
```

The full address is typically:
- **mDNS**: `http://webex-display.local/embedded/`
- **IP**: `http://192.168.x.x/embedded/` (check your router or the display's config page)

### Step 3: Add the App to Webex

1. Open Webex desktop or web client
2. Go to **Apps** → **Browse**
3. Search for your app name or navigate to the App Hub URL directly
4. Click **Add** to install the app

### Step 4: Use the App

1. Open the embedded app from the Webex Apps panel
2. Grant any required permissions when prompted
3. The app will:
   - Display your Webex user name
   - Show your current status
   - Auto-detect when you're in a meeting

4. To manually set your status, tap one of the status buttons:
   - **Available** (green) - You're ready to communicate
   - **Away** (yellow) - You're temporarily away
   - **In a Call** (red) - You're in a meeting/call
   - **DND** (red) - Do not disturb

## API Reference

The embedded app communicates with the display using these endpoints:

### GET /api/embedded/status

Returns the current display status.

**Response:**
```json
{
  "status": "active",
  "camera_on": false,
  "mic_muted": false,
  "in_call": false,
  "display_name": "John Doe",
  "hostname": "webex-display.local",
  "embedded_app_enabled": true
}
```

### POST /api/embedded/status

Updates the display status.

**Request Body:**
```json
{
  "status": "meeting",
  "displayName": "John Doe",
  "in_call": true,
  "camera_on": true,
  "mic_muted": false,
  "source": "embedded-app",
  "timestamp": "2025-01-17T10:30:00Z"
}
```

**Status Values:**
| Value | Display Shows |
|-------|---------------|
| `active` | Green - Available |
| `available` | Green - Available |
| `away` | Yellow - Away |
| `inactive` | Yellow - Away |
| `meeting` | Red - In a Call |
| `call` | Red - In a Call |
| `busy` | Red - In a Call |
| `dnd` | Red - Do Not Disturb |
| `donotdisturb` | Red - Do Not Disturb |
| `ooo` | Purple - Out of Office |
| `outofoffice` | Purple - Out of Office |
| `offline` | Gray - Offline |

**Response:**
```json
{
  "success": true,
  "status": "meeting",
  "message": "Status updated from embedded app"
}
```

## Multi-Display Support

You can sync your status to multiple LED displays on your network:

1. Open the embedded app
2. Scroll to **Additional Displays** section
3. Click the **+** button
4. Enter the display's address:
   - Use mDNS: `webex-display-office.local`
   - Or IP address: `192.168.1.100`
5. Click **Add**

The app will now sync your status to all configured displays simultaneously.

## Webex Embedded Apps SDK Limitations

The Webex Embedded Apps SDK provides limited access to user data:

| Feature | Available | Notes |
|---------|-----------|-------|
| User Name | ✅ Yes | Via `context.getUser()` |
| User Email | ✅ Yes | Via `context.getUser()` |
| Meeting Detection | ✅ Yes | Via `context.getMeeting()` |
| Presence Status | ❌ No | Not available in SDK |
| Camera State | ❌ No | Not available in SDK |
| Microphone State | ❌ No | Not available in SDK |

**Because of these limitations:**
- Meeting detection works automatically (joins → "In a Call")
- Other statuses (Available, Away, DND) must be set manually
- For full automatic presence sync, use the display's built-in OAuth integration

## Troubleshooting

### App shows "Not in Webex"
The embedded app must be opened from within the Webex client. It won't work in a regular browser.

### "Failed to sync" errors
- Check that the display is powered on and connected to the same network
- Verify the display address is correct (try pinging it)
- Ensure no firewall is blocking port 80

### Status not updating on display
- Check the display's web UI at `/` (config page) to verify connectivity
- Look at the Activity Log in the embedded app for error messages
- The display may take a few seconds to refresh after receiving an update

### Can't find the display
- Ensure mDNS is working on your network
- Try using the IP address instead of `.local` hostname
- Check that the display has successfully connected to WiFi

## Security Considerations

- The embedded app communicates over HTTP (not HTTPS) on your local network
- The display should only be accessible from your local network
- Consider network segmentation if security is a concern
- The app stores additional display addresses in browser localStorage

## Comparison: Embedded App vs OAuth Integration

| Feature | Embedded App | OAuth Integration |
|---------|--------------|-------------------|
| Setup Complexity | Easy (add to Webex) | Moderate (create integration) |
| Presence Detection | Manual + meetings | Automatic polling |
| Meeting Detection | ✅ Automatic | ❌ Limited |
| Camera/Mic State | ❌ Manual only | ✅ Via xAPI |
| Requires Browser | ✅ Yes (in Webex) | ❌ No |
| Always Running | ❌ No (app must be open) | ✅ Yes |

**Recommendation:** Use both! The embedded app for quick manual changes and meeting detection, while the OAuth integration provides background presence polling.
