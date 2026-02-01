-- Fix auth hook to preserve all required claims
-- The custom access token hook must return ALL required claims, not just custom ones
-- Error: "output claims do not conform to the expected schema"
-- 
-- Required claims: aud, exp, iat, sub, email, phone, role, aal, session_id, is_anonymous
-- The hook receives these in event->'claims' and must return them modified

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
    v_original_claims jsonb;
    v_app_metadata jsonb;
BEGIN
    -- Extract user_id from event
    v_user_id := (event->>'user_id')::uuid;
    
    -- Get the original claims from the event - these contain all required fields
    v_original_claims := event->'claims';
    
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

    -- Get existing app_metadata or create empty object
    v_app_metadata := COALESCE(v_original_claims->'app_metadata', '{}'::jsonb);
    
    -- Add our custom claims to app_metadata
    -- Only grant admin if user is in admin_users AND not disabled
    v_app_metadata := v_app_metadata || jsonb_build_object(
        'is_admin', v_is_admin AND NOT v_disabled,
        'disabled', v_disabled
    );
    
    -- Return the original claims with updated app_metadata
    -- This preserves all required claims (aud, exp, iat, sub, email, phone, role, aal, session_id, is_anonymous)
    RETURN jsonb_build_object(
        'claims', v_original_claims || jsonb_build_object('app_metadata', v_app_metadata)
    );
END;
$$;

COMMENT ON FUNCTION display.custom_access_token_hook IS 'Custom Access Token hook that sets is_admin and disabled claims in JWT tokens while preserving all required claims';
