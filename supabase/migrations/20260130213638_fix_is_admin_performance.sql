-- Fix is_admin() performance issue
-- The previous version had potential circular RLS checks

-- Recreate function with explicit security context (no need to drop)
CREATE OR REPLACE FUNCTION display.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = display, auth, public
AS $$
DECLARE
    v_is_admin BOOLEAN;
BEGIN
    -- Service role is always admin
    IF auth.role() = 'service_role' THEN
        RETURN TRUE;
    END IF;

    -- Check admin_users table directly (bypasses RLS due to SECURITY DEFINER)
    -- Only join with user_profiles if we find an admin entry
    SELECT EXISTS (
        SELECT 1
        FROM display.admin_users au
        WHERE au.user_id = auth.uid()
        AND (
            -- Either no profile exists yet (new user)
            NOT EXISTS (SELECT 1 FROM display.user_profiles WHERE user_id = au.user_id)
            -- Or profile exists and is not disabled
            OR EXISTS (SELECT 1 FROM display.user_profiles WHERE user_id = au.user_id AND disabled = FALSE)
        )
    ) INTO v_is_admin;

    RETURN v_is_admin;
END;
$$;

GRANT EXECUTE ON FUNCTION display.is_admin() TO authenticated;

COMMENT ON FUNCTION display.is_admin() IS 'Returns true if current user has admin access (optimized to avoid RLS recursion)';
