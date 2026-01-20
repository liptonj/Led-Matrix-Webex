# LED Matrix Display Test

Simple test firmware to verify LED matrix panel wiring and display functionality.

## Purpose

Use this test firmware to:
- Verify correct wiring between ESP32 and HUB75 matrix
- Test all colors and display functionality
- Diagnose display issues before flashing main firmware

## Features

- Cycles through 6 test patterns every 2 seconds:
  1. Solid Red
  2. Solid Green  
  3. Solid Blue
  4. Solid White
  5. Color Bars (8 colors)
  6. Checkerboard Pattern

- Serial output shows current test pattern
- Uses the same pin configuration as bootstrap firmware

## Building and Uploading

### ESP32-S3
```bash
pio run -e esp32s3 -t upload
```

### ESP32
```bash
pio run -e esp32 -t upload
```

## Pin Configuration

This test uses the working pin configuration:

**ESP32-S3 Pinout:**
- R1: GPIO 42
- G1: GPIO 41
- B1: GPIO 40
- R2: GPIO 38
- G2: GPIO 39
- B2: GPIO 37
- A: GPIO 45
- B: GPIO 36
- C: GPIO 48
- D: GPIO 35
- E: GPIO 21
- LAT: GPIO 47
- OE: GPIO 14
- CLK: GPIO 2

## Troubleshooting

**No display output:**
- Check all wiring connections
- Verify 5V power supply is connected and adequate (3-5A)
- Check serial monitor for error messages

**Flickering or incorrect colors:**
- Verify ground connections
- Check that all data pins are connected correctly
- Ensure power supply provides sufficient current

**Display works but colors are wrong:**
- Double-check R1/R2, G1/G2, B1/B2 pin connections
- Swap pins if colors appear mixed up
