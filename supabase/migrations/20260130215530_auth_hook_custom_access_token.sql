-- Custom Access Token Hook (Postgres Function)
-- This hook runs on login and token refresh to set custom claims in the JWT.
-- Uses Postgres function instead of HTTP endpoint for better performance.
--
-- Documentation: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook

CREATE OR REPLACE FUNCTION display.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = display, public, auth
AS $$
DECLARE
    v_user_id uuid;
    v_is_admin boolean;
    v_disabled boolean;
    v_claims jsonb;
BEGIN
    -- Extract user_id from event
    v_user_id := (event->>'user_id')::uuid;

    -- Check if user is admin (exists in admin_users table)
    SELECT EXISTS (
        SELECT 1
        FROM display.admin_users
        WHERE user_id = v_user_id
    ) INTO v_is_admin;

    -- Check if user is disabled (from user_profiles table)
    SELECT COALESCE(disabled, false)
    INTO v_disabled
    FROM display.user_profiles
    WHERE user_id = v_user_id;

    -- If no profile exists, default to not disabled
    IF v_disabled IS NULL THEN
        v_disabled := false;
    END IF;

    -- Build custom claims
    -- Only grant admin if user is in admin_users AND not disabled
    v_claims := jsonb_build_object(
        'app_metadata', jsonb_build_object(
            'is_admin', v_is_admin AND NOT v_disabled,
            'disabled', v_disabled
        )
    );

    RETURN v_claims;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION display.custom_access_token_hook(jsonb) TO service_role;

COMMENT ON FUNCTION display.custom_access_token_hook IS 'Custom Access Token hook that sets is_admin and disabled claims in JWT tokens';
