# LED Matrix Webex Status Display

An ESP32-S3 powered 64x32 RGB LED matrix display that shows your Webex presence status at a glance. Perfect for home offices, meeting rooms, or anywhere you want colleagues and family to know your availability without interrupting you.

**Current Version: 1.5.1**

## Overview

This project creates a physical "busy light" that automatically syncs with your Webex status. When you're in a meeting, the display shows red. When you're available, it's green. It can also display camera/microphone state during calls and environmental sensor data from Cisco Meraki MT sensors.

### Key Capabilities

- **Automatic Status Sync**: Connects to Webex APIs to fetch your real-time presence
- **Visual at a Glance**: Color-coded status visible from across the room
- **Call Awareness**: Shows when your camera is on or microphone is muted
- **Environmental Monitoring**: Optional integration with Meraki MT sensors for temperature, humidity, door status, and air quality
- **Zero Touch Updates**: OTA firmware updates from GitHub Releases with version selection
- **Easy Setup**: Web-based configuration portal with browser-based flashing
- **Automatic Recovery**: Factory rollback if firmware fails to boot properly

## Display States

The 64x32 pixel LED matrix (192mm x 96mm, 3mm pitch, 2048 individual RGB LEDs) displays different screens based on the current state. Each status screen shows the current time, temperature, and air quality.

### Bootstrap/Setup Screen

When the device powers on with bootstrap firmware or enters setup mode, it displays:
- The device IP address
- The mDNS hostname (e.g., `webex-display.local`)
- WiFi connection status

### Startup Screen

When the device powers on, it shows the startup screen with version information:

![Startup Screen](docs/images/display-startup.svg)

### Status: Available

Green circle indicates you're available and ready to communicate. The date and time are displayed in the status color, with temperature, humidity, and air quality index at the bottom:

![Available Status](docs/images/display-active.svg)

### Status: Away

Yellow circle shows you're temporarily away from your desk:

![Away Status](docs/images/display-away.svg)

### Status: Do Not Disturb

Red circle signals you should not be interrupted. Full text "DO NOT DISTURB" is displayed:

![DND Status](docs/images/display-dnd.svg)

### Status: In A Call

During calls, the display shows "IN A CALL" along with camera and microphone icons. Green camera with "ON" means video is active; red mic with slash and "OFF" indicates audio is muted:

![In Meeting](docs/images/display-meeting.svg)

All status screens display environmental data from Meraki MT sensors at the bottom:
- **Temperature**: Displayed in Fahrenheit (e.g., 72°F)
- **Humidity**: Displayed as percentage (e.g., 45%)
- **Air Quality**: Displayed as AQ index number (e.g., AQ 87) - higher is better, 0-50 poor, 51-100 moderate, 100+ good

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
  │ Webex Cloud  │         │ Node.js      │         │ ESP32-S3     │
  │              │  WS/API │ Bridge       │  HTTP   │ Firmware     │
  │ - People API ├────────►│              ├────────►│              │
  │ - xAPI       │         │ - Webex SDK  │         │ - Display    │
  │ - Mercury    │         │ - WebSocket  │         │ - Web Server │
  └──────────────┘         └──────────────┘         └──────┬───────┘
                                                          │
  ┌──────────────┐                                        │
  │ Meraki Cloud │         ┌──────────────┐               │
  │              │  MQTT   │ MQTT Broker  │    MQTT       │
  │ - MT Sensors ├────────►│              ├───────────────┤
  │ - Webhooks   │         │              │               │
  └──────────────┘         └──────────────┘               ▼
                                                  ┌──────────────┐
                                                  │ 64x32 RGB    │
                                                  │ LED Matrix   │
                                                  │ HUB75        │
                                                  └──────────────┘
```

### Data Sources

The display can receive status updates from multiple sources:

| Method | Description | Latency | Use Case |
|--------|-------------|---------|----------|
| **REST Polling** | Direct API calls to Webex | 20-120s | Simple setup, fallback |
| **xAPI WebSocket** | Real-time events from RoomOS | ~1s | Cisco video devices |
| **JS SDK Bridge** | Node.js server with Webex SDK | ~1-2s | Real-time without RoomOS |

### Status Colors

| Status | Color | RGB Value |
|--------|-------|-----------|
| Available | Green | `#00FF00` |
| Away / Inactive | Yellow | `#FFFF00` |
| Do Not Disturb | Red | `#FF0000` |
| In Meeting / Busy | Red | `#FF0000` |
| Out of Office | Purple | `#8000FF` |
| Offline / Unknown | Gray | `#808080` |

## Architecture

```
Led-Matrix-Webex/
├── firmware/               # Main ESP32-S3 application firmware
│   ├── src/
│   │   ├── display/        # LED matrix driver and icons
│   │   ├── network/        # WiFi, MQTT, HTTP clients
│   │   ├── web/            # Embedded web server
│   │   └── config/         # Configuration management
│   └── data/               # Web UI files (embedded)
├── firmware_bootstrap/     # Bootstrap firmware for initial setup + OTA
│   └── src/                # Minimal WiFi provisioning + OTA downloader
├── bridge/                 # Node.js bridge server (optional)
│   └── src/                # TypeScript source
├── webex-bridge/           # Home Assistant add-on for bridge
├── website/                # Project website and embedded app
└── docs/                   # Documentation
    └── images/             # Display state visualizations
```

## Hardware Requirements

| Component | Specification |
|-----------|---------------|
| Microcontroller | ESP32-S3-DevKitC-1-N8R2 (8MB flash required) |
| Display | P3-64x32-212-165-16s-D1.0 (64x32 RGB LED Matrix Panel, 3mm pitch, HUB75, 1/16 scan) |
| Breakout/Adapter Board | Seengreat RGB Matrix Adapter Board (E) for ESP32-S3-DevKitC-1 |
| Display Dimensions | 192mm x 96mm |
| Power Supply | 5V 2.5A minimum (matrix consumes up to 12W) |

### Supported Board

| Board | Flash | Firmware File | Build Command |
|-------|-------|---------------|---------------|
| ESP32-S3-DevKitC-1 | 8MB | `firmware-esp32s3.bin` | `pio run -e esp32s3` |

> **Note**: ESP32 (4MB) support has been discontinued. The firmware now requires 8MB flash to accommodate embedded web assets.

### Hardware Wiring (ESP32-S3)

Connect the HUB75 matrix to the ESP32-S3 as follows (Seengreat Adapter Board E pinout):

| Matrix Pin | ESP32-S3 GPIO | Function |
|------------|---------------|----------|
| R1 | GPIO37 | Red data (upper) |
| G1 | GPIO6 | Green data (upper) |
| B1 | GPIO36 | Blue data (upper) |
| R2 | GPIO35 | Red data (lower) |
| G2 | GPIO5 | Green data (lower) |
| B2 | GPIO0 | Blue data (lower) |
| A | GPIO45 | Row address bit 0 |
| B | GPIO1 | Row address bit 1 |
| C | GPIO48 | Row address bit 2 |
| D | GPIO2 | Row address bit 3 |
| E | GPIO4 | Row address bit 4 |
| CLK | GPIO47 | Clock |
| LAT | GPIO38 | Latch |
| OE | GPIO21 | Output enable |

## Installation

### Option A: Web Installer (Recommended)

The easiest way to get started is using the [Web Installer](https://display.5ls.us/install.html). It works directly in Chrome or Edge browsers with no additional software needed.

1. Connect your ESP32-S3 via USB
2. Open the Web Installer in Chrome or Edge
3. Click "Install Bootstrap Firmware"
4. Follow the wizard to configure WiFi

### Option B: Bootstrap Firmware via esptool

Download `bootstrap-esp32s3.bin` from [GitHub Releases](https://github.com/liptonj/Led-Matrix-Webex/releases).

```bash
# Install esptool if needed
pip install esptool

# Flash ESP32-S3:
esptool.py --chip esp32s3 --port /dev/ttyUSB0 erase_flash
esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 write_flash 0x0 bootstrap-esp32s3.bin
```

**Configure WiFi:**

1. The LED matrix will display "AP MODE" with the IP address `192.168.4.1`
2. Connect your phone/computer to WiFi network: `Webex-Display-Setup` (no password)
3. Open `http://192.168.4.1` in your browser
4. Enter your WiFi credentials and click "Connect"

**Install Main Firmware:**

1. After WiFi connects, the display shows your IP address and mDNS hostname
2. Open the web interface at the displayed IP or `http://webex-display.local`
3. The main firmware downloads and installs automatically

### Option C: Build from Source

```bash
# Clone the repository
git clone https://github.com/liptonj/Led-Matrix-Webex.git
cd Led-Matrix-Webex

# Build and upload bootstrap firmware
cd firmware_bootstrap
pio run -e esp32s3 -t upload

# Build and upload main firmware
cd ../firmware
pio run -e esp32s3 -t upload
```

## Firmware Recovery

The firmware includes automatic recovery features:

### WiFi Connection Failure
If the configured WiFi network is not found or connection fails, the device automatically starts an Access Point (`Webex-Display-Setup`) for reconfiguration.

### Boot Failure Recovery
If the main firmware fails to boot properly (crashes repeatedly), it automatically rolls back to the bootstrap (factory) partition. You can then use the web interface to reinstall the firmware.

### OTA Recovery
Use the [Troubleshooting page](https://display.5ls.us/troubleshooting.html) to:
- Roll back to previous firmware without losing WiFi settings
- Retry failed OTA downloads
- Run diagnostics via serial connection

### Manual Recovery
If the device becomes unresponsive:
1. Connect USB and open serial monitor
2. Hold the BOOT button while pressing RESET
3. Re-flash the bootstrap firmware using the Web Installer or esptool

## Quick Start

### 1. Configure WiFi

After flashing the bootstrap firmware:

1. **Look at the LED matrix** - it shows "AP MODE" and the IP `192.168.4.1`
2. **Connect to `Webex-Display-Setup`** WiFi network (no password)
3. **Open `http://192.168.4.1`** in your browser
4. **Enter your WiFi credentials** and click Connect
5. **Once connected**, the display shows your new IP address and hostname

### 2. Install Main Firmware

The main firmware downloads automatically after WiFi is configured. Alternatively:

1. Open the web interface at the IP shown on the display (or `http://webex-display.local`)
2. Select a firmware version from the dropdown
3. Click **"Install"** - the device downloads and installs the firmware
4. The device reboots into the full application

### 3. Webex Integration Setup

1. Go to [Webex Developer Portal](https://developer.webex.com)
2. Create a new Integration
3. Set redirect URI to: `http://webex-display.local/oauth/callback`
4. Request scopes: `spark:people_read`, `spark:xapi_statuses`
5. Copy your Client ID and Client Secret to the device configuration

### 4. (Optional) Bridge Server

For real-time presence updates without a Cisco RoomOS device (desk phone, room kit, etc.), you need to run the Node.js bridge server.

**What is the bridge?**
- A standalone Node.js application (NOT a Webex plugin)
- Runs on an always-on device: Raspberry Pi, home server, NAS, Docker container, etc.
- Connects to Webex cloud using OAuth to monitor your presence in real-time
- Pushes status updates to the ESP32-S3 over your local network via WebSocket
- Auto-discovered by ESP32-S3 using mDNS (`webex-bridge.local`)

**Quick start:**

```bash
cd bridge
npm install
cp env.example .env
# Edit .env with your Webex OAuth credentials
npm start
```

**Deployment options:**
- **Home Assistant Add-on**: [One-click install](webex-bridge/README.md) - easiest if you already run HA
- **Raspberry Pi / Server**: [Bridge Deployment Guide](docs/bridge_deployment.md)
- **Docker**: See deployment guide for Docker instructions

The bridge uses the Webex JavaScript SDK to receive real-time presence updates via Mercury WebSocket and pushes them to the ESP32-S3.

## Configuration Options

The web UI allows configuring:

- **WiFi**: Network credentials
- **Webex**: OAuth client ID/secret, user email to monitor
- **MQTT**: Broker address, credentials, topic subscriptions for Meraki sensors
- **Display**: Brightness, polling interval, timezone

## Meraki MT Sensor Integration

To display environmental data from Cisco Meraki MT sensors:

1. Configure an MQTT broker (e.g., Mosquitto)
2. Set up Meraki Dashboard to publish sensor data via MQTT
3. Configure the ESP32-S3 with MQTT broker details in the web interface
4. Enter the sensor serial number in the device settings to subscribe to that specific sensor's data

Supported sensor data:
- **Temperature**: Displays in Fahrenheit
- **Humidity**: Displays as percentage
- **Door Status**: Open/Closed indicator
- **Air Quality**: Good/Moderate/Poor

## Development

### Version Management

The firmware version is defined in `platformio.ini`:

**Main Firmware** (`firmware/platformio.ini`):
```ini
[version]
firmware_version = 1.2.0
```

**Bootstrap Firmware** (`firmware_bootstrap/platformio.ini`):
```ini
[version]
bootstrap_version = 1.2.0
```

When releasing a new version:
1. Update the version in the `[version]` section of each `platformio.ini`
2. Update `README.md` with the new version and changelog
3. Create a git tag matching the version (e.g., `v1.2.0`)

### Build Environments

**Main Firmware** (`firmware/`):
| Environment | Description |
|-------------|-------------|
| `esp32s3` | Full build for ESP32-S3 (all modules) |
| `minimal` | Core only (smallest size) |
| `embedded` | Core + Embedded App |
| `standard` | Core + Embedded App + Webex Polling |
| `sensors` | Core + Embedded App + MQTT Sensors |
| `bridge` | Core + Embedded App + Bridge Client |
| `native` | Native simulation (for development) |
| `native_test` | Native unit tests |

## Changelog

### v1.1.16
**Major Changes:**
- Dropped ESP32 (4MB) support - now ESP32-S3 only with 8MB flash
- Web assets now embedded in firmware (no separate filesystem partition needed)
- Modern dark theme across all web interfaces

**Website & UX:**
- Unified Webex-inspired dark theme across website and embedded app
- New hamburger navigation menu for mobile-friendly browsing
- Comprehensive troubleshooting page with serial diagnostics
- Guided troubleshooting wizard with log analysis
- OTA recovery without losing WiFi configuration
- Improved setup wizard with automatic network scanning

**Reliability:**
- Enhanced OTA recovery options (rollback, retry)
- Better error handling and status feedback
- Improved bridge WebSocket stability

### v1.0.3
**OTA Improvements:**
- Version selection UI - choose which firmware version to install from a dropdown
- Beta/prerelease versions are clearly marked and never auto-installed
- Board-specific firmware binaries - OTA automatically selects correct one
- Improved OTA reliability with proper chip detection and validation

**Display & Discovery:**
- LED matrix displays IP address and mDNS hostname during boot and setup mode
- Serial output prints IP/hostname every 15 seconds for easy discovery
- Bootstrap firmware now has full LED matrix support

**Recovery & Reliability:**
- Automatic factory rollback if main firmware fails to boot (repeated crashes)
- WiFi fallback to AP mode if configured network not found
- Factory partition support in partition tables for reliable rollback

### v1.0.2
- Initial public release
- Webex presence integration via REST polling, xAPI WebSocket, or Bridge server
- Meraki MT sensor support via MQTT
- OTA updates from GitHub Releases
- Web-based configuration portal

## License

MIT License - See LICENSE file for details.
