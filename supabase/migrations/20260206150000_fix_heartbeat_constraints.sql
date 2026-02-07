-- Fix 1: Add SECURITY DEFINER to trigger function
-- This allows the trigger to bypass RLS when inserting into connection_heartbeats
ALTER FUNCTION display.pairings_presence_trigger() SECURITY DEFINER;

COMMENT ON FUNCTION display.pairings_presence_trigger() IS 
  'SECURITY DEFINER: Automatically updates app_last_seen/app_connected in pairings table and upserts '
  'into connection_heartbeats (bypassing RLS) whenever pairings table is updated.';

-- Fix 2: Add unique constraint on device_uuid for connection_heartbeats
-- This enables upsert operations using device_uuid as the conflict target
ALTER TABLE display.connection_heartbeats
  ADD CONSTRAINT connection_heartbeats_device_uuid_key UNIQUE (device_uuid);

COMMENT ON CONSTRAINT connection_heartbeats_device_uuid_key ON display.connection_heartbeats IS 
  'Unique constraint on device_uuid to support efficient upsert operations for UUID-based heartbeat tracking.';

-- Add index for efficient lookups (if not already exists)
CREATE INDEX IF NOT EXISTS idx_heartbeats_device_uuid_unique 
  ON display.connection_heartbeats(device_uuid);
