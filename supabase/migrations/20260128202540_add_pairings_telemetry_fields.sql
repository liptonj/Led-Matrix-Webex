-- Migration: Add telemetry fields to display.pairings
-- Adds firmware_version, ssid, and ota_partition for device diagnostics.

ALTER TABLE display.pairings
    ADD COLUMN IF NOT EXISTS firmware_version TEXT,
    ADD COLUMN IF NOT EXISTS ssid TEXT,
    ADD COLUMN IF NOT EXISTS ota_partition TEXT;

COMMENT ON COLUMN display.pairings.firmware_version IS 'Firmware version reported by device';
COMMENT ON COLUMN display.pairings.ssid IS 'WiFi SSID reported by device';
COMMENT ON COLUMN display.pairings.ota_partition IS 'Running OTA partition label reported by device';
