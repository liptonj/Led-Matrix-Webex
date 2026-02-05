-- Migration: Add user_uuid column to pairings table
-- Phase 1: UUID-based device identity architecture
--
-- This migration adds user_uuid column (nullable initially) to display.pairings.
-- The column is backfilled from user_devices table where device is assigned.
-- An index is added for efficient user lookups.
--
-- The user_uuid represents the user who owns/controls the pairing session.
-- This allows efficient UUID-based lookups for user-scoped queries.

-- =============================================================================
-- Add user_uuid to display.pairings
-- =============================================================================

ALTER TABLE display.pairings
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN display.pairings.user_uuid IS 
  'UUID reference to auth.users.id for the user who owns this pairing session. '
  'Backfilled from user_devices based on serial_number. '
  'NULL if no user is assigned to the device.';

-- =============================================================================
-- Backfill user_uuid from user_devices where device is assigned
-- =============================================================================

DO $$
DECLARE
  updated_count INTEGER;
  unassigned_count INTEGER;
BEGIN
  -- Backfill user_uuid from user_devices
  -- Use DISTINCT ON to get one user per device (prefer earliest assignment)
  UPDATE display.pairings p
  SET user_uuid = ud.user_id
  FROM (
    SELECT DISTINCT ON (serial_number) 
      serial_number,
      user_id,
      created_at
    FROM display.user_devices
    ORDER BY serial_number, created_at ASC
  ) ud
  WHERE p.serial_number = ud.serial_number
    AND p.user_uuid IS NULL;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  -- Count pairings without user assignment
  SELECT COUNT(*) INTO unassigned_count
  FROM display.pairings
  WHERE user_uuid IS NULL;
  
  IF unassigned_count > 0 THEN
    RAISE NOTICE 'Found % pairings without user assignment (this is normal for unassigned devices)', unassigned_count;
  END IF;
  
  RAISE NOTICE 'Backfilled user_uuid for % pairings', updated_count;
END $$;

-- =============================================================================
-- Add index on user_uuid column
-- =============================================================================

-- Index on pairings.user_uuid for user lookups
CREATE INDEX IF NOT EXISTS idx_pairings_user_uuid 
  ON display.pairings(user_uuid)
  WHERE user_uuid IS NOT NULL;

-- Composite index for user + device lookups in pairings
CREATE INDEX IF NOT EXISTS idx_pairings_user_device_uuid 
  ON display.pairings(user_uuid, device_uuid)
  WHERE user_uuid IS NOT NULL AND device_uuid IS NOT NULL;
