-- Migration: Add user session RLS policies for embedded app
--
-- This migration ensures that authenticated users can access their data via
-- user session (auth.uid()) for the embedded app. It adds missing policies
-- and updates existing ones to support UUID-based device identity.
--
-- Policies added/updated:
-- 1. pairings_user_update_uuid - Users can UPDATE pairings where user_uuid = auth.uid()
-- 2. connection_heartbeats_user_select - Updated to use UUID-based device lookup
-- 3. devices_user_select - Updated to use UUID-based device lookup
--
-- Migration is idempotent - safe to run multiple times.

-- =============================================================================
-- Part 1: Pairings Table - Add user UPDATE policy
-- =============================================================================

-- Users can update their own pairings (by user_uuid)
-- This allows users to update pairing state via user session
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'display' 
    AND tablename = 'pairings' 
    AND policyname = 'pairings_user_update_uuid'
  ) THEN
    CREATE POLICY "pairings_user_update_uuid" ON display.pairings
      FOR UPDATE TO authenticated
      USING (
        display.is_admin()
        OR user_uuid = auth.uid()
        OR (device_uuid IS NOT NULL AND display.user_can_access_device(device_uuid))
      )
      WITH CHECK (
        display.is_admin()
        OR user_uuid = auth.uid()
        OR (device_uuid IS NOT NULL AND display.user_can_access_device(device_uuid))
      );
  END IF;
END $$;

COMMENT ON POLICY "pairings_user_update_uuid" ON display.pairings IS 
  'UUID-based: Users can update pairings where user_uuid = auth.uid() or via device_uuid access. '
  'Enables user session access for embedded app.';

-- =============================================================================
-- Part 2: Connection Heartbeats Table - Update to UUID-based lookup
-- =============================================================================

-- Update connection_heartbeats_user_select to use UUID-based device lookup
-- This policy allows users to SELECT heartbeats for their devices via UUID
DROP POLICY IF EXISTS "connection_heartbeats_user_select" ON display.connection_heartbeats;

CREATE POLICY "connection_heartbeats_user_select"
    ON display.connection_heartbeats
    FOR SELECT
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
                  AND display.user_can_access_device(p.device_uuid)
                )
                -- Fallback to serial_number for backward compatibility
                OR (
                  p.serial_number IS NOT NULL 
                  AND display.user_can_access_device(p.serial_number)
                )
              )
        )
    );

COMMENT ON POLICY "connection_heartbeats_user_select" ON display.connection_heartbeats IS 
  'Users can select heartbeats for their devices via user_uuid, device_uuid, or serial_number. '
  'Updated to support UUID-based device identity while maintaining backward compatibility.';

-- =============================================================================
-- Part 3: Devices Table - Add UUID-based SELECT policy
-- =============================================================================

-- Add UUID-based SELECT policy for devices
-- This works alongside the existing serial_number-based policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'display' 
    AND tablename = 'devices' 
    AND policyname = 'devices_user_select_uuid'
  ) THEN
    CREATE POLICY "devices_user_select_uuid" ON display.devices
      FOR SELECT TO authenticated
      USING (
        display.is_admin()
        OR device_uuid IN (
          SELECT device_uuid FROM display.user_devices
          WHERE user_id = auth.uid()
            AND device_uuid IS NOT NULL
        )
        -- Fallback to serial_number for backward compatibility
        OR serial_number IN (
          SELECT serial_number FROM display.user_devices
          WHERE user_id = auth.uid()
            AND serial_number IS NOT NULL
        )
      );
  END IF;
END $$;

COMMENT ON POLICY "devices_user_select_uuid" ON display.devices IS 
  'UUID-based: Users can select their devices via device_uuid or serial_number. '
  'Works alongside legacy serial_number-based policy for backward compatibility.';

-- =============================================================================
-- Migration Summary
-- =============================================================================
--
-- Policies Created/Updated:
-- 1. pairings_user_update_uuid - NEW: Users can UPDATE pairings where user_uuid = auth.uid()
-- 2. connection_heartbeats_user_select - UPDATED: Now uses UUID-based device lookup
-- 3. devices_user_select_uuid - NEW: UUID-based SELECT policy for devices
--
-- Verification:
-- All policies support user session access via auth.uid() and maintain backward
-- compatibility with serial_number-based lookups during the transition period.
