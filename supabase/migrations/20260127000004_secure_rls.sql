-- Migration: Secure RLS policies (admin allowlist + least-privilege)
--
-- This migration:
-- 1) Creates display.admin_users allowlist
-- 2) Adds display.is_admin() helper
-- 3) Rewrites RLS policies to prevent key_hash exposure and limit writes
--
-- NOTE: Column-level security is not supported by Postgres RLS. We must ensure
-- application queries never select display.devices.key_hash.

-- =============================================================================
-- Part 1: Admin allowlist
-- =============================================================================

CREATE TABLE IF NOT EXISTS display.admin_users (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE display.admin_users ENABLE ROW LEVEL SECURITY;

-- Only service_role can manage admin list
DROP POLICY IF EXISTS "admin_users_service_role" ON display.admin_users;
CREATE POLICY "admin_users_service_role" ON display.admin_users
    FOR ALL USING (auth.role() = 'service_role');

-- Admins can view admin list (read-only)
DROP POLICY IF EXISTS "admin_users_admin_read" ON display.admin_users;
CREATE POLICY "admin_users_admin_read" ON display.admin_users
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM display.admin_users au WHERE au.user_id = auth.uid())
    );

-- =============================================================================
-- Part 2: Helper function display.is_admin()
-- =============================================================================

CREATE OR REPLACE FUNCTION display.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM display.admin_users WHERE user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION display.is_admin() TO authenticated;

-- =============================================================================
-- Part 3: Rewrite RLS policies
-- =============================================================================

-- -----------------------------------------------------------------------------
-- display.devices
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "devices_service_write" ON display.devices;
DROP POLICY IF EXISTS "devices_admin_write" ON display.devices;
DROP POLICY IF EXISTS "devices_service_full" ON display.devices;
DROP POLICY IF EXISTS "devices_admin_select" ON display.devices;
DROP POLICY IF EXISTS "devices_admin_update" ON display.devices;

-- Service role: full access (Edge Functions/CI)
CREATE POLICY "devices_service_full" ON display.devices
    FOR ALL USING (auth.role() = 'service_role');

-- Admins: row access (application must avoid selecting key_hash)
CREATE POLICY "devices_admin_select" ON display.devices
    FOR SELECT USING (display.is_admin());

CREATE POLICY "devices_admin_update" ON display.devices
    FOR UPDATE USING (display.is_admin());

-- -----------------------------------------------------------------------------
-- display.device_logs
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "logs_admin_read" ON display.device_logs;
DROP POLICY IF EXISTS "logs_service_insert" ON display.device_logs;
DROP POLICY IF EXISTS "logs_service_full" ON display.device_logs;
DROP POLICY IF EXISTS "logs_admin_select" ON display.device_logs;

-- Service role: insert logs (and optionally maintenance)
CREATE POLICY "logs_service_full" ON display.device_logs
    FOR ALL USING (auth.role() = 'service_role');

-- Admins: read logs
CREATE POLICY "logs_admin_select" ON display.device_logs
    FOR SELECT USING (display.is_admin());

-- -----------------------------------------------------------------------------
-- display.releases
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "releases_public_read" ON display.releases;
DROP POLICY IF EXISTS "releases_admin_write" ON display.releases;
DROP POLICY IF EXISTS "releases_public_select" ON display.releases;
DROP POLICY IF EXISTS "releases_admin_insert" ON display.releases;
DROP POLICY IF EXISTS "releases_admin_update" ON display.releases;
DROP POLICY IF EXISTS "releases_admin_delete" ON display.releases;

-- Public read (for version listings); devices still use get-manifest for signed URLs
CREATE POLICY "releases_public_select" ON display.releases
    FOR SELECT USING (true);

-- Admin-only writes
CREATE POLICY "releases_admin_insert" ON display.releases
    FOR INSERT WITH CHECK (display.is_admin());

CREATE POLICY "releases_admin_update" ON display.releases
    FOR UPDATE USING (display.is_admin());

CREATE POLICY "releases_admin_delete" ON display.releases
    FOR DELETE USING (display.is_admin());

-- =============================================================================
-- Documentation
-- =============================================================================

COMMENT ON TABLE display.admin_users IS 'Allowlist of users with admin access to display management';
COMMENT ON FUNCTION display.is_admin() IS 'Returns true if current user has admin access';

