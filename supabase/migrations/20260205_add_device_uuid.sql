-- Migration: Add device_uuid columns to pairings, commands, user_devices, oauth_tokens
-- Phase 1: UUID-based device identity architecture
--
-- This migration adds device_uuid columns (nullable initially) to tables that reference devices.
-- The columns are backfilled from devices table using serial_number join, then indexes are added.
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
  ADD COLUMN IF NOT EXISTS device_uuid UUID REFERENCES display.devices(id) ON DELETE CASCADE;

COMMENT ON COLUMN display.pairings.device_uuid IS 
  'UUID reference to devices.id. Replaces serial_number for UUID-based lookups.';

-- =============================================================================
-- Part 2: Add device_uuid to display.commands
-- =============================================================================

ALTER TABLE display.commands
  ADD COLUMN IF NOT EXISTS device_uuid UUID REFERENCES display.devices(id) ON DELETE CASCADE;

COMMENT ON COLUMN display.commands.device_uuid IS 
  'UUID reference to devices.id. Replaces serial_number for UUID-based lookups.';

-- =============================================================================
-- Part 3: Add device_uuid to display.user_devices
-- =============================================================================

ALTER TABLE display.user_devices
  ADD COLUMN IF NOT EXISTS device_uuid UUID REFERENCES display.devices(id) ON DELETE CASCADE;

COMMENT ON COLUMN display.user_devices.device_uuid IS 
  'UUID reference to devices.id. Replaces serial_number for UUID-based lookups.';

-- =============================================================================
-- Part 4: Add device_uuid to display.oauth_tokens
-- =============================================================================

ALTER TABLE display.oauth_tokens
  ADD COLUMN IF NOT EXISTS device_uuid UUID REFERENCES display.devices(id) ON DELETE CASCADE;

COMMENT ON COLUMN display.oauth_tokens.device_uuid IS 
  'UUID reference to devices.id for device-scope tokens. NULL for user-scope tokens.';

-- =============================================================================
-- Part 5: Backfill device_uuid from devices table using serial_number join
-- =============================================================================

-- Backfill pairings.device_uuid
UPDATE display.pairings p
SET device_uuid = d.id
FROM display.devices d
WHERE p.serial_number = d.serial_number
  AND p.device_uuid IS NULL;

-- Backfill commands.device_uuid
UPDATE display.commands c
SET device_uuid = d.id
FROM display.devices d
WHERE c.serial_number = d.serial_number
  AND c.device_uuid IS NULL;

-- Backfill user_devices.device_uuid
UPDATE display.user_devices ud
SET device_uuid = d.id
FROM display.devices d
WHERE ud.serial_number = d.serial_number
  AND ud.device_uuid IS NULL;

-- Backfill oauth_tokens.device_uuid (only for device-scope tokens)
UPDATE display.oauth_tokens ot
SET device_uuid = d.id
FROM display.devices d
WHERE ot.serial_number = d.serial_number
  AND ot.device_uuid IS NULL
  AND ot.token_scope = 'device';

-- =============================================================================
-- Part 6: Add indexes on device_uuid columns
-- =============================================================================

-- Index on pairings.device_uuid for device lookups
CREATE INDEX IF NOT EXISTS idx_pairings_device_uuid 
  ON display.pairings(device_uuid)
  WHERE device_uuid IS NOT NULL;

-- Index on commands.device_uuid for device command queries
CREATE INDEX IF NOT EXISTS idx_commands_device_uuid 
  ON display.commands(device_uuid)
  WHERE device_uuid IS NOT NULL;

-- Index on user_devices.device_uuid for reverse lookups (device -> users)
CREATE INDEX IF NOT EXISTS idx_user_devices_device_uuid 
  ON display.user_devices(device_uuid)
  WHERE device_uuid IS NOT NULL;

-- Index on oauth_tokens.device_uuid for device token lookups
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_device_uuid 
  ON display.oauth_tokens(device_uuid)
  WHERE device_uuid IS NOT NULL;

-- Composite index for device + status lookups in commands
CREATE INDEX IF NOT EXISTS idx_commands_device_status 
  ON display.commands(device_uuid, status, created_at)
  WHERE device_uuid IS NOT NULL AND status = 'pending';
