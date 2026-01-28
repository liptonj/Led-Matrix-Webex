-- Migration: Add name/disabled fields to user_profiles and tighten access checks

ALTER TABLE display.user_profiles
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT,
    ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Ensure disabled admins are not treated as admins
CREATE OR REPLACE FUNCTION display.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM display.admin_users au
        JOIN display.user_profiles up ON up.user_id = au.user_id
        WHERE au.user_id = auth.uid()
        AND up.disabled = FALSE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION display.is_admin() TO authenticated;

-- Update helper to block disabled users and require profile
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

GRANT EXECUTE ON FUNCTION display.user_can_access_device(TEXT) TO authenticated;
