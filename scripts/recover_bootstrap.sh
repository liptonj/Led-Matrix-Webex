#!/bin/bash
#
# Bootstrap Recovery Script
# 
# Use this script to restore the bootstrap firmware if it was accidentally
# overwritten by using esptool, Arduino IDE, or another flashing tool.
#
# Usage:
#   ./scripts/recover_bootstrap.sh [PORT] [CHIP]
#
# Examples:
#   ./scripts/recover_bootstrap.sh                    # Auto-detect port, ESP32-S3
#   ./scripts/recover_bootstrap.sh /dev/ttyUSB0       # Specific port, ESP32-S3
#   ./scripts/recover_bootstrap.sh /dev/ttyUSB0 esp32 # Specific port and chip
#
# Prerequisites:
#   - esptool.py installed (pip install esptool)
#   - Bootstrap firmware built (pio run -e esp32s3 in firmware_bootstrap/)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BOOTSTRAP_DIR="$PROJECT_DIR/firmware_bootstrap"

# Default values
PORT="${1:-}"
CHIP="${2:-esp32s3}"
BAUD="921600"

# Partition addresses
FACTORY_ADDR="0x10000"

# Determine build directory and firmware path based on chip
if [[ "$CHIP" == "esp32s3" ]]; then
    BUILD_DIR="$BOOTSTRAP_DIR/.pio/build/esp32s3"
    FS_ADDR="0x700000"
else
    BUILD_DIR="$BOOTSTRAP_DIR/.pio/build/esp32"
    FS_ADDR="0x3D0000"
fi

FIRMWARE_BIN="$BUILD_DIR/firmware.bin"
LITTLEFS_BIN="$BUILD_DIR/littlefs.bin"

echo "========================================================================"
echo "Bootstrap Recovery Script"
echo "========================================================================"
echo ""

# Check if firmware exists
if [[ ! -f "$FIRMWARE_BIN" ]]; then
    echo "ERROR: Bootstrap firmware not found at:"
    echo "  $FIRMWARE_BIN"
    echo ""
    echo "Please build the bootstrap firmware first:"
    echo "  cd firmware_bootstrap"
    echo "  pio run -e $CHIP"
    echo "  pio run -e $CHIP -t buildfs"
    exit 1
fi

# Auto-detect port if not specified
if [[ -z "$PORT" ]]; then
    echo "Auto-detecting serial port..."
    
    # Try common port patterns
    if [[ -e /dev/ttyACM0 ]]; then
        PORT="/dev/ttyACM0"
    elif [[ -e /dev/ttyUSB0 ]]; then
        PORT="/dev/ttyUSB0"
    elif [[ -e /dev/cu.usbmodem* ]]; then
        PORT=$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)
    elif [[ -e /dev/cu.usbserial* ]]; then
        PORT=$(ls /dev/cu.usbserial* 2>/dev/null | head -1)
    elif [[ -e /dev/cu.SLAB_USBtoUART ]]; then
        PORT="/dev/cu.SLAB_USBtoUART"
    else
        echo "ERROR: Could not auto-detect serial port."
        echo "Please specify the port manually:"
        echo "  $0 /dev/ttyUSB0"
        exit 1
    fi
    
    echo "  Found: $PORT"
fi

echo ""
echo "Configuration:"
echo "  Chip:     $CHIP"
echo "  Port:     $PORT"
echo "  Firmware: $FIRMWARE_BIN"
echo "  Target:   $FACTORY_ADDR (factory partition)"
echo ""

# Check for esptool
if ! command -v esptool.py &> /dev/null; then
    if ! command -v esptool &> /dev/null; then
        echo "ERROR: esptool.py not found."
        echo "Install it with: pip install esptool"
        exit 1
    fi
    ESPTOOL="esptool"
else
    ESPTOOL="esptool.py"
fi

# Confirm before flashing
echo "WARNING: This will flash the bootstrap firmware to the factory partition."
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "Flashing bootstrap firmware..."
echo ""

# Flash firmware only
$ESPTOOL --chip "$CHIP" --port "$PORT" --baud "$BAUD" \
    write_flash "$FACTORY_ADDR" "$FIRMWARE_BIN"

# Check if LittleFS exists and offer to flash it too
if [[ -f "$LITTLEFS_BIN" ]]; then
    echo ""
    read -p "Also flash LittleFS filesystem? [y/N] " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Flashing LittleFS..."
        $ESPTOOL --chip "$CHIP" --port "$PORT" --baud "$BAUD" \
            write_flash "$FS_ADDR" "$LITTLEFS_BIN"
    fi
fi

echo ""
echo "========================================================================"
echo "Bootstrap recovery complete!"
echo ""
echo "The device should now boot into the bootstrap firmware."
echo "Use the bootstrap's web interface to provision WiFi and download"
echo "the main firmware via OTA."
echo "========================================================================"
