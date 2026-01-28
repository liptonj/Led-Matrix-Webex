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

-- Admins can update: display_name, firmware_version, target_firmware_version,
-- debug_enabled, ip_address, last_seen, metadata, is_provisioned
-- Admins CANNOT update: serial_number, device_id, pairing_code, key_hash
CREATE POLICY "devices_admin_update" ON display.devices
    FOR UPDATE
    USING (display.is_admin())
    WITH CHECK (display.is_admin());

-- Enforce immutable columns at the row level (RLS can't compare OLD vs NEW)
CREATE OR REPLACE FUNCTION display.prevent_immutable_device_updates()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow service_role (backend/CI) to bypass immutability checks
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF NEW.key_hash IS DISTINCT FROM OLD.key_hash THEN
        RAISE EXCEPTION 'key_hash is immutable';
    END IF;

    IF NEW.serial_number IS DISTINCT FROM OLD.serial_number THEN
        RAISE EXCEPTION 'serial_number is immutable';
    END IF;

    IF NEW.device_id IS DISTINCT FROM OLD.device_id THEN
        RAISE EXCEPTION 'device_id is immutable';
    END IF;

    IF NEW.pairing_code IS DISTINCT FROM OLD.pairing_code THEN
        RAISE EXCEPTION 'pairing_code is immutable';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS devices_immutable_columns ON display.devices;
CREATE TRIGGER devices_immutable_columns
    BEFORE UPDATE ON display.devices
    FOR EACH ROW
    EXECUTE FUNCTION display.prevent_immutable_device_updates();

COMMENT ON POLICY "devices_admin_update" ON display.devices IS 
    'Allows admins to update safe columns only. Prevents updates to key_hash, serial_number, device_id, and pairing_code.';
