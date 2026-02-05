-- Migration: Backfill user_uuid in pairings table
-- Phase 1: UUID-based device identity architecture
--
-- This migration backfills user_uuid in pairings by joining through user_devices.
-- Since a device can have multiple users, we use the first user assignment.
-- In practice, pairings are typically associated with a single primary user.
--
-- Error handling:
-- - Uses DISTINCT ON to handle multiple user assignments per device
-- - Logs warnings for pairings that cannot be backfilled
-- - Does not fail migration if some rows cannot be backfilled

-- =============================================================================
-- Backfill user_uuid in display.pairings
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
