-- Migration: Restrict admin updates to safe columns only
--
-- This migration adds WITH CHECK constraints to prevent admins from updating
-- sensitive columns like key_hash. Column-level security is not fully supported
-- by Postgres RLS, so we use WITH CHECK to enforce this at the policy level.

-- =============================================================================
-- Restrict admin updates to safe columns only
-- =============================================================================

-- Drop existing admin update policy
DROP POLICY IF EXISTS "devices_admin_update" ON display.devices;

-- Create new policy that prevents updating key_hash
-- Admins can update: display_name, firmware_version, target_firmware_version,
-- debug_enabled, ip_address, last_seen, metadata, is_provisioned
-- Admins CANNOT update: serial_number, device_id, pairing_code, key_hash
CREATE POLICY "devices_admin_update" ON display.devices
    FOR UPDATE 
    USING (display.is_admin())
    WITH CHECK (
        display.is_admin()
        -- Prevent updating key_hash (application should never send this)
        AND (NEW.key_hash IS NULL OR NEW.key_hash = OLD.key_hash)
        -- Prevent updating immutable identifiers
        AND NEW.serial_number = OLD.serial_number
        AND NEW.device_id = OLD.device_id
        AND NEW.pairing_code = OLD.pairing_code
    );

COMMENT ON POLICY "devices_admin_update" ON display.devices IS 
    'Allows admins to update safe columns only. Prevents updates to key_hash, serial_number, device_id, and pairing_code.';
