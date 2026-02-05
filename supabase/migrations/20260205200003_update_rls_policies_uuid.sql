-- Migration: Update RLS policies for UUID-Based Device Identity Architecture
-- Phase 1: UUID-based device identity architecture
--
-- This migration adds UUID-based RLS policies while maintaining backward compatibility
-- with existing serial_number-based policies. Old policies are NOT dropped to ensure
-- a smooth transition period.
--
-- Key changes:
-- 1. Update user_can_access_device() to support both serial_number and device_uuid
-- 2. Add new UUID-based policies for commands, pairings, user_devices, oauth_tokens
-- 3. Keep existing serial_number-based policies for backward compatibility
-- 4. Document transitional policies for future cleanup
--
-- Migration is idempotent - safe to run multiple times.

-- =============================================================================
-- Part 1: Update user_can_access_device() helper function
-- =============================================================================

-- Keep existing overloads for backward compatibility and add new dual-parameter version
-- This ensures existing code continues to work while supporting new UUID-based calls

-- Function for serial_number (backward compatibility - existing calls)
CREATE OR REPLACE FUNCTION display.user_can_access_device(target_serial TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF display.is_admin() THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM display.user_devices ud
        JOIN display.user_profiles up ON up.user_id = ud.user_id
        WHERE ud.user_id = auth.uid()
        AND ud.serial_number = target_serial
        AND up.disabled = FALSE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function for device_uuid (new UUID-based lookup)
-- Drop existing function first to allow parameter rename
DROP FUNCTION IF EXISTS display.user_can_access_device(UUID);

CREATE OR REPLACE FUNCTION display.user_can_access_device(target_device_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    IF display.is_admin() THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM display.user_devices ud
        JOIN display.user_profiles up ON up.user_id = ud.user_id
        WHERE ud.user_id = auth.uid()
        AND ud.device_uuid = target_device_uuid
        AND up.disabled = FALSE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function accepting both parameters (for explicit dual-parameter calls)
-- Either parameter can be NULL, but at least one should be provided
CREATE OR REPLACE FUNCTION display.user_can_access_device(
  target_serial TEXT DEFAULT NULL,
  target_device_uuid UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'display'
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM display.user_devices ud
    JOIN display.user_profiles up ON up.user_id = ud.user_id
    WHERE ud.user_id = auth.uid()
      AND up.disabled = FALSE
      AND (
        (target_serial IS NOT NULL AND ud.serial_number = target_serial)
        OR (target_device_uuid IS NOT NULL AND ud.device_uuid = target_device_uuid)
      )
  )
  OR display.is_admin();
$$;

-- Grant execute permissions on all overloads
GRANT EXECUTE ON FUNCTION display.user_can_access_device(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION display.user_can_access_device(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION display.user_can_access_device(TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION display.user_can_access_device(TEXT) IS 
  'Returns true if current user can access device by serial_number (admin or assigned). '
  'Legacy function - maintained for backward compatibility.';

COMMENT ON FUNCTION display.user_can_access_device(UUID) IS 
  'Returns true if current user can access device by device_uuid (admin or assigned). '
  'UUID-based lookup for Phase 1 migration.';

COMMENT ON FUNCTION display.user_can_access_device(TEXT, UUID) IS 
  'Returns true if current user can access device by serial_number or device_uuid (admin or assigned). '
  'Supports both legacy serial_number lookups and new UUID-based lookups. '
  'At least one parameter should be provided.';

-- =============================================================================
-- Part 2: Commands Table RLS - Add UUID-based policies
-- =============================================================================

-- NEW: Users can insert commands for their devices (by device_uuid)
-- This policy works alongside the existing commands_app_insert policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'display' 
    AND tablename = 'commands' 
    AND policyname = 'commands_user_insert_uuid'
  ) THEN
    CREATE POLICY "commands_user_insert_uuid" ON display.commands
      FOR INSERT TO authenticated
      WITH CHECK (
        display.is_admin()
        OR device_uuid IN (
          SELECT device_uuid FROM display.user_devices
          WHERE user_id = auth.uid()
            AND device_uuid IS NOT NULL
        )
      );
  END IF;
END $$;

-- NEW: Users can select their device commands (by device_uuid)
-- This policy works alongside the existing commands_user_select policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'display' 
    AND tablename = 'commands' 
    AND policyname = 'commands_user_select_uuid'
  ) THEN
    CREATE POLICY "commands_user_select_uuid" ON display.commands
      FOR SELECT TO authenticated
      USING (
        display.is_admin()
        OR device_uuid IN (
          SELECT device_uuid FROM display.user_devices
          WHERE user_id = auth.uid()
            AND device_uuid IS NOT NULL
        )
      );
  END IF;
END $$;

COMMENT ON POLICY "commands_user_insert_uuid" ON display.commands IS 
  'UUID-based: Users can insert commands for their devices (by device_uuid). '
  'Transitional policy - works alongside legacy serial_number-based policies.';

COMMENT ON POLICY "commands_user_select_uuid" ON display.commands IS 
  'UUID-based: Users can select commands for their devices (by device_uuid). '
  'Transitional policy - works alongside legacy serial_number-based policies.';

-- =============================================================================
-- Part 3: Pairings Table RLS - Add UUID-based policies
-- =============================================================================

-- NEW: Users can view their device pairings (by user_uuid)
-- This policy works alongside existing pairings_user_select policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'display' 
    AND tablename = 'pairings' 
    AND policyname = 'pairings_user_select_uuid'
  ) THEN
    CREATE POLICY "pairings_user_select_uuid" ON display.pairings
      FOR SELECT TO authenticated
      USING (
        display.is_admin()
        OR user_uuid = auth.uid()
        OR (device_uuid IS NOT NULL AND display.user_can_access_device(device_uuid))
      );
  END IF;
END $$;

COMMENT ON POLICY "pairings_user_select_uuid" ON display.pairings IS 
  'UUID-based: Users can view pairings by user_uuid or device_uuid. '
  'Transitional policy - works alongside legacy serial_number-based policies.';

-- =============================================================================
-- Part 4: User Devices Table RLS - Add UUID-based update policy
-- =============================================================================

-- NEW: Enable devices to update their own row (for provisioning scenarios)
-- This allows devices authenticated via JWT to update their user_devices row
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'display' 
    AND tablename = 'user_devices' 
    AND policyname = 'user_devices_device_update'
  ) THEN
    CREATE POLICY "user_devices_device_update" ON display.user_devices
      FOR UPDATE TO authenticated
      USING (
        user_id = auth.uid()
        OR (
          device_uuid IS NOT NULL
          AND device_uuid = (
            current_setting('request.jwt.claims', true)::jsonb->>'device_uuid'
          )::uuid
        )
      )
      WITH CHECK (
        user_id = auth.uid()
        OR (
          device_uuid IS NOT NULL
          AND device_uuid = (
            current_setting('request.jwt.claims', true)::jsonb->>'device_uuid'
          )::uuid
        )
      );
  END IF;
END $$;

COMMENT ON POLICY "user_devices_device_update" ON display.user_devices IS 
  'UUID-based: Devices can update their own row via device_uuid in JWT claims. '
  'Also allows users to update their own device assignments.';

-- =============================================================================
-- Part 5: OAuth Tokens Table RLS - Add UUID-based policies
-- =============================================================================

-- NEW: Users can select their own tokens by user_id
-- This policy works alongside existing oauth_tokens_user_select policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'display' 
    AND tablename = 'oauth_tokens' 
    AND policyname = 'oauth_tokens_user_select_uuid'
  ) THEN
    CREATE POLICY "oauth_tokens_user_select_uuid" ON display.oauth_tokens
      FOR SELECT TO authenticated
      USING (
        display.is_admin()
        OR (
          token_scope = 'user' 
          AND user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- NEW: Devices can select their own device tokens (by device_uuid from JWT)
-- This policy works alongside existing oauth_tokens_device_select policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'display' 
    AND tablename = 'oauth_tokens' 
    AND policyname = 'oauth_tokens_device_select_uuid'
  ) THEN
    CREATE POLICY "oauth_tokens_device_select_uuid" ON display.oauth_tokens
      FOR SELECT TO authenticated
      USING (
        display.is_admin()
        OR (
          token_scope = 'device'
          AND device_uuid IS NOT NULL
          AND device_uuid = (
            current_setting('request.jwt.claims', true)::jsonb->>'device_uuid'
          )::uuid
        )
      );
  END IF;
END $$;

COMMENT ON POLICY "oauth_tokens_user_select_uuid" ON display.oauth_tokens IS 
  'UUID-based: Users can select their own user-scope tokens by user_id. '
  'Transitional policy - works alongside legacy policies.';

COMMENT ON POLICY "oauth_tokens_device_select_uuid" ON display.oauth_tokens IS 
  'UUID-based: Devices can select their own device-scope tokens by device_uuid from JWT. '
  'Transitional policy - works alongside legacy pairing_code-based policies.';

-- =============================================================================
-- Part 6: Documentation and Cleanup Notes
-- =============================================================================

-- Add migration metadata comment
COMMENT ON SCHEMA display IS 
  'Display schema with UUID-based device identity architecture. '
  'RLS policies support both legacy serial_number and new UUID-based lookups.';

-- =============================================================================
-- Migration Summary
-- =============================================================================
--
-- Policies Created:
-- 1. commands_user_insert_uuid - UUID-based INSERT policy for commands
-- 2. commands_user_select_uuid - UUID-based SELECT policy for commands
-- 3. pairings_user_select_uuid - UUID-based SELECT policy for pairings
-- 4. user_devices_device_update - UUID-based UPDATE policy for user_devices
-- 5. oauth_tokens_user_select_uuid - UUID-based SELECT policy for user tokens
-- 6. oauth_tokens_device_select_uuid - UUID-based SELECT policy for device tokens
--
-- Function Updated:
-- - user_can_access_device() - Now accepts both serial_number and device_uuid
--
-- Backward Compatibility:
-- - All existing serial_number-based policies remain active
-- - JWT-based policies (app/device token policies) remain unchanged
-- - Both old and new policies can coexist during transition period
--
-- Deprecation Timeline Recommendations:
-- 1. Phase 1 (Current): Both UUID and serial_number policies active
-- 2. Phase 2 (After 30 days): Monitor usage, ensure all code uses UUID
-- 3. Phase 3 (After 60 days): Mark old policies as deprecated in comments
-- 4. Phase 4 (After 90 days): Drop old serial_number-based policies if confirmed unused
--
-- Verification Commands:
-- See end of file for SQL commands to verify policies are working correctly
