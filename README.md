# LED Matrix Webex Status Display

An ESP32-S3 powered 64x32 RGB LED matrix display that shows your Webex presence status at a glance. Perfect for home offices, meeting rooms, or anywhere you want colleagues and family to know your availability without interrupting you.

## Overview

This project creates a physical "busy light" that automatically syncs with your Webex status. When you're in a meeting, the display shows red. When you're available, it's green. It can also display camera/microphone state during calls and environmental sensor data from Cisco Meraki MT sensors.

### Key Capabilities

- **Automatic Status Sync**: Connects to Webex APIs to fetch your real-time presence
- **Visual at a Glance**: Color-coded status visible from across the room
- **Call Awareness**: Shows when your camera is on or microphone is muted
- **Environmental Monitoring**: Optional integration with Meraki MT sensors for temperature, humidity, door status, and air quality
- **Zero Touch Updates**: OTA firmware updates from GitHub Releases
- **Easy Setup**: Web-based configuration portal

## Display States

The 64x32 pixel LED matrix (192mm x 96mm, 3mm pitch, 2048 individual RGB LEDs) displays different screens based on the current state. Each status screen shows the current time, temperature, and air quality.

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
  ┌──────────────┐                                         │
  │ Meraki Cloud │         ┌──────────────┐                │
  │              │  MQTT   │ MQTT Broker  │    MQTT        │
  │ - MT Sensors ├────────►│              ├────────────────┤
  │ - Webhooks   │         │              │                │
  └──────────────┘         └──────────────┘                ▼
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
├── firmware/               # ESP32-S3 PlatformIO project
│   ├── src/
│   │   ├── display/        # LED matrix driver and icons
│   │   ├── network/        # WiFi, MQTT, HTTP clients
│   │   ├── web/            # Embedded web server
│   │   └── config/         # Configuration management
│   └── data/               # Web UI files (LittleFS)
├── bridge/                 # Node.js bridge server (optional)
│   └── src/                # TypeScript source
└── docs/                   # Documentation
    └── images/             # Display state visualizations
```

## Hardware Requirements

| Component | Specification |
|-----------|---------------|
| Microcontroller | ESP32-S3-DevKitC-1-N8R2 (recommended) or ESP32-DevKitC |
| Display | 64x32 RGB LED Matrix Panel (2048 LEDs, 3mm pitch, HUB75 interface) |
| Display Dimensions | 192mm x 96mm |
| Power Supply | 5V 2.5A minimum (matrix consumes up to 12W) |

### Supported Boards

| Board | Flash | Build Command |
|-------|-------|---------------|
| ESP32-S3-DevKitC-1 | 8MB | `pio run -e esp32s3` |
| ESP32-DevKitC (standard) | 4MB | `pio run -e esp32` |

### Hardware Wiring (ESP32-S3)

Connect the HUB75 matrix to the ESP32-S3 as follows:

| Matrix Pin | ESP32-S3 GPIO | Function |
|------------|---------------|----------|
| R1 | GPIO42 | Red data (upper) |
| G1 | GPIO41 | Green data (upper) |
| B1 | GPIO40 | Blue data (upper) |
| R2 | GPIO38 | Red data (lower) |
| G2 | GPIO39 | Green data (lower) |
| B2 | GPIO37 | Blue data (lower) |
| A | GPIO45 | Row address bit 0 |
| B | GPIO36 | Row address bit 1 |
| C | GPIO48 | Row address bit 2 |
| D | GPIO35 | Row address bit 3 |
| E | GPIO21 | Row address bit 4 |
| CLK | GPIO2 | Clock |
| LAT | GPIO47 | Latch |
| OE | GPIO14 | Output enable |

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

### Option A: Install from Pre-built Release (Recommended)

Download the latest release from [GitHub Releases](https://github.com/liptonj/Led-Matrix-Webex/releases).

**Release files:**
- `bootloader.bin` - ESP32 bootloader
- `partitions.bin` - Partition table
- `firmware.bin` - Main application firmware
- `littlefs.bin` - Web UI filesystem
- `bootstrap.bin` - Alternative minimal firmware for WiFi provisioning + OTA

**Flash addresses by board:**

| File | ESP32-S3 (8MB) | ESP32 (4MB) | Description |
|------|----------------|-------------|-------------|
| bootloader.bin | 0x1000 | 0x1000 | Second-stage bootloader |
| partitions.bin | 0x8000 | 0x8000 | Partition table |
| firmware.bin | 0x10000 | 0x10000 | Main application |
| littlefs.bin | 0x670000 | 0x290000 | Web UI filesystem |

**Flash using esptool.py (ESP32-S3):**

```bash
# Install esptool if needed
pip install esptool

# Erase flash first (recommended for clean install)
esptool.py --chip esp32s3 --port /dev/ttyUSB0 erase_flash

# Flash all components
esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 \
    write_flash \
    0x1000 bootloader.bin \
    0x8000 partitions.bin \
    0x10000 firmware.bin \
    0x670000 littlefs.bin
```

**Flash using esptool.py (ESP32 standard):**

```bash
# Erase flash first (recommended for clean install)
esptool.py --chip esp32 --port /dev/ttyUSB0 erase_flash

# Flash all components
esptool.py --chip esp32 --port /dev/ttyUSB0 --baud 921600 \
    write_flash \
    0x1000 bootloader.bin \
    0x8000 partitions.bin \
    0x10000 firmware.bin \
    0x290000 littlefs.bin
```

**Alternative: Bootstrap firmware (for OTA setup):**

If you prefer to use WiFi provisioning and download the main firmware over-the-air:

```bash
esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 \
    write_flash \
    0x1000 bootloader.bin \
    0x8000 partitions.bin \
    0x10000 bootstrap.bin
```

The bootstrap firmware creates a WiFi access point for initial configuration and downloads the main firmware from GitHub Releases.

**Note:** On macOS, the port is typically `/dev/cu.usbmodem*`. On Windows, use `COM3` or similar.

### Option B: Build from Source

**First-time setup (install bootloader once):**

The ESP32-S3 bootloader only needs to be installed once. PlatformIO includes it automatically on the first upload:

```bash
cd firmware
pio run -t upload         # First upload includes bootloader + partitions + firmware
pio run -t uploadfs       # Upload web UI filesystem (LittleFS)
```

**Subsequent firmware updates:**

After the bootloader is installed, you only need to update the application firmware:

```bash
cd firmware
pio run -t upload         # Updates firmware only
```

**Bootstrap firmware (alternative):**

```bash
cd firmware_bootstrap
pio run -t upload         # Upload bootstrap firmware
pio run -t uploadfs       # Upload bootstrap web UI
```

## Quick Start

### 1. Configure WiFi via SmartConfig

The easiest way to configure WiFi is using the ESP Touch app:

1. **Download the ESP Touch app:**
   - [iOS App Store](https://apps.apple.com/app/espressif-esptouch/id1071176700)
   - [Android Play Store](https://play.google.com/store/apps/details?id=com.espressif.esptouch)

2. **Connect your phone to your home WiFi** (the one you want the display to use)

3. **Open the ESP Touch app** and enter your WiFi password

4. **Power on the ESP32** with the bootstrap firmware installed

5. **Tap "Confirm"** in the app - it will broadcast your credentials to the device

6. **Watch the serial monitor** - the device will show its IP address when connected:
   ```
   [WIFI] SmartConfig connected! IP: 192.168.1.xxx
   ```

### 2. Install Main Firmware via Web UI

1. Open a browser and go to the IP address shown in the serial monitor (e.g., `http://192.168.1.xxx`)

2. The bootstrap web interface will open automatically

3. Click **"Install Firmware"** - the device will download the main firmware from GitHub Releases

4. The device will reboot into the full application

**Alternative: Direct AP Connection**

If SmartConfig doesn't work, you can also connect directly:
1. Look for WiFi network: `Webex-Display-Setup` (open network, no password)
2. Connect and open `http://192.168.4.1`
3. Enter your WiFi credentials and install firmware

### 3. Webex Integration Setup

1. Go to [Webex Developer Portal](https://developer.webex.com)
2. Create a new Integration
3. Set redirect URI to: `http://webex-display.local/oauth/callback`
4. Request scopes: `spark:people_read`, `spark:xapi_statuses`
5. Copy your Client ID and Client Secret to the device configuration

### 3. (Optional) Bridge Server

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

## License

MIT License - See LICENSE file for details.
