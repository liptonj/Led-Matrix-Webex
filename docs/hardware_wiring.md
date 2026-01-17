# Hardware Wiring Guide

## Components Required

- ESP32-S3-DevKitC-1-N8R2 development board
- RGB LED Matrix Panel 64×32 pixels (P3, HUB75 interface)
- 5V power supply (2.5A minimum, 4A recommended)
- HUB75 ribbon cable (16-pin, 2.54mm pitch)
- Jumper wires or custom PCB

## Power Supply

**Important**: The LED matrix requires a separate 5V power supply. Do not power the matrix from the ESP32's 5V pin as it cannot provide sufficient current.

- Matrix power: 5V @ 2.5A minimum (4A recommended for full brightness)
- ESP32: Can be powered via USB-C or from the same 5V supply

## HUB75 Pinout

The matrix uses a standard HUB75 interface with the following pin mapping for ESP32-S3:

| Matrix Pin | Function | ESP32-S3 GPIO | Notes |
|------------|----------|---------------|-------|
| R1 | Red data (upper half) | GPIO42 | |
| G1 | Green data (upper half) | GPIO41 | |
| B1 | Blue data (upper half) | GPIO40 | |
| R2 | Red data (lower half) | GPIO38 | |
| G2 | Green data (lower half) | GPIO39 | |
| B2 | Blue data (lower half) | GPIO37 | |
| A | Row select bit 0 | GPIO45 | |
| B | Row select bit 1 | GPIO36 | |
| C | Row select bit 2 | GPIO48 | |
| D | Row select bit 3 | GPIO35 | |
| E | Row select bit 4 | GPIO21 | For 1/32 scan panels |
| CLK | Clock | GPIO2 | |
| LAT/STB | Latch/Strobe | GPIO47 | |
| OE | Output Enable | GPIO14 | Active low |
| GND | Ground | GND | Multiple connections |

## Wiring Diagram

```
ESP32-S3-DevKitC-1                    HUB75 Connector
┌─────────────────┐                   ┌─────────────┐
│                 │                   │ R1  G1      │
│           GPIO42├───────────────────┤ 1   2       │
│           GPIO41├───────────────────┤ 3   4       │
│           GPIO40├───────────────────┤ B1  GND     │
│                 │                   │ 5   6       │
│           GPIO38├───────────────────┤ R2  G2      │
│           GPIO39├───────────────────┤ 7   8       │
│           GPIO37├───────────────────┤ B2  GND     │
│                 │                   │ 9   10      │
│           GPIO45├───────────────────┤ A   B       │
│           GPIO36├───────────────────┤ 11  12      │
│           GPIO48├───────────────────┤ C   D       │
│           GPIO35├───────────────────┤ 13  14      │
│            GPIO2├───────────────────┤ CLK LAT     │
│           GPIO47├───────────────────┤ 15  16      │
│           GPIO14├───────────────────┤ OE  E       │
│           GPIO21├───────────────────┤             │
│              GND├───────────────────┤ GND         │
└─────────────────┘                   └─────────────┘
```

## HUB75 Connector Pinout (View from front of matrix)

```
┌───┬───┬───┬───┬───┬───┬───┬───┐
│R1 │G1 │B1 │GND│R2 │G2 │B2 │GND│  Top row (odd pins)
├───┼───┼───┼───┼───┼───┼───┼───┤
│ A │ B │ C │ D │CLK│LAT│OE │ E │  Bottom row (even pins)
└───┴───┴───┴───┴───┴───┴───┴───┘
  1   3   5   7   9  11  13  15
  2   4   6   8  10  12  14  16
```

## Assembly Tips

1. **Double-check polarity**: The HUB75 connector is not keyed. Ensure pin 1 alignment.

2. **Secure connections**: Use a ribbon cable with IDC connectors for reliable connections.

3. **Ground connections**: Connect multiple GND pins for stable operation.

4. **Keep wires short**: Long wires can cause signal integrity issues at high refresh rates.

5. **Heat management**: The matrix generates heat. Ensure adequate ventilation.

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| No display | Power not connected | Check 5V supply to matrix |
| Dim display | Insufficient power | Use higher current supply |
| Flickering | Poor ground connection | Add more GND connections |
| Wrong colors | Swapped RGB pins | Check wiring order |
| Half display wrong | R2/G2/B2 wiring | Check lower half data pins |
| Garbled image | Clock/Latch issues | Check CLK and LAT wiring |

## ESP32-S3 GPIO Notes

- GPIO0 is used for boot mode selection - avoid using it
- GPIO45/46 are strapping pins - use with caution
- The chosen pins avoid conflicts with USB, JTAG, and flash
