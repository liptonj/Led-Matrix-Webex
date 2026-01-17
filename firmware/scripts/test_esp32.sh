#!/bin/bash
# ESP32-S3 Test Script
# Tests building, uploading, and monitoring the firmware

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIRMWARE_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Change to firmware directory
cd "$FIRMWARE_DIR"

# Parse arguments
ACTION="${1:-build}"
PORT="${2:-}"

case "$ACTION" in
    build)
        print_header "Building ESP32-S3 Firmware"
        
        echo "Cleaning previous build..."
        pio run -e esp32s3 --target clean 2>/dev/null || true
        
        echo "Building firmware..."
        if pio run -e esp32s3; then
            print_success "Build successful!"
            echo ""
            echo "Firmware size:"
            ls -lh .pio/build/esp32s3/firmware.bin 2>/dev/null || echo "Binary not found"
        else
            print_error "Build failed!"
            exit 1
        fi
        ;;
        
    upload)
        print_header "Uploading to ESP32-S3"
        
        # Check if device is connected
        if [ -z "$PORT" ]; then
            echo "Detecting ESP32 device..."
            # Try common ports
            for p in /dev/cu.usbserial* /dev/cu.SLAB* /dev/cu.wchusbserial* /dev/tty.usbserial* /dev/ttyUSB*; do
                if [ -e "$p" ]; then
                    PORT="$p"
                    break
                fi
            done
        fi
        
        if [ -z "$PORT" ]; then
            print_warning "No ESP32 device detected!"
            echo "Make sure the device is connected via USB."
            echo ""
            echo "Available serial ports:"
            ls /dev/cu.* /dev/tty.usb* 2>/dev/null || echo "  None found"
            echo ""
            echo "Usage: $0 upload [PORT]"
            echo "Example: $0 upload /dev/cu.usbserial-0001"
            exit 1
        fi
        
        print_success "Found device at: $PORT"
        
        echo "Building and uploading..."
        if pio run -e esp32s3 --target upload --upload-port "$PORT"; then
            print_success "Upload successful!"
        else
            print_error "Upload failed!"
            exit 1
        fi
        ;;
        
    monitor)
        print_header "Serial Monitor"
        
        if [ -z "$PORT" ]; then
            echo "Detecting ESP32 device..."
            for p in /dev/cu.usbserial* /dev/cu.SLAB* /dev/cu.wchusbserial* /dev/tty.usbserial* /dev/ttyUSB*; do
                if [ -e "$p" ]; then
                    PORT="$p"
                    break
                fi
            done
        fi
        
        if [ -z "$PORT" ]; then
            print_warning "No ESP32 device detected!"
            echo "Using default monitor settings..."
            pio device monitor
        else
            print_success "Monitoring: $PORT"
            pio device monitor --port "$PORT" --baud 115200
        fi
        ;;
        
    flash)
        print_header "Full Flash (Build + Upload + Monitor)"
        
        # Build
        echo "Step 1/3: Building..."
        if ! pio run -e esp32s3; then
            print_error "Build failed!"
            exit 1
        fi
        print_success "Build complete"
        
        # Upload
        echo ""
        echo "Step 2/3: Uploading..."
        if [ -z "$PORT" ]; then
            for p in /dev/cu.usbserial* /dev/cu.SLAB* /dev/cu.wchusbserial* /dev/tty.usbserial* /dev/ttyUSB*; do
                if [ -e "$p" ]; then
                    PORT="$p"
                    break
                fi
            done
        fi
        
        if [ -z "$PORT" ]; then
            print_error "No ESP32 device detected! Connect the device and try again."
            exit 1
        fi
        
        if ! pio run -e esp32s3 --target upload --upload-port "$PORT"; then
            print_error "Upload failed!"
            exit 1
        fi
        print_success "Upload complete"
        
        # Monitor
        echo ""
        echo "Step 3/3: Starting monitor (Ctrl+C to exit)..."
        sleep 2  # Wait for device to reset
        pio device monitor --port "$PORT" --baud 115200
        ;;
        
    uploadfs)
        print_header "Uploading Web Interface Files (LittleFS)"
        
        if [ -z "$PORT" ]; then
            for p in /dev/cu.usbserial* /dev/cu.SLAB* /dev/cu.wchusbserial* /dev/tty.usbserial* /dev/ttyUSB*; do
                if [ -e "$p" ]; then
                    PORT="$p"
                    break
                fi
            done
        fi
        
        if [ -z "$PORT" ]; then
            print_error "No ESP32 device detected!"
            exit 1
        fi
        
        echo "Uploading filesystem..."
        if pio run -e esp32s3 --target uploadfs --upload-port "$PORT"; then
            print_success "Filesystem upload successful!"
        else
            print_error "Filesystem upload failed!"
            exit 1
        fi
        ;;
        
    clean)
        print_header "Cleaning Build Files"
        pio run -e esp32s3 --target clean
        print_success "Clean complete"
        ;;
        
    check)
        print_header "Pre-flight Check"
        
        echo "Checking PlatformIO installation..."
        if command -v pio &> /dev/null; then
            print_success "PlatformIO installed: $(pio --version)"
        else
            print_error "PlatformIO not found!"
            echo "Install with: brew install platformio"
            exit 1
        fi
        
        echo ""
        echo "Checking for connected devices..."
        DEVICES=$(ls /dev/cu.usbserial* /dev/cu.SLAB* /dev/cu.wchusbserial* 2>/dev/null || true)
        if [ -n "$DEVICES" ]; then
            print_success "Found devices:"
            echo "$DEVICES" | while read -r dev; do
                echo "  - $dev"
            done
        else
            print_warning "No ESP32 devices detected"
        fi
        
        echo ""
        echo "Checking secrets.h..."
        if [ -f "$FIRMWARE_DIR/include/secrets.h" ]; then
            print_success "secrets.h exists"
        else
            print_warning "secrets.h not found!"
            echo "Copy from template: cp include/secrets.h.example include/secrets.h"
        fi
        
        echo ""
        echo "Checking web interface files..."
        if [ -d "$FIRMWARE_DIR/data" ] && [ -f "$FIRMWARE_DIR/data/index.html" ]; then
            print_success "Web interface files present"
            ls -la "$FIRMWARE_DIR/data/"
        else
            print_warning "Web interface files missing in data/"
        fi
        ;;
        
    *)
        echo "ESP32-S3 Webex Display Test Script"
        echo ""
        echo "Usage: $0 <command> [port]"
        echo ""
        echo "Commands:"
        echo "  build     - Build the firmware"
        echo "  upload    - Upload firmware to device"
        echo "  monitor   - Open serial monitor"
        echo "  flash     - Build, upload, and monitor (all-in-one)"
        echo "  uploadfs  - Upload web interface files (LittleFS)"
        echo "  clean     - Clean build files"
        echo "  check     - Pre-flight check (verify setup)"
        echo ""
        echo "Examples:"
        echo "  $0 check                          # Verify setup"
        echo "  $0 build                          # Just build"
        echo "  $0 flash                          # Full flash cycle"
        echo "  $0 upload /dev/cu.usbserial-0001  # Upload to specific port"
        ;;
esac
