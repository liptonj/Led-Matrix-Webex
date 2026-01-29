# Native Simulation Environment

This directory contains the native simulation environment that allows you to run and debug the firmware logic without actual ESP32 hardware.

## Overview

The simulation environment provides:
- **Mock Hardware APIs**: Arduino, WiFi, Preferences, LED Matrix, etc.
- **Console-based Display**: Display output is printed to stdout
- **Interactive Commands**: Control the simulated state via command line
- **Full Firmware Logic**: Tests config management, display rendering, state machine

## Prerequisites

Install PlatformIO:
```bash
# Using pip
pip install platformio

# Or using Homebrew on macOS
brew install platformio
```

## Building

From the `firmware/` directory:

```bash
# Build the native simulation
pio run -e native
```

## Running

After building, run the simulation:

```bash
# Linux/macOS
.pio/build/native/program

# Windows
.pio\build\native\program.exe
```

## Interactive Commands

Once running, the simulation accepts these commands:

| Command | Description |
|---------|-------------|
| `status <active\|away\|dnd\|busy\|meeting\|offline>` | Set Webex status |
| `camera <on\|off>` | Toggle camera state |
| `mic <muted\|unmuted>` | Toggle microphone mute |
| `call <start\|end>` | Start/end a call |
| `temp <value>` | Set temperature (Celsius) |
| `humidity <value>` | Set humidity percentage |
| `door <open\|closed>` | Set door sensor status |
| `wifi <on\|off>` | Toggle WiFi connection |
| `display` | Show current display state |
| `config` | Show configuration |
| `help` | Show available commands |
| `quit` | Exit simulation |

## Example Session

```
╔══════════════════════════════════════════════════════════════╗
║         Webex Status Display - Native Simulation             ║
╚══════════════════════════════════════════════════════════════╝

[INIT] Loading configuration...
[Preferences] Opened namespace 'webex-display' (readonly=false)
[CONFIG] Configuration loaded successfully
[INIT] Initializing LED matrix (simulated)...
[Matrix] Initialized 64x32 LED matrix (simulation)
[INIT] Setup complete!

sim> status away
[SIM] Status set to: away
[Matrix] Text at (14,2): "Away" [color=0xFFE0]

sim> camera on
[SIM] Camera ON

sim> display
=== Current Display State ===
  WiFi: Connected
  Webex Status: away
  Camera: ON
  Microphone: Unmuted
==============================

sim> quit
[SIM] Goodbye!
```

## Architecture

```
simulation/
├── main_sim.cpp          # Main entry point with interactive loop
├── add_sim_sources.py    # PlatformIO build script
├── README.md             # This file
└── mocks/
    ├── Arduino.h         # Core Arduino types and functions
    ├── Preferences.h     # NVS storage simulation
    ├── WiFi.h            # WiFi mock
    ├── ESP32-HUB75-*.h   # LED matrix mock
    ├── ESPmDNS.h         # mDNS mock
    ├── ESPAsyncWebServer.h
    ├── LittleFS.h
    ├── PubSubClient.h    # MQTT mock
    ├── WebSocketsClient.h
    ├── HTTPClient.h
    ├── ArduinoJson.h
    └── globals.cpp       # Global instance definitions
```

## Limitations

The simulation has some limitations compared to real hardware:
- No actual network connectivity (WiFi/HTTP/WebSocket calls are logged but not executed)
- No persistent storage (Preferences are stored in memory only)
- Display is text-based, not a true LED matrix representation
- Timing is approximate (uses host system clock)

## Debugging

Since the simulation runs natively, you can use standard debuggers:

```bash
# GDB on Linux/macOS
gdb .pio/build/native/program

# LLDB on macOS
lldb .pio/build/native/program
```

You can also add breakpoints, inspect variables, and step through code using your IDE's native debugger.

## Extending the Simulation

To add mock functionality for new components:

1. Create a mock header in `simulation/mocks/`
2. Implement the minimal API surface needed
3. Add logging to track calls
4. The mock should compile on both the native platform and (with guards) on ESP32
