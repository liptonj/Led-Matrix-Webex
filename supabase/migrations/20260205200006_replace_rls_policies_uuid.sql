-- Migration: Replace RLS policies with UUID-based versions
-- Phase 1: UUID-based device identity architecture
--
-- This migration replaces serial_number-based RLS policies with UUID-based ones.
-- Old policies are dropped and new policies use device_uuid and user_uuid.
--
-- Policies updated:
-- - pairings_user_select: Use device_uuid or user_uuid
-- - commands_user_select: Use device_uuid
-- - user_devices policies: Use device_uuid for lookups
-- - oauth_tokens policies: Use device_uuid for device-scope tokens
--
-- Note: JWT-based policies (app/device token policies) remain unchanged as they
-- use pairing_code, which is still the primary identifier for those flows.

-- =============================================================================
-- Part 1: Update pairings RLS policies
-- =============================================================================

-- Drop old serial_number-based user policy
DROP POLICY IF EXISTS "pairings_user_select" ON display.pairings;

-- Create new UUID-based user policy
-- Users can access pairings if they have access to the device (by UUID) or user_uuid matches
CREATE POLICY "pairings_user_select" ON display.pairings
  FOR SELECT USING (
    display.is_admin()
    OR display.user_can_access_device(device_uuid)
    OR (user_uuid IS NOT NULL AND user_uuid = auth.uid())
  );

COMMENT ON POLICY "pairings_user_select" ON display.pairings IS 
  'Users can read pairings for devices they have access to (by device_uuid) or their own pairings (by user_uuid)';

-- =============================================================================
-- Part 2: Update commands RLS policies
-- =============================================================================

-- Drop old serial_number-based user policy
DROP POLICY IF EXISTS "commands_user_select" ON display.commands;

-- Create new UUID-based user policy
CREATE POLICY "commands_user_select" ON display.commands
  FOR SELECT USING (
    display.is_admin()
    OR display.user_can_access_device(device_uuid)
  );

COMMENT ON POLICY "commands_user_select" ON display.commands IS 
  'Users can read commands for devices they have access to (by device_uuid)';

-- =============================================================================
-- Part 3: Update user_devices RLS policies
-- =============================================================================

-- Note: user_devices policies primarily use user_id, but we ensure device_uuid
-- is properly indexed for reverse lookups. The existing policies remain valid.

-- Add comment documenting UUID support
COMMENT ON COLUMN display.user_devices.device_uuid IS 
  'UUID reference to devices.id. Used for efficient UUID-based RLS checks.';

-- =============================================================================
-- Part 4: Update oauth_tokens RLS policies
-- =============================================================================

-- Drop old serial_number-based device policies
DROP POLICY IF EXISTS "oauth_tokens_device_select" ON display.oauth_tokens;
DROP POLICY IF EXISTS "oauth_tokens_device_insert" ON display.oauth_tokens;
DROP POLICY IF EXISTS "oauth_tokens_device_update" ON display.oauth_tokens;
DROP POLICY IF EXISTS "oauth_tokens_device_delete" ON display.oauth_tokens;

-- Create new UUID-based device policies
-- These policies check device_uuid from JWT claims (when available) or fall back to pairing_code
CREATE POLICY "oauth_tokens_device_select" ON display.oauth_tokens
  FOR SELECT USING (
    display.is_admin()
    OR (token_scope = 'user' AND user_id = auth.uid())
    OR (
      token_scope = 'device'
      AND (
        -- UUID-based check (preferred)
        (auth.jwt() ->> 'device_uuid') IS NOT NULL 
        AND device_uuid::TEXT = (auth.jwt() ->> 'device_uuid')
        -- Fallback to pairing_code for backward compatibility
        OR (auth.jwt() ->> 'pairing_code') IS NOT NULL 
        AND pairing_code = (auth.jwt() ->> 'pairing_code')
      )
    )
  );

CREATE POLICY "oauth_tokens_device_insert" ON display.oauth_tokens
  FOR INSERT WITH CHECK (
    display.is_admin()
    OR (
      token_scope = 'device'
      AND (
        (auth.jwt() ->> 'device_uuid') IS NOT NULL 
        AND device_uuid::TEXT = (auth.jwt() ->> 'device_uuid')
        OR (auth.jwt() ->> 'pairing_code') IS NOT NULL 
        AND pairing_code = (auth.jwt() ->> 'pairing_code')
      )
    )
  );

CREATE POLICY "oauth_tokens_device_update" ON display.oauth_tokens
  FOR UPDATE USING (
    display.is_admin()
    OR (
      token_scope = 'device'
      AND (
        (auth.jwt() ->> 'device_uuid') IS NOT NULL 
        AND device_uuid::TEXT = (auth.jwt() ->> 'device_uuid')
        OR (auth.jwt() ->> 'pairing_code') IS NOT NULL 
        AND pairing_code = (auth.jwt() ->> 'pairing_code')
      )
    )
  )
  WITH CHECK (
    display.is_admin()
    OR (
      token_scope = 'device'
      AND (
        (auth.jwt() ->> 'device_uuid') IS NOT NULL 
        AND device_uuid::TEXT = (auth.jwt() ->> 'device_uuid')
        OR (auth.jwt() ->> 'pairing_code') IS NOT NULL 
        AND pairing_code = (auth.jwt() ->> 'pairing_code')
      )
    )
  );

CREATE POLICY "oauth_tokens_device_delete" ON display.oauth_tokens
  FOR DELETE USING (
    display.is_admin()
    OR (
      token_scope = 'device'
      AND (
        (auth.jwt() ->> 'device_uuid') IS NOT NULL 
        AND device_uuid::TEXT = (auth.jwt() ->> 'device_uuid')
        OR (auth.jwt() ->> 'pairing_code') IS NOT NULL 
        AND pairing_code = (auth.jwt() ->> 'pairing_code')
      )
    )
  );

COMMENT ON POLICY "oauth_tokens_device_select" ON display.oauth_tokens IS 
  'Device-scope tokens: access by device_uuid (preferred) or pairing_code (fallback). User-scope tokens: by user_id.';
COMMENT ON POLICY "oauth_tokens_device_insert" ON display.oauth_tokens IS 
  'Devices can insert their own tokens using device_uuid or pairing_code from JWT.';
COMMENT ON POLICY "oauth_tokens_device_update" ON display.oauth_tokens IS 
  'Devices can update their own tokens using device_uuid or pairing_code from JWT.';
COMMENT ON POLICY "oauth_tokens_device_delete" ON display.oauth_tokens IS 
  'Devices can delete their own tokens using device_uuid or pairing_code from JWT.';
