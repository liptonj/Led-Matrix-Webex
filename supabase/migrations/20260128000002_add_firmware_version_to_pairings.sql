-- Migration: Add firmware_version column to pairings table
--
-- Allows devices to report their current firmware version during state sync.
-- This enables the admin dashboard and embedded app to see device versions.

-- Add firmware_version column to pairings
ALTER TABLE display.pairings 
ADD COLUMN IF NOT EXISTS firmware_version TEXT;

-- Add comment for documentation
COMMENT ON COLUMN display.pairings.firmware_version IS 'Current firmware version reported by the device';

-- Create index for firmware version queries (useful for OTA targeting)
CREATE INDEX IF NOT EXISTS idx_pairings_firmware_version 
ON display.pairings(firmware_version) 
WHERE firmware_version IS NOT NULL;
