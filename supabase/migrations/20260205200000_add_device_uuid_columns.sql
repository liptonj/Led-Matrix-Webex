-- Migration: Add device_uuid columns to pairings, commands, user_devices, oauth_tokens tables
-- Phase 1: UUID-based device identity architecture
--
-- This migration adds device_uuid columns (nullable initially) to tables that reference devices.
-- The columns will be backfilled in the next migration, then made NOT NULL.
--
-- Tables affected:
-- - display.pairings: Add device_uuid to reference devices.id
-- - display.commands: Add device_uuid to reference devices.id
-- - display.user_devices: Add device_uuid to reference devices.id
-- - display.oauth_tokens: Add device_uuid to reference devices.id (for device-scope tokens)

-- =============================================================================
-- Part 1: Add device_uuid to display.pairings
-- =============================================================================

ALTER TABLE display.pairings
  ADD COLUMN device_uuid UUID REFERENCES display.devices(id) ON DELETE CASCADE;

COMMENT ON COLUMN display.pairings.device_uuid IS 
  'UUID reference to devices.id. Replaces serial_number for UUID-based lookups.';

-- =============================================================================
-- Part 2: Add device_uuid to display.commands
-- =============================================================================

ALTER TABLE display.commands
  ADD COLUMN device_uuid UUID REFERENCES display.devices(id) ON DELETE CASCADE;

COMMENT ON COLUMN display.commands.device_uuid IS 
  'UUID reference to devices.id. Replaces serial_number for UUID-based lookups.';

-- =============================================================================
-- Part 3: Add device_uuid to display.user_devices
-- =============================================================================

ALTER TABLE display.user_devices
  ADD COLUMN device_uuid UUID REFERENCES display.devices(id) ON DELETE CASCADE;

COMMENT ON COLUMN display.user_devices.device_uuid IS 
  'UUID reference to devices.id. Replaces serial_number for UUID-based lookups.';

-- =============================================================================
-- Part 4: Add device_uuid to display.oauth_tokens
-- =============================================================================

ALTER TABLE display.oauth_tokens
  ADD COLUMN device_uuid UUID REFERENCES display.devices(id) ON DELETE CASCADE;

COMMENT ON COLUMN display.oauth_tokens.device_uuid IS 
  'UUID reference to devices.id for device-scope tokens. NULL for user-scope tokens.';
