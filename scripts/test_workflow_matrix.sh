#!/bin/bash
# Test script to simulate GitHub Actions workflow locally
# This validates the matrix generation and build process

set -e

echo "=================================================="
echo "Testing Firmware Workflow Matrix Locally"
echo "=================================================="
echo ""

# Change to project root
cd "$(dirname "$0")/.."

# Step 1: Generate Matrix
echo "Step 1: Generating build matrix..."
MATRIX_JSON=$(python3 scripts/generate_build_matrix.py)
echo "$MATRIX_JSON" | jq '.'
echo ""

# Step 2: Parse Matrix
echo "Step 2: Parsing matrix entries..."
BOARDS=$(echo "$MATRIX_JSON" | jq -r '.include[] | @json')
BOARD_COUNT=$(echo "$MATRIX_JSON" | jq '.include | length')
echo "Found $BOARD_COUNT boards to build"
echo ""

# Step 3: Validate each board entry
echo "Step 3: Validating board configurations..."
echo "$BOARDS" | while IFS= read -r board; do
    BOARD_TYPE=$(echo "$board" | jq -r '.board_type')
    CHIP_FAMILY=$(echo "$board" | jq -r '.chip_family')
    PIO_ENV=$(echo "$board" | jq -r '.platformio_env')
    FLASH_SIZE=$(echo "$board" | jq -r '.flash_size')
    
    echo "  ✓ $CHIP_FAMILY ($BOARD_TYPE)"
    echo "    - PlatformIO env: $PIO_ENV"
    echo "    - Flash size: $FLASH_SIZE"
    
    # Check if platformio.ini has this environment
    if grep -q "^\[env:$PIO_ENV\]" firmware/platformio.ini; then
        echo "    - PlatformIO config: ✓ Found"
    else
        echo "    - PlatformIO config: ✗ MISSING!"
        exit 1
    fi
    echo ""
done

# Step 4: Test building one board (optional - takes time)
echo "Step 4: Quick build test (optional)..."
read -p "Do you want to test building ESP32-S3? (y/N): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Building ESP32-S3 firmware..."
    cd firmware
    pio run -e esp32s3 2>&1 | tail -15
    
    if [ -f ".pio/build/esp32s3/firmware.bin" ]; then
        SIZE=$(stat -f%z ".pio/build/esp32s3/firmware.bin" 2>/dev/null || stat -c%s ".pio/build/esp32s3/firmware.bin")
        echo ""
        echo "✓ Build successful: $(($SIZE / 1024)) KB"
    else
        echo "✗ Build failed: firmware.bin not found"
        exit 1
    fi
    cd ..
fi

echo ""
echo "=================================================="
echo "✅ Matrix Test Complete!"
echo "=================================================="
echo ""
echo "Summary:"
echo "  - Matrix generation: ✓"
echo "  - Board configurations: ✓"
echo "  - PlatformIO environments: ✓"
echo ""
echo "The workflow is ready to use!"
echo ""
echo "To use the new dynamic workflow:"
echo "  1. Replace .github/workflows/firmware.yml with firmware-dynamic.yml"
echo "  2. Commit and push"
echo "  3. Create a tag to trigger a build"
