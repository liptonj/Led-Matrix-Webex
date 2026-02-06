-- Migration: Automatic presence/heartbeat tracking via Postgres trigger
--
-- This migration replaces the presence/heartbeat logic previously in the
-- update-app-state Edge Function with a database trigger that automatically
-- updates presence state whenever the pairings table is updated.
--
-- Changes:
-- 1. Add device_uuid column to connection_heartbeats (if missing)
-- 2. Create trigger function that updates pairings.app_last_seen/app_connected
--    and upserts into connection_heartbeats
-- 3. Create BEFORE UPDATE trigger on display.pairings
-- 4. Add RLS policy for authenticated users to upsert heartbeats

-- =============================================================================
-- Part 1: Add device_uuid to connection_heartbeats (if missing)
-- =============================================================================

ALTER TABLE display.connection_heartbeats
  ADD COLUMN IF NOT EXISTS device_uuid UUID REFERENCES display.devices(id) ON DELETE CASCADE;

COMMENT ON COLUMN display.connection_heartbeats.device_uuid IS 
  'UUID reference to devices.id. Used for UUID-based device lookups.';

-- Add index on device_uuid for efficient queries
CREATE INDEX IF NOT EXISTS idx_heartbeats_device_uuid 
  ON display.connection_heartbeats(device_uuid)
  WHERE device_uuid IS NOT NULL;

-- =============================================================================
-- Part 2: Create trigger function for automatic presence tracking
-- =============================================================================

CREATE OR REPLACE FUNCTION display.pairings_presence_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Update app_last_seen and app_connected in pairings table
    NEW.app_last_seen = NOW();
    NEW.app_connected = TRUE;
    
    -- Upsert into connection_heartbeats table
    -- This does NOT trigger realtime notifications to devices
    INSERT INTO display.connection_heartbeats (
        pairing_code,
        device_uuid,
        app_last_seen,
        app_connected
    )
    VALUES (
        NEW.pairing_code,
        NEW.device_uuid,
        NOW(),
        TRUE
    )
    ON CONFLICT (pairing_code) 
    DO UPDATE SET
        device_uuid = COALESCE(EXCLUDED.device_uuid, connection_heartbeats.device_uuid),
        app_last_seen = EXCLUDED.app_last_seen,
        app_connected = EXCLUDED.app_connected,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION display.pairings_presence_trigger() IS 
  'Automatically updates app_last_seen/app_connected in pairings table and upserts '
  'into connection_heartbeats whenever pairings table is updated. '
  'This replaces the manual heartbeat logic in update-app-state Edge Function.';

-- =============================================================================
-- Part 3: Create BEFORE UPDATE trigger on pairings table
-- =============================================================================

DROP TRIGGER IF EXISTS pairings_presence_before_update ON display.pairings;

CREATE TRIGGER pairings_presence_before_update
    BEFORE UPDATE ON display.pairings
    FOR EACH ROW
    EXECUTE FUNCTION display.pairings_presence_trigger();

COMMENT ON TRIGGER pairings_presence_before_update ON display.pairings IS 
  'Automatically tracks app presence/heartbeat whenever pairings table is updated. '
  'Sets app_last_seen = NOW(), app_connected = TRUE, and upserts into connection_heartbeats.';

-- =============================================================================
-- Part 4: Add RLS policy for authenticated users to upsert heartbeats
-- =============================================================================

-- Policy: Authenticated users can upsert heartbeats for their own devices
-- Checks that auth.uid() matches the user in the pairing for the device_uuid
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'display' 
    AND tablename = 'connection_heartbeats'
    AND policyname = 'heartbeats_user_upsert'
  ) THEN
    CREATE POLICY "heartbeats_user_upsert"
      ON display.connection_heartbeats
      FOR INSERT
      WITH CHECK (
        display.is_admin()
        OR EXISTS (
          SELECT 1
          FROM display.pairings p
          WHERE p.pairing_code = pairing_code
            AND (
              -- Check via user_uuid
              p.user_uuid = auth.uid()
              -- Or check via device_uuid
              OR (
                p.device_uuid IS NOT NULL 
                AND display.user_can_access_device(target_device_uuid := p.device_uuid)
              )
              -- Fallback to serial_number for backward compatibility
              OR (
                p.serial_number IS NOT NULL 
                AND display.user_can_access_device(target_serial := p.serial_number)
              )
            )
        )
      );
    
    -- Also allow UPDATE for the same conditions
    CREATE POLICY "heartbeats_user_update"
      ON display.connection_heartbeats
      FOR UPDATE
      USING (
        display.is_admin()
        OR EXISTS (
          SELECT 1
          FROM display.pairings p
          WHERE p.pairing_code = connection_heartbeats.pairing_code
            AND (
              -- Check via user_uuid
              p.user_uuid = auth.uid()
              -- Or check via device_uuid
              OR (
                p.device_uuid IS NOT NULL 
                AND display.user_can_access_device(target_device_uuid := p.device_uuid)
              )
              -- Fallback to serial_number for backward compatibility
              OR (
                p.serial_number IS NOT NULL 
                AND display.user_can_access_device(target_serial := p.serial_number)
              )
            )
        )
      )
      WITH CHECK (
        display.is_admin()
        OR EXISTS (
          SELECT 1
          FROM display.pairings p
          WHERE p.pairing_code = connection_heartbeats.pairing_code
            AND (
              -- Check via user_uuid
              p.user_uuid = auth.uid()
              -- Or check via device_uuid
              OR (
                p.device_uuid IS NOT NULL 
                AND display.user_can_access_device(target_device_uuid := p.device_uuid)
              )
              -- Fallback to serial_number for backward compatibility
              OR (
                p.serial_number IS NOT NULL 
                AND display.user_can_access_device(target_serial := p.serial_number)
              )
            )
        )
      );
  END IF;
END $$;

COMMENT ON POLICY "heartbeats_user_upsert" ON display.connection_heartbeats IS 
  'Authenticated users can INSERT heartbeats for devices they own (via user_uuid, device_uuid, or serial_number).';

COMMENT ON POLICY "heartbeats_user_update" ON display.connection_heartbeats IS 
  'Authenticated users can UPDATE heartbeats for devices they own (via user_uuid, device_uuid, or serial_number).';
