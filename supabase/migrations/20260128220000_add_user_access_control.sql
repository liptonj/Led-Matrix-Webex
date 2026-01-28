-- Migration: Add user profiles + device assignments for per-user access control
--
-- This migration:
-- 1) Creates display.user_profiles to track user roles + email
-- 2) Creates display.user_devices to map users to device serials
-- 3) Adds helper display.user_can_access_device() for RLS
-- 4) Adds RLS policies to allow users to read only their devices/logs/pairings/commands

-- =============================================================================
-- Part 1: User profiles
-- =============================================================================

CREATE TABLE IF NOT EXISTS display.user_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE display.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_profiles_admin_all" ON display.user_profiles;
CREATE POLICY "user_profiles_admin_all" ON display.user_profiles
    FOR ALL USING (display.is_admin()) WITH CHECK (display.is_admin());

DROP POLICY IF EXISTS "user_profiles_self_select" ON display.user_profiles;
CREATE POLICY "user_profiles_self_select" ON display.user_profiles
    FOR SELECT USING (user_id = auth.uid());

COMMENT ON TABLE display.user_profiles IS 'User profile + role metadata for display app';

-- Backfill profiles for existing admins
INSERT INTO display.user_profiles (user_id, email, role, created_at)
SELECT u.id, u.email, 'admin', NOW()
FROM auth.users u
JOIN display.admin_users au ON au.user_id = u.id
ON CONFLICT (user_id) DO NOTHING;

-- =============================================================================
-- Part 2: User/device assignments
-- =============================================================================

CREATE TABLE IF NOT EXISTS display.user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    serial_number TEXT NOT NULL REFERENCES display.devices(serial_number) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE (user_id, serial_number)
);

ALTER TABLE display.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_devices_admin_all" ON display.user_devices;
CREATE POLICY "user_devices_admin_all" ON display.user_devices
    FOR ALL USING (display.is_admin()) WITH CHECK (display.is_admin());

DROP POLICY IF EXISTS "user_devices_self_select" ON display.user_devices;
CREATE POLICY "user_devices_self_select" ON display.user_devices
    FOR SELECT USING (user_id = auth.uid());

COMMENT ON TABLE display.user_devices IS 'Mapping of users to devices they can access';

-- =============================================================================
-- Part 3: Helper function for access checks
-- =============================================================================

CREATE OR REPLACE FUNCTION display.user_can_access_device(target_serial TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF display.is_admin() THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM display.user_devices
        WHERE user_id = auth.uid()
        AND serial_number = target_serial
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION display.user_can_access_device(TEXT) TO authenticated;

COMMENT ON FUNCTION display.user_can_access_device(TEXT) IS 'Returns true if current user can access device serial (admin or assigned)';

-- =============================================================================
-- Part 4: Add user-level read policies
-- =============================================================================

-- Devices: users can read only assigned devices
DROP POLICY IF EXISTS "devices_user_select" ON display.devices;
CREATE POLICY "devices_user_select" ON display.devices
    FOR SELECT USING (display.user_can_access_device(serial_number));

-- Device logs: users can read logs for assigned devices
DROP POLICY IF EXISTS "logs_user_select" ON display.device_logs;
CREATE POLICY "logs_user_select" ON display.device_logs
    FOR SELECT USING (display.user_can_access_device(serial_number));

-- Pairings: users can read pairing state for assigned devices
DROP POLICY IF EXISTS "pairings_user_select" ON display.pairings;
CREATE POLICY "pairings_user_select" ON display.pairings
    FOR SELECT USING (display.user_can_access_device(serial_number));

-- Commands: users can read commands for assigned devices
DROP POLICY IF EXISTS "commands_user_select" ON display.commands;
CREATE POLICY "commands_user_select" ON display.commands
    FOR SELECT USING (display.user_can_access_device(serial_number));
