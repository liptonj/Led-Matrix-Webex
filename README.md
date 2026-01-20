# LED Matrix Webex Status Display

An ESP32/ESP32-S3 powered 64x32 RGB LED matrix display that shows your Webex presence status at a glance. Perfect for home offices, meeting rooms, or anywhere you want colleagues and family to know your availability without interrupting you.

**Current Version: 1.0.3**

## Overview

This project creates a physical "busy light" that automatically syncs with your Webex status. When you're in a meeting, the display shows red. When you're available, it's green. It can also display camera/microphone state during calls and environmental sensor data from Cisco Meraki MT sensors.

### Key Capabilities

- **Automatic Status Sync**: Connects to Webex APIs to fetch your real-time presence
- **Visual at a Glance**: Color-coded status visible from across the room
- **Call Awareness**: Shows when your camera is on or microphone is muted
- **Environmental Monitoring**: Optional integration with Meraki MT sensors for temperature, humidity, door status, and air quality
- **Zero Touch Updates**: OTA firmware updates from GitHub Releases with version selection
- **Easy Setup**: Web-based configuration portal with captive portal support
- **Automatic Recovery**: Factory rollback if firmware fails to boot properly
- **Multi-Board Support**: Works on both ESP32 and ESP32-S3 DevKits

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
  │ Webex Cloud  │         │ Node.js      │         │ ESP32/S3     │
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
├── firmware/               # Main ESP32/S3 application firmware
│   ├── src/
│   │   ├── display/        # LED matrix driver and icons
│   │   ├── network/        # WiFi, MQTT, HTTP clients
│   │   ├── web/            # Embedded web server
│   │   └── config/         # Configuration management
│   └── data/               # Web UI files (LittleFS)
├── firmware_bootstrap/     # Bootstrap firmware for initial setup + OTA
│   └── src/                # Minimal WiFi provisioning + OTA downloader
├── bridge/                 # Node.js bridge server (optional)
│   └── src/                # TypeScript source
├── homeassistant-addon/    # Home Assistant add-on for bridge
└── docs/                   # Documentation
    └── images/             # Display state visualizations
```

## Hardware Requirements

| Component | Specification |
|-----------|---------------|
| Microcontroller | ESP32-S3-DevKitC-1-N8R2 (recommended) or ESP32-DevKitC |
| Display | P3-64x32-212-165-16s-D1.0 (64x32 RGB LED Matrix Panel, 3mm pitch, HUB75, 1/16 scan) |
| Breakout/Adapter Board | Seengreat RGB Matrix Adapter Board (E) for ESP32-S3-DevKitC-1 |
| Display Dimensions | 192mm x 96mm |
| Power Supply | 5V 2.5A minimum (matrix consumes up to 12W) |

### Supported Boards

| Board | Flash | Firmware File | Build Command |
|-------|-------|---------------|---------------|
| ESP32-S3-DevKitC-1 | 8MB | `firmware-esp32s3.bin` | `pio run -e esp32s3` |
| ESP32-DevKitC (standard) | 4MB | `firmware-esp32.bin` | `pio run -e esp32` |

The OTA system automatically detects your board type and downloads the correct firmware.

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

### Hardware Wiring (ESP32 Standard)

Connect the HUB75 matrix to a standard ESP32 as follows:

| Matrix Pin | ESP32 GPIO | Function |
|------------|------------|----------|
| R1 | GPIO25 | Red data (upper) |
| G1 | GPIO26 | Green data (upper) |
| B1 | GPIO27 | Blue data (upper) |
| R2 | GPIO14 | Red data (lower) |
| G2 | GPIO12 | Green data (lower) |
| B2 | GPIO13 | Blue data (lower) |
| A | GPIO23 | Row address bit 0 |
| B | GPIO19 | Row address bit 1 |
| C | GPIO5 | Row address bit 2 |
| D | GPIO17 | Row address bit 3 |
| E | GPIO32 | Row address bit 4 |
| CLK | GPIO16 | Clock |
| LAT | GPIO4 | Latch |
| OE | GPIO15 | Output enable |

## Installation

### Option A: Bootstrap Firmware (Recommended)

The easiest way to get started is with the bootstrap firmware. It handles WiFi provisioning and downloads the main firmware over-the-air.

**Step 1: Flash Bootstrap**

Download `bootstrap-esp32.bin` or `bootstrap-esp32s3.bin` from [GitHub Releases](https://github.com/liptonj/Led-Matrix-Webex/releases).

```bash
# Install esptool if needed
pip install esptool

# For ESP32:
esptool.py --chip esp32 --port /dev/ttyUSB0 erase_flash
esptool.py --chip esp32 --port /dev/ttyUSB0 --baud 921600 write_flash 0x0 bootstrap-esp32.bin

# For ESP32-S3:
esptool.py --chip esp32s3 --port /dev/ttyUSB0 erase_flash
esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 write_flash 0x0 bootstrap-esp32s3.bin
```

**Step 2: Connect to WiFi**

1. The LED matrix will display "AP MODE" with the IP address `192.168.4.1`
2. Connect your phone/computer to WiFi network: `Webex-Display-Setup` (no password)
3. Open `http://192.168.4.1` in your browser
4. Enter your WiFi credentials and click "Connect"

**Step 3: Install Main Firmware**

1. After WiFi connects, the display shows your IP address and mDNS hostname
2. The IP and hostname are also printed to the serial port every 15 seconds
3. Open the web interface at the displayed IP or `http://webex-display.local`
4. Select a firmware version from the dropdown (beta versions are marked)
5. Click "Install" - the device downloads and installs the correct firmware for your board

**Note:** Beta/prerelease versions are never auto-installed. You must manually select them if desired.

### Option B: Install from Pre-built Release

Download the latest release from [GitHub Releases](https://github.com/liptonj/Led-Matrix-Webex/releases).

**Release files:**
- `bootstrap-esp32.bin` - Bootstrap firmware for ESP32
- `bootstrap-esp32s3.bin` - Bootstrap firmware for ESP32-S3
- `firmware-esp32.bin` - Main application for ESP32
- `firmware-esp32s3.bin` - Main application for ESP32-S3

**Flash main firmware directly (ESP32-S3):**

```bash
esptool.py --chip esp32s3 --port /dev/ttyUSB0 erase_flash
esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 \
    write_flash 0x0 firmware-esp32s3.bin
```

**Flash main firmware directly (ESP32):**

```bash
esptool.py --chip esp32 --port /dev/ttyUSB0 erase_flash
esptool.py --chip esp32 --port /dev/ttyUSB0 --baud 921600 \
    write_flash 0x0 firmware-esp32.bin
```

**Note:** On macOS, the port is typically `/dev/cu.usbserial-*` or `/dev/cu.usbmodem*`. On Windows, use `COM3` or similar.

### Option C: Build from Source

```bash
# Clone the repository
git clone https://github.com/liptonj/Led-Matrix-Webex.git
cd Led-Matrix-Webex

# Build and upload bootstrap firmware
cd firmware_bootstrap
pio run -e esp32 -t upload       # For ESP32
# OR
pio run -e esp32s3 -t upload     # For ESP32-S3

# Build and upload main firmware
cd ../firmware
pio run -e esp32 -t upload       # For ESP32
# OR
pio run -e esp32s3 -t upload     # For ESP32-S3
pio run -t uploadfs              # Upload web UI filesystem
```

## Firmware Recovery

The firmware includes automatic recovery features:

### WiFi Connection Failure
If the configured WiFi network is not found or connection fails, the device automatically starts an Access Point (`Webex-Display-Setup`) for reconfiguration. This works in both the bootstrap and main firmware.

### Boot Failure Recovery
If the main firmware fails to boot properly (crashes repeatedly), it automatically rolls back to the bootstrap (factory) partition. You can then use the web interface to reinstall the firmware.

### OTA Slot Limits
The device uses a single OTA slot in addition to the factory slot. OTA uploads must fit within that OTA partition:
- ESP32-S3: `ota_0` size is 0x4A0000 (~4.6 MB)
- ESP32: `ota_0` size is 0x280000 (~2.5 MB)

Use OTA bundle files for web installs; full-flash images (bootloader + partitions + app + filesystem) must be flashed over USB.

### Manual Recovery
If the device becomes unresponsive:
1. Connect USB and open serial monitor
2. Hold the BOOT button while pressing RESET
3. Re-flash the bootstrap firmware using esptool

## Quick Start

### 1. Configure WiFi

After flashing the bootstrap firmware:

1. **Look at the LED matrix** - it shows "AP MODE" and the IP `192.168.4.1`
2. **Check serial output** - the IP and mDNS name are printed every 15 seconds
3. **Connect to `Webex-Display-Setup`** WiFi network (no password)
4. **Open `http://192.168.4.1`** in your browser
5. **Enter your WiFi credentials** and click Connect
6. **Once connected**, the display shows your new IP address and hostname

### 2. Install Main Firmware

1. Open the web interface at the IP shown on the display (or `http://webex-display.local`)
2. Select a firmware version from the dropdown
3. Click **"Install"** - the device downloads the correct firmware for your board
4. The device reboots into the full application

#### Manual Web UI Upload (Single Bundle)
If you want to upload a single bundle through the web UI, build it locally:
```bash
cd firmware
pio run -e esp32s3 -t build_ota_bin
```
Upload `.pio/build/esp32s3/firmware-ota-esp32s3.bin` using the web UI OTA upload.

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
- Pushes status updates to the ESP32 over your local network via WebSocket
- Auto-discovered by ESP32 using mDNS (`webex-bridge.local`)

**Quick start:**

```bash
cd bridge
npm install
cp env.example .env
# Edit .env with your Webex OAuth credentials
npm start
```

**Deployment options:**
- **Home Assistant Add-on**: [One-click install](homeassistant-addon/README.md) - easiest if you already run HA
- **Raspberry Pi / Server**: [Bridge Deployment Guide](docs/bridge_deployment.md)
- **Docker**: See deployment guide for Docker instructions

The bridge uses the Webex JavaScript SDK to receive real-time presence updates via Mercury WebSocket and pushes them to the ESP32.

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
3. Configure the ESP32 with MQTT broker details in the web interface
4. Enter the sensor serial number in the device settings to subscribe to that specific sensor's data

Supported sensor data:
- **Temperature**: Displays in Fahrenheit
- **Humidity**: Displays as percentage
- **Door Status**: Open/Closed indicator
- **Air Quality**: Good/Moderate/Poor

## Development

### Version Management

Each firmware project has a single source of truth for its version number in `platformio.ini`:

**Main Firmware** (`firmware/platformio.ini`):
```ini
[version]
firmware_version = 1.0.3
```

**Bootstrap Firmware** (`firmware_bootstrap/platformio.ini`):
```ini
[version]
bootstrap_version = 1.0.3
```

When releasing a new version:
1. Update the version in the `[version]` section of each `platformio.ini`
2. Update `README.md` with the new version and changelog
3. Update `homeassistant-addon/config.yaml` version
4. Update `bridge/package.json` version
5. Update `pyproject.toml` version
6. Create a git tag matching the version (e.g., `v1.0.3`)

### Build Environments

**Main Firmware** (`firmware/`):
| Environment | Description |
|-------------|-------------|
| `esp32s3` | Full build for ESP32-S3 (all modules) |
| `esp32` | Full build for standard ESP32 |
| `minimal` | Core only (smallest size) |
| `embedded` | Core + Embedded App |
| `standard` | Core + Embedded App + Webex Polling |
| `sensors` | Core + Embedded App + MQTT Sensors |
| `bridge` | Core + Embedded App + Bridge Client |
| `native` | Native simulation (for development) |
| `native_test` | Native unit tests |

**Bootstrap Firmware** (`firmware_bootstrap/`):
| Environment | Description |
|-------------|-------------|
| `esp32s3` | Bootstrap for ESP32-S3 |
| `esp32` | Bootstrap for standard ESP32 |

## Changelog

### v1.0.3
**OTA Improvements:**
- Version selection UI - choose which firmware version to install from a dropdown
- Beta/prerelease versions are clearly marked and never auto-installed
- Board-specific firmware binaries (ESP32 vs ESP32-S3) - OTA automatically selects correct one
- Improved OTA reliability with proper chip detection and validation

**Display & Discovery:**
- LED matrix displays IP address and mDNS hostname during boot and setup mode
- Serial output prints IP/hostname every 15 seconds for easy discovery
- Bootstrap firmware now has full LED matrix support

**Recovery & Reliability:**
- Automatic factory rollback if main firmware fails to boot (repeated crashes)
- WiFi fallback to AP mode if configured network not found (scans before connecting)
- Factory partition support in partition tables for reliable rollback

**Developer Experience:**
- Single source of truth for version numbers in `platformio.ini` `[version]` section
- Cleaner build configuration with shared common settings
- Consistent environment naming across projects

### v1.0.2
- Initial public release
- ESP32 and ESP32-S3 support
- Webex presence integration via REST polling, xAPI WebSocket, or Bridge server
- Meraki MT sensor support via MQTT
- OTA updates from GitHub Releases
- Web-based configuration portal
- SmartConfig WiFi provisioning support

## License

MIT License - See LICENSE file for details.
