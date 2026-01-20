# Webex Embedded App Integration

This document describes how to use the Webex Embedded App to control your LED Matrix Display directly from within Webex.

## Cloud-Hosted Embedded App

The Webex Embedded App is hosted on Cloudflare Pages and connects to your local LED Matrix Display over your network.

**Live App URL**: `https://display.5ls.us/embedded/`

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Webex Client                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Embedded App (iframe)                         │  │
│  │              Hosted on Cloudflare Pages                    │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  • Webex SDK v2.x detects meeting/call state        │  │  │
│  │  │  • User can manually set status + camera/mic        │  │  │
│  │  │  • Sends HTTP POST to local display                 │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP POST /api/embedded/status
                              │ (Cross-origin request to local network)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LED Matrix Display                            │
│                    (ESP32 + HUB75 Panel)                        │
│                    Your Local Network                            │
│                                                                  │
│  • Receives status updates via REST API with CORS support       │
│  • Updates LED matrix with status icon and text                 │
│  • Full configuration available via embedded app                │
└─────────────────────────────────────────────────────────────────┘
```

## Features

The embedded app allows you to:

- **Auto-detect meetings**: When you join a Webex meeting, the display automatically shows "In a Call"
- **Sidebar call detection**: Detects incoming/outgoing calls via Webex Sidebar API
- **Manual status selection**: Choose your status (Available, Away, In a Call, DND) with a single tap
- **Camera/Mic toggles**: Manually indicate your camera and microphone state
- **Full display configuration**: Set brightness, display name, WiFi, and more
- **Firmware updates**: Check for and install firmware updates directly from the app

## Modular Firmware Architecture

The LED Matrix Display uses a modular firmware architecture. You can install only the features you need:

| Variant | Modules Included | Size | Use Case |
|---------|-----------------|------|----------|
| `minimal` | Core only | ~180 KB | Bootstrap, minimal footprint |
| `embedded` | Core + Embedded App | ~225 KB | Webex control only, no polling |
| `standard` | Core + Embedded App + Webex Polling | ~260 KB | Direct Webex integration |
| `sensors` | Core + Embedded App + MQTT | ~250 KB | Meraki sensor display |
| `bridge` | Core + Embedded App + Bridge Client | ~245 KB | Node.js bridge integration |
| `full` | All modules | ~350 KB | Complete functionality |

### Available Modules

| Module | Description |
|--------|-------------|
| `core` | WiFi, Display, Web Server, OTA (always installed) |
| `embedded_app` | Webex Embedded App with configuration UI |
| `webex_polling` | Direct Webex API polling for presence status |
| `mqtt_sensors` | MQTT client for Meraki MT sensor data |
| `bridge_client` | WebSocket client for Node.js bridge server |
| `xapi_client` | RoomOS xAPI WebSocket for device control |

## Setup Instructions

### Step 1: Register the Embedded App in Webex Developer Portal

1. Go to [Webex Developer Portal](https://developer.webex.com)
2. Navigate to **My Webex Apps** → **Create a New App**
3. Select **Embedded App**
4. Fill in the app details:
   - **App Name**: LED Matrix Status Display
   - **Description**: Control your LED matrix busy light from Webex
   - **Start Page URL**: `https://display.5ls.us/embedded/`
   - **Valid Domains**: `display.5ls.us`
   - **App Type**: Sidebar (recommended for call detection events)

5. Click **Create**

### Step 2: Find Your Display's IP Address

Your LED Matrix Display needs to be on the same network as your computer running Webex.

To find your display's IP address:
1. Power on your LED Matrix Display
2. Connect it to your WiFi network
3. The display will show its IP address during startup (e.g., `192.168.1.100`)
4. Or check your router's device list for a device named "webex-display"

You can also use the mDNS hostname: `webex-display.local` (if your network supports mDNS)

### Step 3: Add the App to Webex

1. Open Webex desktop or web client
2. Go to **Apps** → **Browse**
3. Search for "LED Matrix Status Display" or your app name
4. Click **Add** to install the app

### Step 4: Connect to Your Display

1. Open the embedded app from the Webex Apps panel
2. On first launch, you'll see the **Connect to Your Display** screen
3. Enter your display's IP address (e.g., `192.168.1.100`) or hostname (`webex-display.local`)
4. Click **Connect to Display**
5. The app will test the connection and save the address

**Note**: The app saves your display address in your browser's localStorage, so you only need to enter it once.

### Step 5: Use the App

Once connected, the app will:
- Display your Webex user name
- Show your current status
- Auto-detect when you're in a meeting or call

**Manual Status Selection:**
- **Available** (green) - You're ready to communicate
- **Away** (yellow) - You're temporarily away
- **In a Call** (red) - You're in a meeting/call
- **DND** (red) - Do not disturb

**Camera & Microphone Toggles:**
Since the Webex SDK doesn't expose camera/mic hardware state, you can manually toggle:
- **Camera On/Off** - Indicates if your camera is active
- **Mic On/Muted** - Indicates if your microphone is muted

These states are synced to your LED display in real-time.

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

## Webex Embedded Apps SDK Features

The embedded app uses SDK v2.x with the following capabilities:

| Feature | Available | Notes |
|---------|-----------|-------|
| User Name | ✅ Yes | Via `app.user` property |
| User Email | ✅ Yes | Via `app.user` property |
| Meeting Detection | ✅ Yes | Via `context.getMeeting()` |
| Call State Events | ✅ Yes | Via `sidebar:callStateChanged` event |
| Presence Status | ❌ No | Not available in SDK |
| Camera State | ❌ No | Not available - use manual toggle |
| Microphone State | ❌ No | Not available - use manual toggle |

**SDK v2.x Changes:**
- User info is now a static property (`app.user`) instead of async method
- Sidebar API provides call state change events
- Rate limits: 20 requests/minute

**Workarounds for Limitations:**
- Meeting/call detection works automatically via SDK events
- Camera and microphone state: Use manual toggle buttons in the app
- Full presence status: Use the display's built-in OAuth integration for background polling

## Known Issues & Workarounds

### Mixed Content Warning (HTTPS to HTTP)

The embedded app is served over HTTPS from Cloudflare Pages, but your LED display serves HTTP on your local network. Some browsers may block these "mixed content" requests.

**Workarounds:**
1. **Most browsers allow this** - Local network requests are often exempted
2. **Chrome**: If blocked, navigate to `chrome://flags/#block-insecure-private-network-requests` and disable
3. **Firefox**: Usually works without issues for local network requests
4. **Edge**: Similar to Chrome, may require flag change

### mDNS (.local hostnames)

mDNS resolution (e.g., `webex-display.local`) depends on your network configuration:
- Works on most home networks
- May not work on corporate networks
- If it doesn't work, use the IP address instead

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
