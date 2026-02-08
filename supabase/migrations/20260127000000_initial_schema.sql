


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE SCHEMA IF NOT EXISTS "display";


ALTER SCHEMA "display" OWNER TO "postgres";


COMMENT ON SCHEMA "display" IS 'Display schema with UUID-based device identity architecture. RLS policies support both legacy serial_number and new UUID-based lookups.';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "display"."broadcast_commands_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  topic text;
begin
  topic := 'pairing:' || coalesce(new.pairing_code, old.pairing_code) || ':events';
  perform realtime.broadcast_changes(
    topic,
    'command_changed',
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old,
    'ROW'
  );
  return new;
end;
$$;


ALTER FUNCTION "display"."broadcast_commands_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "display"."check_connection_timeouts"("timeout_seconds" integer DEFAULT 60) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    updated_count INTEGER := 0;
    device_updated INTEGER;
    app_updated INTEGER;
BEGIN
    -- Mark devices as disconnected if no heartbeat within timeout
    UPDATE display.pairings
    SET device_connected = FALSE
    WHERE device_connected = TRUE
    AND device_last_seen < NOW() - (timeout_seconds || ' seconds')::INTERVAL;
    GET DIAGNOSTICS device_updated = ROW_COUNT;
    
    -- Mark apps as disconnected if no heartbeat within timeout
    UPDATE display.pairings
    SET app_connected = FALSE
    WHERE app_connected = TRUE
    AND app_last_seen < NOW() - (timeout_seconds || ' seconds')::INTERVAL;
    GET DIAGNOSTICS app_updated = ROW_COUNT;
    
    updated_count := device_updated + app_updated;
    
    IF updated_count > 0 THEN
        RAISE NOTICE 'Connection timeout: % devices, % apps marked disconnected', 
            device_updated, app_updated;
    END IF;
    
    RETURN updated_count;
END;
$$;


ALTER FUNCTION "display"."check_connection_timeouts"("timeout_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "display"."check_connection_timeouts"("timeout_seconds" integer) IS 'Marks connections as disconnected if no heartbeat within timeout seconds';



CREATE OR REPLACE FUNCTION "display"."check_rate_limit"("rate_key" "text", "max_requests" integer DEFAULT 12, "window_seconds" integer DEFAULT 60) RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    current_count INTEGER;
    window_started TIMESTAMPTZ;
BEGIN
    -- Get or create rate limit entry
    INSERT INTO display.rate_limits (key, request_count, window_start, updated_at)
    VALUES (rate_key, 1, NOW(), NOW())
    ON CONFLICT (key) DO UPDATE
    SET 
        -- Reset if window expired, otherwise increment
        request_count = CASE 
            WHEN display.rate_limits.window_start < NOW() - (window_seconds || ' seconds')::INTERVAL 
            THEN 1 
            ELSE display.rate_limits.request_count + 1 
        END,
        window_start = CASE 
            WHEN display.rate_limits.window_start < NOW() - (window_seconds || ' seconds')::INTERVAL 
            THEN NOW() 
            ELSE display.rate_limits.window_start 
        END,
        updated_at = NOW()
    RETURNING request_count, window_start INTO current_count, window_started;
    
    -- Allow if under limit
    RETURN current_count <= max_requests;
END;
$$;


ALTER FUNCTION "display"."check_rate_limit"("rate_key" "text", "max_requests" integer, "window_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "display"."check_rate_limit"("rate_key" "text", "max_requests" integer, "window_seconds" integer) IS 'Returns TRUE if request allowed, FALSE if rate limited';



CREATE OR REPLACE FUNCTION "display"."cleanup_old_commands"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    expired_count INTEGER;
    deleted_count INTEGER;
    total_affected INTEGER;
BEGIN
    -- Mark pending commands as expired if past expiry
    UPDATE display.commands 
    SET status = 'expired' 
    WHERE status = 'pending' AND expires_at < NOW();
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    
    -- Delete completed commands older than 24 hours
    DELETE FROM display.commands 
    WHERE created_at < NOW() - INTERVAL '24 hours'
    AND status IN ('acked', 'failed', 'expired');
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    total_affected := expired_count + deleted_count;
    
    -- Log cleanup action
    IF total_affected > 0 THEN
        RAISE NOTICE 'Command cleanup: % expired, % deleted', expired_count, deleted_count;
    END IF;
    
    RETURN total_affected;
END;
$$;


ALTER FUNCTION "display"."cleanup_old_commands"() OWNER TO "postgres";


COMMENT ON FUNCTION "display"."cleanup_old_commands"() IS 'Marks expired pending commands and deletes old completed ones';



CREATE OR REPLACE FUNCTION "display"."cleanup_old_logs"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    DELETE FROM display.device_logs 
    WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;


ALTER FUNCTION "display"."cleanup_old_logs"() OWNER TO "postgres";


COMMENT ON FUNCTION "display"."cleanup_old_logs"() IS 'Deletes device logs older than 30 days. Runs daily via pg_cron.';



CREATE OR REPLACE FUNCTION "display"."cleanup_rate_limits"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete entries older than 2 minutes (rate window is 1 minute)
    DELETE FROM display.rate_limits 
    WHERE updated_at < NOW() - INTERVAL '2 minutes';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;


ALTER FUNCTION "display"."cleanup_rate_limits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "display"."cleanup_stale_sessions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'display', 'public'
    AS $$
declare
  closed_count integer;
begin
  update display.support_sessions
  set status = 'closed',
      closed_at = now(),
      close_reason = 'stale_cleanup'
  where status in ('waiting', 'active')
    and created_at < now() - interval '24 hours';

  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;


ALTER FUNCTION "display"."cleanup_stale_sessions"() OWNER TO "postgres";


COMMENT ON FUNCTION "display"."cleanup_stale_sessions"() IS 'Closes support sessions older than 24 hours. Safety net for orphaned sessions where the user closed their browser without ending the session.';



CREATE OR REPLACE FUNCTION "display"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'display', 'public', 'auth'
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


ALTER FUNCTION "display"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "display"."custom_access_token_hook"("event" "jsonb") IS 'Custom Access Token hook that sets is_admin and disabled claims in JWT tokens while preserving all required claims';



CREATE OR REPLACE FUNCTION "display"."ensure_single_latest"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.is_latest = TRUE THEN
        UPDATE display.releases
        SET is_latest = FALSE
        WHERE id != NEW.id
          AND is_latest = TRUE
          AND release_channel = NEW.release_channel;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "display"."ensure_single_latest"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "display"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'display', 'auth', 'public'
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


ALTER FUNCTION "display"."is_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "display"."is_admin"() IS 'Returns true if current user has admin access (optimized to avoid RLS recursion)';



CREATE OR REPLACE FUNCTION "display"."pairings_presence_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'display'
    AS $$
BEGIN
    -- Update app_last_seen and app_connected in pairings table
    NEW.app_last_seen = NOW();
    NEW.app_connected = TRUE;
    
    -- Only upsert into connection_heartbeats if device_uuid is available
    IF NEW.device_uuid IS NOT NULL THEN
        INSERT INTO display.connection_heartbeats (
            device_uuid,
            pairing_code,
            app_last_seen,
            app_connected
        )
        VALUES (
            NEW.device_uuid,
            NEW.pairing_code,
            NOW(),
            TRUE
        )
        ON CONFLICT (device_uuid) 
        DO UPDATE SET
            pairing_code = COALESCE(EXCLUDED.pairing_code, connection_heartbeats.pairing_code),
            app_last_seen = EXCLUDED.app_last_seen,
            app_connected = EXCLUDED.app_connected,
            updated_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "display"."pairings_presence_trigger"() OWNER TO "postgres";


COMMENT ON FUNCTION "display"."pairings_presence_trigger"() IS 'SECURITY DEFINER: Automatically updates app_last_seen/app_connected in pairings table and upserts into connection_heartbeats (bypassing RLS) whenever pairings table is updated.';



CREATE OR REPLACE FUNCTION "display"."prevent_immutable_device_updates"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "display"."prevent_immutable_device_updates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "display"."set_latest_release"("target_version" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Clear all existing latest flags first
    UPDATE display.releases SET is_latest = FALSE WHERE is_latest = TRUE;
    
    -- Set the new latest
    UPDATE display.releases SET is_latest = TRUE WHERE version = target_version;
    
    -- Verify the update happened (raises an exception if no rows matched)
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Release version % not found', target_version;
    END IF;
END;
$$;


ALTER FUNCTION "display"."set_latest_release"("target_version" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "display"."set_latest_release"("target_version" "text", "target_channel" "text" DEFAULT 'production'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Clear is_latest for the same channel only
  UPDATE display.releases 
    SET is_latest = FALSE 
    WHERE is_latest = TRUE AND release_channel = target_channel;
  
  -- Set new latest for this channel
  UPDATE display.releases 
    SET is_latest = TRUE 
    WHERE version = target_version AND release_channel = target_channel;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Release version % in channel % not found', target_version, target_channel;
  END IF;
END;
$$;


ALTER FUNCTION "display"."set_latest_release"("target_version" "text", "target_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "display"."status_values_changed"("p_pairing_code" "text", "p_webex_status" "text" DEFAULT NULL::"text", "p_camera_on" boolean DEFAULT NULL::boolean, "p_mic_muted" boolean DEFAULT NULL::boolean, "p_in_call" boolean DEFAULT NULL::boolean, "p_display_name" "text" DEFAULT NULL::"text", "p_app_connected" boolean DEFAULT NULL::boolean) RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
    current_record display.pairings%ROWTYPE;
    has_changes BOOLEAN := FALSE;
BEGIN
    SELECT * INTO current_record
    FROM display.pairings
    WHERE pairing_code = p_pairing_code;

    IF NOT FOUND THEN
        RETURN TRUE;
    END IF;

    IF p_app_connected IS NOT NULL AND
       p_app_connected IS DISTINCT FROM COALESCE(current_record.app_connected, FALSE) THEN
        has_changes := TRUE;
    END IF;

    IF p_webex_status IS NOT NULL AND
       COALESCE(p_webex_status, '') IS DISTINCT FROM COALESCE(current_record.webex_status, '') THEN
        has_changes := TRUE;
    END IF;

    IF p_camera_on IS NOT NULL AND
       p_camera_on IS DISTINCT FROM COALESCE(current_record.camera_on, FALSE) THEN
        has_changes := TRUE;
    END IF;

    IF p_mic_muted IS NOT NULL AND
       p_mic_muted IS DISTINCT FROM COALESCE(current_record.mic_muted, FALSE) THEN
        has_changes := TRUE;
    END IF;

    IF p_in_call IS NOT NULL AND
       p_in_call IS DISTINCT FROM COALESCE(current_record.in_call, FALSE) THEN
        has_changes := TRUE;
    END IF;

    IF p_display_name IS NOT NULL AND
       COALESCE(p_display_name, '') IS DISTINCT FROM COALESCE(current_record.display_name, '') THEN
        has_changes := TRUE;
    END IF;

    RETURN has_changes;
END;
$$;


ALTER FUNCTION "display"."status_values_changed"("p_pairing_code" "text", "p_webex_status" "text", "p_camera_on" boolean, "p_mic_muted" boolean, "p_in_call" boolean, "p_display_name" "text", "p_app_connected" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "display"."status_values_changed"("p_pairing_code" "text", "p_webex_status" "text", "p_camera_on" boolean, "p_mic_muted" boolean, "p_in_call" boolean, "p_display_name" "text", "p_app_connected" boolean) IS 'Returns TRUE if the provided status values differ from current values in the pairings table.
Used by Edge Functions to avoid unnecessary database updates that would trigger realtime notifications.

Parameter behavior:
- NULL (default): Field is not being updated, skip comparison
- FALSE: Field is being set to FALSE, compare against current value
- TRUE: Field is being set to TRUE, compare against current value

Note: device_connected is NOT included because this function is called by the embedded app,
which cannot change the device connection state.';



CREATE OR REPLACE FUNCTION "display"."update_release_artifacts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "display"."update_release_artifacts_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "display"."update_status_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF (
        COALESCE(NEW.webex_status, '') IS DISTINCT FROM COALESCE(OLD.webex_status, '') OR
        COALESCE(NEW.camera_on, FALSE) IS DISTINCT FROM COALESCE(OLD.camera_on, FALSE) OR
        COALESCE(NEW.mic_muted, FALSE) IS DISTINCT FROM COALESCE(OLD.mic_muted, FALSE) OR
        COALESCE(NEW.in_call, FALSE) IS DISTINCT FROM COALESCE(OLD.in_call, FALSE) OR
        COALESCE(NEW.display_name, '') IS DISTINCT FROM COALESCE(OLD.display_name, '') OR
        COALESCE(NEW.device_connected, FALSE) IS DISTINCT FROM COALESCE(OLD.device_connected, FALSE) OR
        COALESCE(NEW.app_connected, FALSE) IS DISTINCT FROM COALESCE(OLD.app_connected, FALSE)
    ) THEN
        NEW.status_updated_at = NOW();
    ELSE
        NEW.status_updated_at = OLD.status_updated_at;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "display"."update_status_timestamp"() OWNER TO "postgres";


COMMENT ON FUNCTION "display"."update_status_timestamp"() IS 'Updates status_updated_at only when status-relevant fields change, preventing heartbeat-only updates from triggering realtime notifications.';



CREATE OR REPLACE FUNCTION "display"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "display"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "display"."user_can_access_device"("target_serial" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "display"."user_can_access_device"("target_serial" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "display"."user_can_access_device"("target_serial" "text") IS 'Returns true if current user can access device by serial_number (admin or assigned). Legacy function - maintained for backward compatibility.';



CREATE OR REPLACE FUNCTION "display"."user_can_access_device"("target_device_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "display"."user_can_access_device"("target_device_uuid" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "display"."user_can_access_device"("target_device_uuid" "uuid") IS 'Returns true if current user can access device by device_uuid (admin or assigned). UUID-based lookup for Phase 1 migration.';



CREATE OR REPLACE FUNCTION "display"."vault_create_secret"("p_name" "text", "p_secret" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'display', 'vault', 'pg_temp'
    AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  -- Call vault.create_secret and return the UUID
  SELECT vault.create_secret(p_secret, p_name) INTO v_secret_id;
  RETURN v_secret_id;
END;
$$;


ALTER FUNCTION "display"."vault_create_secret"("p_name" "text", "p_secret" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "display"."vault_find_secret_by_name"("p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'vault', 'display'
    AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT id INTO v_secret_id
  FROM vault.secrets
  WHERE name = p_name;
  
  RETURN v_secret_id;
END;
$$;


ALTER FUNCTION "display"."vault_find_secret_by_name"("p_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "display"."vault_find_secret_by_name"("p_name" "text") IS 'Finds a vault secret by name and returns its UUID. Returns NULL if not found.';



CREATE OR REPLACE FUNCTION "display"."vault_read_secret"("p_secret_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'display', 'vault', 'pg_temp'
    AS $$
DECLARE
  v_secret TEXT;
BEGIN
  -- Retrieve the decrypted secret from vault.decrypted_secrets view
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = p_secret_id;

  RETURN v_secret;
END;
$$;


ALTER FUNCTION "display"."vault_read_secret"("p_secret_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "display"."vault_update_secret"("p_secret_id" "uuid", "p_secret" "text", "p_name" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_key_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'display', 'vault', 'pg_temp'
    AS $$
BEGIN
  PERFORM vault.update_secret(
    p_secret_id,
    p_secret,
    p_name,
    p_description,
    p_key_id
  );
END;
$$;


ALTER FUNCTION "display"."vault_update_secret"("p_secret_id" "uuid", "p_secret" "text", "p_name" "text", "p_description" "text", "p_key_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."display_check_rate_limit"("rate_key" "text", "max_requests" integer DEFAULT 12, "window_seconds" integer DEFAULT 60) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN display.check_rate_limit(rate_key, max_requests, window_seconds);
END;
$$;


ALTER FUNCTION "public"."display_check_rate_limit"("rate_key" "text", "max_requests" integer, "window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."display_commands_broadcast_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  code text;
BEGIN
  code := COALESCE(NEW.pairing_code, OLD.pairing_code);
  IF code IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM realtime.broadcast_changes(
    'pairing:' || code || ':events',
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."display_commands_broadcast_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."display_firmware_updates_broadcast_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  code text;
BEGIN
  code := COALESCE(NEW.pairing_code, OLD.pairing_code);
  IF code IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM realtime.broadcast_changes(
    'pairing:' || code || ':events',
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."display_firmware_updates_broadcast_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."display_heartbeats_broadcast_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  PERFORM realtime.broadcast_changes(
    'pairing:' || NEW.pairing_code || ':events',
    TG_OP,
    'heartbeat',
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    NULL
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."display_heartbeats_broadcast_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_latest_release"("target_version" "text", "target_channel" "text" DEFAULT 'production'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Delegate to the display schema function
  PERFORM display.set_latest_release(target_version, target_channel);
END;
$$;


ALTER FUNCTION "public"."set_latest_release"("target_version" "text", "target_channel" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_latest_release"("target_version" "text", "target_channel" "text") IS 'Wrapper for display.set_latest_release - sets the latest release for a channel';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "display"."admin_users" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "display"."admin_users" OWNER TO "postgres";


COMMENT ON TABLE "display"."admin_users" IS 'Allowlist of users with admin access to display management';



CREATE TABLE IF NOT EXISTS "display"."commands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pairing_code" "text" NOT NULL,
    "serial_number" "text" NOT NULL,
    "command" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "acked_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval),
    "response" "jsonb",
    "error" "text",
    "device_uuid" "uuid",
    CONSTRAINT "commands_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'acked'::"text", 'failed'::"text", 'expired'::"text"])))
);


ALTER TABLE "display"."commands" OWNER TO "postgres";


COMMENT ON TABLE "display"."commands" IS 'Durable command queue - app inserts commands, device polls and acks';



COMMENT ON COLUMN "display"."commands"."status" IS 'pending=waiting for device, acked=completed, failed=device reported error, expired=timed out';



COMMENT ON COLUMN "display"."commands"."expires_at" IS 'Commands expire after 5 minutes by default';



COMMENT ON COLUMN "display"."commands"."device_uuid" IS 'UUID reference to devices.id. Replaces serial_number for UUID-based lookups.';



CREATE TABLE IF NOT EXISTS "display"."connection_heartbeats" (
    "pairing_code" "text",
    "app_last_seen" timestamp with time zone,
    "app_connected" boolean DEFAULT false,
    "device_last_seen" timestamp with time zone,
    "device_connected" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "device_uuid" "uuid" NOT NULL
);


ALTER TABLE "display"."connection_heartbeats" OWNER TO "postgres";


COMMENT ON TABLE "display"."connection_heartbeats" IS 'Tracks app/device connection state separately from status. Updates to this table do NOT trigger realtime notifications to devices.';



COMMENT ON COLUMN "display"."connection_heartbeats"."device_uuid" IS 'UUID reference to devices.id. Used for UUID-based device lookups.';



CREATE TABLE IF NOT EXISTS "display"."device_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "device_id" "text" NOT NULL,
    "level" "text" NOT NULL,
    "message" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "serial_number" "text",
    CONSTRAINT "device_logs_level_check" CHECK (("level" = ANY (ARRAY['debug'::"text", 'info'::"text", 'warn'::"text", 'error'::"text"])))
);


ALTER TABLE "display"."device_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "display"."devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "serial_number" "text" NOT NULL,
    "device_id" "text" NOT NULL,
    "pairing_code" "text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "display_name" "text",
    "firmware_version" "text",
    "target_firmware_version" "text",
    "ip_address" "inet",
    "last_seen" timestamp with time zone DEFAULT "now"(),
    "last_auth_timestamp" bigint,
    "debug_enabled" boolean DEFAULT false,
    "is_provisioned" boolean DEFAULT false,
    "registered_at" timestamp with time zone DEFAULT "now"(),
    "provisioned_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "approval_required" boolean DEFAULT false,
    "disabled" boolean DEFAULT false,
    "blacklisted" boolean DEFAULT false,
    "user_approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "release_channel" "text" DEFAULT 'production'::"text" NOT NULL,
    CONSTRAINT "devices_release_channel_check" CHECK (("release_channel" = ANY (ARRAY['beta'::"text", 'production'::"text"])))
);


ALTER TABLE "display"."devices" OWNER TO "postgres";


COMMENT ON COLUMN "display"."devices"."user_approved_by" IS 'User who authorized this device (NULL = not approved yet)';



COMMENT ON COLUMN "display"."devices"."approved_at" IS 'When device was approved by user';



CREATE TABLE IF NOT EXISTS "display"."oauth_clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "client_secret_id" "uuid" NOT NULL,
    "redirect_uri" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "purpose" "text" DEFAULT 'device'::"text"
);


ALTER TABLE "display"."oauth_clients" OWNER TO "postgres";


COMMENT ON TABLE "display"."oauth_clients" IS 'OAuth client metadata; secrets stored in vault.secrets';



CREATE TABLE IF NOT EXISTS "display"."oauth_state" (
    "state_key" "text" NOT NULL,
    "code_verifier" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "display"."oauth_state" OWNER TO "postgres";


COMMENT ON TABLE "display"."oauth_state" IS 'Temporary storage for OAuth PKCE state (auto-cleaned)';



COMMENT ON COLUMN "display"."oauth_state"."state_key" IS 'OAuth state parameter (PKCE)';



COMMENT ON COLUMN "display"."oauth_state"."code_verifier" IS 'PKCE code verifier (hashed to create challenge)';



COMMENT ON COLUMN "display"."oauth_state"."expires_at" IS 'When this state expires (typically 10 minutes)';



CREATE TABLE IF NOT EXISTS "display"."oauth_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "serial_number" "text",
    "pairing_code" "text",
    "access_token_id" "uuid" NOT NULL,
    "refresh_token_id" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "device_uuid" "uuid",
    "user_id" "uuid",
    "token_scope" "text" DEFAULT 'device'::"text" NOT NULL,
    CONSTRAINT "oauth_tokens_scope_check" CHECK (((("token_scope" = 'device'::"text") AND ("serial_number" IS NOT NULL)) OR (("token_scope" = 'user'::"text") AND ("user_id" IS NOT NULL)))),
    CONSTRAINT "oauth_tokens_token_scope_check" CHECK (("token_scope" = ANY (ARRAY['device'::"text", 'user'::"text"])))
);


ALTER TABLE "display"."oauth_tokens" OWNER TO "postgres";


COMMENT ON TABLE "display"."oauth_tokens" IS 'OAuth tokens stored in vault.secrets; this table stores references';



COMMENT ON COLUMN "display"."oauth_tokens"."device_uuid" IS 'UUID reference to devices.id for device-scope tokens. NULL for user-scope tokens.';



COMMENT ON COLUMN "display"."oauth_tokens"."user_id" IS 'User ID for user-scope tokens. NULL for device-scope tokens.';



COMMENT ON COLUMN "display"."oauth_tokens"."token_scope" IS 'Scope of token: "device" for device-specific tokens, "user" for user-level tokens';



CREATE TABLE IF NOT EXISTS "display"."pairings" (
    "pairing_code" "text" NOT NULL,
    "serial_number" "text" NOT NULL,
    "device_id" "text",
    "app_last_seen" timestamp with time zone,
    "device_last_seen" timestamp with time zone,
    "app_connected" boolean DEFAULT false,
    "device_connected" boolean DEFAULT false,
    "webex_status" "text" DEFAULT 'offline'::"text",
    "camera_on" boolean DEFAULT false,
    "mic_muted" boolean DEFAULT false,
    "in_call" boolean DEFAULT false,
    "display_name" "text",
    "rssi" integer,
    "free_heap" integer,
    "uptime" integer,
    "temperature" real,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "firmware_version" "text",
    "ssid" "text",
    "ota_partition" "text",
    "status_updated_at" timestamp with time zone DEFAULT "now"(),
    "device_uuid" "uuid",
    "user_uuid" "uuid"
);


ALTER TABLE "display"."pairings" OWNER TO "postgres";


COMMENT ON TABLE "display"."pairings" IS 'Live state cache for pairing sessions - both app and device sync here';



COMMENT ON COLUMN "display"."pairings"."app_last_seen" IS 'DEPRECATED: Use connection_heartbeats.app_last_seen instead. Kept for backwards compatibility.';



COMMENT ON COLUMN "display"."pairings"."device_last_seen" IS 'DEPRECATED: Use connection_heartbeats.device_last_seen instead. Kept for backwards compatibility.';



COMMENT ON COLUMN "display"."pairings"."app_connected" IS 'App connection state. Updated via Edge Functions. Note: For heartbeat tracking, use connection_heartbeats table to avoid triggering realtime.';



COMMENT ON COLUMN "display"."pairings"."device_connected" IS 'Device connection state. Note: For heartbeat tracking, use connection_heartbeats table to avoid triggering realtime.';



COMMENT ON COLUMN "display"."pairings"."webex_status" IS 'Webex presence status: offline, active, dnd, away, meeting';



COMMENT ON COLUMN "display"."pairings"."config" IS 'Device configuration snapshot for realtime config updates';



COMMENT ON COLUMN "display"."pairings"."firmware_version" IS 'Firmware version reported by device';



COMMENT ON COLUMN "display"."pairings"."ssid" IS 'WiFi SSID reported by device';



COMMENT ON COLUMN "display"."pairings"."ota_partition" IS 'Running OTA partition label reported by device';



COMMENT ON COLUMN "display"."pairings"."status_updated_at" IS 'Timestamp when status-relevant fields last changed (webex_status, camera_on, mic_muted, in_call, display_name). Used for realtime filtering.';



COMMENT ON COLUMN "display"."pairings"."device_uuid" IS 'UUID reference to devices.id. Replaces serial_number for UUID-based lookups.';



COMMENT ON COLUMN "display"."pairings"."user_uuid" IS 'UUID reference to auth.users.id for the user who owns this pairing session. Backfilled from user_devices based on serial_number. NULL if no user is assigned to the device.';



CREATE TABLE IF NOT EXISTS "display"."provision_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:30:00'::interval) NOT NULL,
    CONSTRAINT "token_format" CHECK (("char_length"("token") = 32))
);


ALTER TABLE "display"."provision_tokens" OWNER TO "postgres";


COMMENT ON TABLE "display"."provision_tokens" IS 'Temporary tokens for auto-provisioning devices via ESP Web Tools. Single-use, deleted after consumption.';



CREATE TABLE IF NOT EXISTS "display"."rate_limits" (
    "key" "text" NOT NULL,
    "request_count" integer DEFAULT 1,
    "window_start" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "display"."rate_limits" OWNER TO "postgres";


COMMENT ON TABLE "display"."rate_limits" IS 'Rate limiting state for Edge Functions';



CREATE TABLE IF NOT EXISTS "display"."release_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "release_id" "uuid" NOT NULL,
    "board_type" "text" NOT NULL,
    "chip_family" "text" NOT NULL,
    "firmware_url" "text" NOT NULL,
    "firmware_merged_url" "text",
    "firmware_size" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "display"."release_artifacts" OWNER TO "postgres";


COMMENT ON TABLE "display"."release_artifacts" IS 'Stores firmware binaries for each board type per release version. Enables multi-board support without schema changes.';



COMMENT ON COLUMN "display"."release_artifacts"."board_type" IS 'Normalized board identifier without hyphens (e.g., esp32s3, esp32s2)';



COMMENT ON COLUMN "display"."release_artifacts"."chip_family" IS 'Chip family name for ESP Web Tools manifest (e.g., ESP32-S3, ESP32-S2)';



COMMENT ON COLUMN "display"."release_artifacts"."firmware_url" IS 'URL to OTA firmware binary (firmware-{board}.bin)';



COMMENT ON COLUMN "display"."release_artifacts"."firmware_merged_url" IS 'URL to merged binary for web installer (firmware-merged-{board}.bin)';



CREATE TABLE IF NOT EXISTS "display"."releases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "version" "text" NOT NULL,
    "tag" "text" NOT NULL,
    "name" "text",
    "notes" "text",
    "firmware_url" "text" NOT NULL,
    "firmware_merged_url" "text",
    "firmware_size" integer,
    "build_id" "text",
    "build_date" timestamp with time zone,
    "is_latest" boolean DEFAULT false,
    "is_prerelease" boolean DEFAULT false,
    "rollout_percentage" integer DEFAULT 100,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "release_channel" "text" DEFAULT 'beta'::"text" NOT NULL,
    CONSTRAINT "releases_release_channel_check" CHECK (("release_channel" = ANY (ARRAY['beta'::"text", 'production'::"text"]))),
    CONSTRAINT "releases_rollout_percentage_check" CHECK ((("rollout_percentage" >= 0) AND ("rollout_percentage" <= 100)))
);


ALTER TABLE "display"."releases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "display"."support_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "admin_id" "uuid",
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "device_serial" "text",
    "device_chip" "text",
    "device_firmware" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "joined_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "close_reason" "text",
    CONSTRAINT "support_sessions_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'active'::"text", 'closed'::"text"])))
);


ALTER TABLE "display"."support_sessions" OWNER TO "postgres";


COMMENT ON TABLE "display"."support_sessions" IS 'Remote support sessions for interactive serial console access. Users create sessions by connecting devices via USB, admins join to get remote serial access.';



CREATE TABLE IF NOT EXISTS "display"."user_devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "serial_number" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "provisioning_method" "text",
    "provisioned_at" timestamp with time zone DEFAULT "now"(),
    "device_uuid" "uuid",
    "webex_polling_enabled" boolean DEFAULT false NOT NULL
);


ALTER TABLE "display"."user_devices" OWNER TO "postgres";


COMMENT ON TABLE "display"."user_devices" IS 'Mapping of users to devices they can access';



COMMENT ON COLUMN "display"."user_devices"."provisioning_method" IS 'How device was provisioned: user_approved, web_flash, etc';



COMMENT ON COLUMN "display"."user_devices"."provisioned_at" IS 'When device was provisioned to this user';



COMMENT ON COLUMN "display"."user_devices"."device_uuid" IS 'UUID reference to devices.id. Replaces serial_number for UUID-based lookups.';



COMMENT ON COLUMN "display"."user_devices"."webex_polling_enabled" IS 'When true, webex-status-sweep will poll Webex status for this device using the owner user token';



CREATE TABLE IF NOT EXISTS "display"."user_profiles" (
    "user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "first_name" "text",
    "last_name" "text",
    "disabled" boolean DEFAULT false NOT NULL,
    "webex_user_id" "text",
    "webex_email" "text",
    "avatar_url" "text",
    "display_name" "text",
    "auth_provider" "text" DEFAULT 'email'::"text",
    CONSTRAINT "user_profiles_auth_provider_check" CHECK (("auth_provider" = ANY (ARRAY['email'::"text", 'webex'::"text"]))),
    CONSTRAINT "user_profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'user'::"text"])))
);


ALTER TABLE "display"."user_profiles" OWNER TO "postgres";


COMMENT ON TABLE "display"."user_profiles" IS 'User profile + role metadata for display app';



COMMENT ON COLUMN "display"."user_profiles"."webex_user_id" IS 'Webex user ID from OAuth (sub claim)';



COMMENT ON COLUMN "display"."user_profiles"."webex_email" IS 'Email from Webex OAuth profile';



COMMENT ON COLUMN "display"."user_profiles"."avatar_url" IS 'Avatar URL from Webex OAuth profile';



COMMENT ON COLUMN "display"."user_profiles"."display_name" IS 'Display name from Webex OAuth profile';



COMMENT ON COLUMN "display"."user_profiles"."auth_provider" IS 'How user authenticated: email or webex';



ALTER TABLE ONLY "display"."admin_users"
    ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "display"."commands"
    ADD CONSTRAINT "commands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "display"."connection_heartbeats"
    ADD CONSTRAINT "connection_heartbeats_pkey" PRIMARY KEY ("device_uuid");



ALTER TABLE ONLY "display"."device_logs"
    ADD CONSTRAINT "device_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "display"."devices"
    ADD CONSTRAINT "devices_device_id_key" UNIQUE ("device_id");



ALTER TABLE ONLY "display"."devices"
    ADD CONSTRAINT "devices_pairing_code_key" UNIQUE ("pairing_code");



ALTER TABLE ONLY "display"."devices"
    ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "display"."devices"
    ADD CONSTRAINT "devices_serial_number_key" UNIQUE ("serial_number");



ALTER TABLE ONLY "display"."oauth_clients"
    ADD CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "display"."oauth_state"
    ADD CONSTRAINT "oauth_state_pkey" PRIMARY KEY ("state_key");



ALTER TABLE ONLY "display"."oauth_tokens"
    ADD CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "display"."oauth_tokens"
    ADD CONSTRAINT "oauth_tokens_provider_user_key" UNIQUE ("provider", "user_id");



ALTER TABLE ONLY "display"."pairings"
    ADD CONSTRAINT "pairings_pkey" PRIMARY KEY ("pairing_code");



ALTER TABLE ONLY "display"."provision_tokens"
    ADD CONSTRAINT "provision_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "display"."provision_tokens"
    ADD CONSTRAINT "provision_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "display"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "display"."release_artifacts"
    ADD CONSTRAINT "release_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "display"."release_artifacts"
    ADD CONSTRAINT "release_artifacts_release_id_board_type_key" UNIQUE ("release_id", "board_type");



ALTER TABLE ONLY "display"."releases"
    ADD CONSTRAINT "releases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "display"."releases"
    ADD CONSTRAINT "releases_tag_key" UNIQUE ("tag");



ALTER TABLE ONLY "display"."releases"
    ADD CONSTRAINT "releases_version_channel_key" UNIQUE ("version", "release_channel");



ALTER TABLE ONLY "display"."support_sessions"
    ADD CONSTRAINT "support_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "display"."user_devices"
    ADD CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "display"."user_devices"
    ADD CONSTRAINT "user_devices_user_id_serial_number_key" UNIQUE ("user_id", "serial_number");



ALTER TABLE ONLY "display"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "display"."user_profiles"
    ADD CONSTRAINT "user_profiles_webex_user_id_key" UNIQUE ("webex_user_id");



CREATE INDEX "idx_commands_cleanup" ON "display"."commands" USING "btree" ("created_at") WHERE ("status" = ANY (ARRAY['acked'::"text", 'failed'::"text", 'expired'::"text"]));



CREATE INDEX "idx_commands_device_status" ON "display"."commands" USING "btree" ("device_uuid", "status", "created_at") WHERE (("device_uuid" IS NOT NULL) AND ("status" = 'pending'::"text"));



COMMENT ON INDEX "display"."idx_commands_device_status" IS 'Composite index for pending commands by device UUID';



CREATE INDEX "idx_commands_device_uuid" ON "display"."commands" USING "btree" ("device_uuid") WHERE ("device_uuid" IS NOT NULL);



COMMENT ON INDEX "display"."idx_commands_device_uuid" IS 'Index for UUID-based device lookups in commands table';



CREATE INDEX "idx_commands_expires" ON "display"."commands" USING "btree" ("expires_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_commands_pairing_code" ON "display"."commands" USING "btree" ("pairing_code");



CREATE INDEX "idx_commands_pending" ON "display"."commands" USING "btree" ("pairing_code", "status", "created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_commands_serial_pending" ON "display"."commands" USING "btree" ("serial_number", "status", "created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_connection_heartbeats_device_uuid" ON "display"."connection_heartbeats" USING "btree" ("device_uuid") WHERE ("device_uuid" IS NOT NULL);



CREATE INDEX "idx_devices_approval_required" ON "display"."devices" USING "btree" ("approval_required") WHERE ("approval_required" = true);



CREATE INDEX "idx_devices_blacklisted" ON "display"."devices" USING "btree" ("blacklisted") WHERE ("blacklisted" = true);



CREATE INDEX "idx_devices_channel" ON "display"."devices" USING "btree" ("release_channel");



CREATE INDEX "idx_devices_debug" ON "display"."devices" USING "btree" ("debug_enabled") WHERE ("debug_enabled" = true);



CREATE INDEX "idx_devices_disabled" ON "display"."devices" USING "btree" ("disabled") WHERE ("disabled" = true);



CREATE INDEX "idx_devices_pairing_code" ON "display"."devices" USING "btree" ("pairing_code");



CREATE INDEX "idx_devices_provisioned" ON "display"."devices" USING "btree" ("is_provisioned");



CREATE INDEX "idx_devices_serial" ON "display"."devices" USING "btree" ("serial_number");



CREATE INDEX "idx_heartbeats_device_uuid" ON "display"."connection_heartbeats" USING "btree" ("device_uuid") WHERE ("device_uuid" IS NOT NULL);



CREATE INDEX "idx_heartbeats_pairing" ON "display"."connection_heartbeats" USING "btree" ("pairing_code");



CREATE INDEX "idx_logs_created" ON "display"."device_logs" USING "btree" ("created_at");



CREATE INDEX "idx_logs_device_time" ON "display"."device_logs" USING "btree" ("device_id", "created_at" DESC);



CREATE INDEX "idx_logs_serial_time" ON "display"."device_logs" USING "btree" ("serial_number", "created_at" DESC);



CREATE INDEX "idx_oauth_state_expires" ON "display"."oauth_state" USING "btree" ("expires_at");



CREATE INDEX "idx_oauth_tokens_device_uuid" ON "display"."oauth_tokens" USING "btree" ("device_uuid") WHERE ("device_uuid" IS NOT NULL);



COMMENT ON INDEX "display"."idx_oauth_tokens_device_uuid" IS 'Index for UUID-based device token lookups';



CREATE INDEX "idx_pairings_app_connected" ON "display"."pairings" USING "btree" ("app_connected") WHERE ("app_connected" = true);



CREATE INDEX "idx_pairings_device_connected" ON "display"."pairings" USING "btree" ("device_connected") WHERE ("device_connected" = true);



CREATE INDEX "idx_pairings_device_uuid" ON "display"."pairings" USING "btree" ("device_uuid") WHERE ("device_uuid" IS NOT NULL);



COMMENT ON INDEX "display"."idx_pairings_device_uuid" IS 'Index for UUID-based device lookups in pairings table';



CREATE INDEX "idx_pairings_firmware_version" ON "display"."pairings" USING "btree" ("firmware_version") WHERE ("firmware_version" IS NOT NULL);



CREATE INDEX "idx_pairings_pairing_code" ON "display"."pairings" USING "btree" ("pairing_code");



CREATE INDEX "idx_pairings_serial" ON "display"."pairings" USING "btree" ("serial_number");



CREATE INDEX "idx_pairings_status_updated" ON "display"."pairings" USING "btree" ("pairing_code", "status_updated_at" DESC);



CREATE INDEX "idx_pairings_updated" ON "display"."pairings" USING "btree" ("updated_at");



CREATE INDEX "idx_pairings_user_device_uuid" ON "display"."pairings" USING "btree" ("user_uuid", "device_uuid") WHERE (("user_uuid" IS NOT NULL) AND ("device_uuid" IS NOT NULL));



COMMENT ON INDEX "display"."idx_pairings_user_device_uuid" IS 'Composite index for user + device UUID lookups';



CREATE INDEX "idx_pairings_user_uuid" ON "display"."pairings" USING "btree" ("user_uuid") WHERE ("user_uuid" IS NOT NULL);



COMMENT ON INDEX "display"."idx_pairings_user_uuid" IS 'Index for UUID-based user lookups in pairings table';



CREATE INDEX "idx_provision_tokens_expires_at" ON "display"."provision_tokens" USING "btree" ("expires_at");



CREATE INDEX "idx_provision_tokens_token" ON "display"."provision_tokens" USING "btree" ("token");



CREATE INDEX "idx_rate_limits_updated" ON "display"."rate_limits" USING "btree" ("updated_at");



CREATE INDEX "idx_release_artifacts_board" ON "display"."release_artifacts" USING "btree" ("board_type");



CREATE INDEX "idx_release_artifacts_composite" ON "display"."release_artifacts" USING "btree" ("release_id", "board_type");



CREATE INDEX "idx_release_artifacts_release" ON "display"."release_artifacts" USING "btree" ("release_id");



CREATE INDEX "idx_releases_channel" ON "display"."releases" USING "btree" ("release_channel");



CREATE INDEX "idx_releases_latest" ON "display"."releases" USING "btree" ("is_latest") WHERE ("is_latest" = true);



CREATE INDEX "idx_releases_version" ON "display"."releases" USING "btree" ("version");



CREATE INDEX "idx_support_sessions_created_at" ON "display"."support_sessions" USING "btree" ("created_at");



CREATE INDEX "idx_support_sessions_status" ON "display"."support_sessions" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['waiting'::"text", 'active'::"text"]));



CREATE INDEX "idx_support_sessions_user_id" ON "display"."support_sessions" USING "btree" ("user_id");



CREATE INDEX "idx_user_devices_device_uuid" ON "display"."user_devices" USING "btree" ("device_uuid") WHERE ("device_uuid" IS NOT NULL);



COMMENT ON INDEX "display"."idx_user_devices_device_uuid" IS 'Index for reverse lookups from device UUID to user assignments';



CREATE INDEX "idx_user_devices_user_serial" ON "display"."user_devices" USING "btree" ("user_id", "serial_number");



CREATE INDEX "idx_user_profiles_webex_id" ON "display"."user_profiles" USING "btree" ("webex_user_id") WHERE ("webex_user_id" IS NOT NULL);



CREATE UNIQUE INDEX "oauth_clients_provider_purpose_idx" ON "display"."oauth_clients" USING "btree" ("provider", "purpose");



CREATE INDEX "oauth_tokens_pairing_code_idx" ON "display"."oauth_tokens" USING "btree" ("pairing_code");



CREATE INDEX "oauth_tokens_pairing_idx" ON "display"."oauth_tokens" USING "btree" ("pairing_code");



CREATE INDEX "oauth_tokens_provider_idx" ON "display"."oauth_tokens" USING "btree" ("provider");



CREATE UNIQUE INDEX "oauth_tokens_provider_serial_idx" ON "display"."oauth_tokens" USING "btree" ("provider", "serial_number");



CREATE INDEX "oauth_tokens_serial_idx" ON "display"."oauth_tokens" USING "btree" ("serial_number");



CREATE INDEX "oauth_tokens_serial_number_idx" ON "display"."oauth_tokens" USING "btree" ("serial_number");



CREATE INDEX "user_devices_polling_enabled_idx" ON "display"."user_devices" USING "btree" ("user_id") WHERE ("webex_polling_enabled" = true);



CREATE OR REPLACE TRIGGER "connection_heartbeats_updated_at" BEFORE UPDATE ON "display"."connection_heartbeats" FOR EACH ROW EXECUTE FUNCTION "display"."update_updated_at"();



CREATE OR REPLACE TRIGGER "devices_immutable_columns" BEFORE UPDATE ON "display"."devices" FOR EACH ROW EXECUTE FUNCTION "display"."prevent_immutable_device_updates"();



CREATE OR REPLACE TRIGGER "devices_updated_at" BEFORE UPDATE ON "display"."devices" FOR EACH ROW EXECUTE FUNCTION "display"."update_updated_at"();



CREATE OR REPLACE TRIGGER "display_commands_broadcast" AFTER INSERT OR DELETE OR UPDATE ON "display"."commands" FOR EACH ROW EXECUTE FUNCTION "display"."broadcast_commands_changes"();



CREATE OR REPLACE TRIGGER "pairings_presence_before_update" BEFORE UPDATE ON "display"."pairings" FOR EACH ROW EXECUTE FUNCTION "display"."pairings_presence_trigger"();



COMMENT ON TRIGGER "pairings_presence_before_update" ON "display"."pairings" IS 'Automatically tracks app presence/heartbeat whenever pairings table is updated. Sets app_last_seen = NOW(), app_connected = TRUE, and upserts into connection_heartbeats.';



CREATE OR REPLACE TRIGGER "pairings_status_change" BEFORE UPDATE ON "display"."pairings" FOR EACH ROW EXECUTE FUNCTION "display"."update_status_timestamp"();



CREATE OR REPLACE TRIGGER "pairings_updated_at" BEFORE UPDATE ON "display"."pairings" FOR EACH ROW EXECUTE FUNCTION "display"."update_updated_at"();



CREATE OR REPLACE TRIGGER "releases_single_latest" BEFORE INSERT OR UPDATE ON "display"."releases" FOR EACH ROW WHEN (("new"."is_latest" = true)) EXECUTE FUNCTION "display"."ensure_single_latest"();



CREATE OR REPLACE TRIGGER "tr_display_commands_broadcast" AFTER INSERT OR DELETE OR UPDATE ON "display"."commands" FOR EACH ROW EXECUTE FUNCTION "public"."display_commands_broadcast_trigger"();



CREATE OR REPLACE TRIGGER "update_release_artifacts_updated_at" BEFORE UPDATE ON "display"."release_artifacts" FOR EACH ROW EXECUTE FUNCTION "display"."update_release_artifacts_updated_at"();



ALTER TABLE ONLY "display"."admin_users"
    ADD CONSTRAINT "admin_users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "display"."admin_users"
    ADD CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."commands"
    ADD CONSTRAINT "commands_device_uuid_fkey" FOREIGN KEY ("device_uuid") REFERENCES "display"."devices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."commands"
    ADD CONSTRAINT "commands_pairing_code_fkey" FOREIGN KEY ("pairing_code") REFERENCES "display"."pairings"("pairing_code") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."connection_heartbeats"
    ADD CONSTRAINT "connection_heartbeats_device_uuid_fkey" FOREIGN KEY ("device_uuid") REFERENCES "display"."devices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."connection_heartbeats"
    ADD CONSTRAINT "connection_heartbeats_pairing_code_fkey" FOREIGN KEY ("pairing_code") REFERENCES "display"."pairings"("pairing_code") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."device_logs"
    ADD CONSTRAINT "device_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "display"."devices"("device_id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."device_logs"
    ADD CONSTRAINT "device_logs_serial_number_fkey" FOREIGN KEY ("serial_number") REFERENCES "display"."devices"("serial_number") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."devices"
    ADD CONSTRAINT "devices_user_approved_by_fkey" FOREIGN KEY ("user_approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "display"."oauth_tokens"
    ADD CONSTRAINT "oauth_tokens_device_uuid_fkey" FOREIGN KEY ("device_uuid") REFERENCES "display"."devices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."oauth_tokens"
    ADD CONSTRAINT "oauth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."pairings"
    ADD CONSTRAINT "pairings_device_uuid_fkey" FOREIGN KEY ("device_uuid") REFERENCES "display"."devices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."pairings"
    ADD CONSTRAINT "pairings_serial_number_fkey" FOREIGN KEY ("serial_number") REFERENCES "display"."devices"("serial_number") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."pairings"
    ADD CONSTRAINT "pairings_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "display"."provision_tokens"
    ADD CONSTRAINT "provision_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."release_artifacts"
    ADD CONSTRAINT "release_artifacts_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "display"."releases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."releases"
    ADD CONSTRAINT "releases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "display"."support_sessions"
    ADD CONSTRAINT "support_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "display"."support_sessions"
    ADD CONSTRAINT "support_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."user_devices"
    ADD CONSTRAINT "user_devices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "display"."user_devices"
    ADD CONSTRAINT "user_devices_device_uuid_fkey" FOREIGN KEY ("device_uuid") REFERENCES "display"."devices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."user_devices"
    ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "display"."user_profiles"
    ADD CONSTRAINT "user_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "display"."user_profiles"
    ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can delete any support session" ON "display"."support_sessions" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "display"."user_profiles"
  WHERE (("user_profiles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Admins can update any support session" ON "display"."support_sessions" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "display"."user_profiles"
  WHERE (("user_profiles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "display"."user_profiles"
  WHERE (("user_profiles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Admins can view all support sessions" ON "display"."support_sessions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "display"."user_profiles"
  WHERE (("user_profiles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Public read access to release artifacts" ON "display"."release_artifacts" FOR SELECT USING (true);



CREATE POLICY "Service role full access" ON "display"."provision_tokens" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access to release artifacts" ON "display"."release_artifacts" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "Users can create their own support sessions" ON "display"."support_sessions" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can create their own tokens" ON "display"."provision_tokens" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own support sessions" ON "display"."support_sessions" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update their own support sessions" ON "display"."support_sessions" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view their own support sessions" ON "display"."support_sessions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view their own tokens" ON "display"."provision_tokens" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "admin select oauth clients" ON "display"."oauth_clients" FOR SELECT USING ("display"."is_admin"());



CREATE POLICY "admin select oauth tokens" ON "display"."oauth_tokens" FOR SELECT USING ("display"."is_admin"());



ALTER TABLE "display"."admin_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_users_self_read" ON "display"."admin_users" FOR SELECT USING ((("auth"."role"() = 'service_role'::"text") OR ("auth"."uid"() = "user_id")));



CREATE POLICY "admin_users_service_role" ON "display"."admin_users" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "display"."commands" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "commands_admin_all" ON "display"."commands" USING ("display"."is_admin"());



CREATE POLICY "commands_app_insert" ON "display"."commands" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND (("auth"."jwt"() ->> 'token_type'::"text") = 'app'::"text") AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code") AND (("auth"."jwt"() ->> 'serial_number'::"text") = "serial_number")));



CREATE POLICY "commands_app_select" ON "display"."commands" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND (("auth"."jwt"() ->> 'token_type'::"text") = 'app'::"text") AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code")));



CREATE POLICY "commands_device_select" ON "display"."commands" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND (("auth"."jwt"() ->> 'token_type'::"text") = 'device'::"text") AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code")));



CREATE POLICY "commands_device_update" ON "display"."commands" FOR UPDATE USING ((("auth"."role"() = 'authenticated'::"text") AND (("auth"."jwt"() ->> 'token_type'::"text") = 'device'::"text") AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code")));



CREATE POLICY "commands_service_full" ON "display"."commands" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "commands_user_insert_uuid" ON "display"."commands" FOR INSERT TO "authenticated" WITH CHECK (("display"."is_admin"() OR ("device_uuid" IN ( SELECT "user_devices"."device_uuid"
   FROM "display"."user_devices"
  WHERE (("user_devices"."user_id" = "auth"."uid"()) AND ("user_devices"."device_uuid" IS NOT NULL))))));



COMMENT ON POLICY "commands_user_insert_uuid" ON "display"."commands" IS 'UUID-based: Users can insert commands for their devices (by device_uuid). Transitional policy - works alongside legacy serial_number-based policies.';



CREATE POLICY "commands_user_select" ON "display"."commands" FOR SELECT USING ("display"."user_can_access_device"("serial_number"));



CREATE POLICY "commands_user_select_uuid" ON "display"."commands" FOR SELECT TO "authenticated" USING (("display"."is_admin"() OR ("device_uuid" IN ( SELECT "user_devices"."device_uuid"
   FROM "display"."user_devices"
  WHERE (("user_devices"."user_id" = "auth"."uid"()) AND ("user_devices"."device_uuid" IS NOT NULL))))));



COMMENT ON POLICY "commands_user_select_uuid" ON "display"."commands" IS 'UUID-based: Users can select commands for their devices (by device_uuid). Transitional policy - works alongside legacy serial_number-based policies.';



ALTER TABLE "display"."connection_heartbeats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "display"."device_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "display"."devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devices_admin_delete" ON "display"."devices" FOR DELETE USING ("display"."is_admin"());



COMMENT ON POLICY "devices_admin_delete" ON "display"."devices" IS 'Allow admins to delete devices. Related records (device_logs, user_devices, pairings) cascade automatically via ON DELETE CASCADE constraints.';



CREATE POLICY "devices_admin_select" ON "display"."devices" FOR SELECT USING ("display"."is_admin"());



CREATE POLICY "devices_admin_update" ON "display"."devices" FOR UPDATE USING ("display"."is_admin"()) WITH CHECK ("display"."is_admin"());



COMMENT ON POLICY "devices_admin_update" ON "display"."devices" IS 'Allows admins to update safe columns only. Prevents updates to key_hash, serial_number, device_id, and pairing_code.';



CREATE POLICY "devices_service_full" ON "display"."devices" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "devices_user_select" ON "display"."devices" FOR SELECT USING ("display"."user_can_access_device"("serial_number"));



CREATE POLICY "devices_user_select_uuid" ON "display"."devices" FOR SELECT TO "authenticated" USING (("display"."is_admin"() OR ("id" IN ( SELECT "user_devices"."device_uuid"
   FROM "display"."user_devices"
  WHERE (("user_devices"."user_id" = "auth"."uid"()) AND ("user_devices"."device_uuid" IS NOT NULL)))) OR ("serial_number" IN ( SELECT "user_devices"."serial_number"
   FROM "display"."user_devices"
  WHERE (("user_devices"."user_id" = "auth"."uid"()) AND ("user_devices"."serial_number" IS NOT NULL))))));



COMMENT ON POLICY "devices_user_select_uuid" ON "display"."devices" IS 'UUID-based: Users can select their devices via device_uuid or serial_number. Works alongside legacy serial_number-based policy for backward compatibility.';



CREATE POLICY "heartbeats_device_select" ON "display"."connection_heartbeats" FOR SELECT USING (("device_uuid" = ((("current_setting"('request.jwt.claims'::"text", true))::json ->> 'device_uuid'::"text"))::"uuid"));



CREATE POLICY "heartbeats_service_role_all" ON "display"."connection_heartbeats" USING (((("current_setting"('request.jwt.claims'::"text", true))::json ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "heartbeats_user_insert" ON "display"."connection_heartbeats" FOR INSERT WITH CHECK (("display"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "display"."user_devices" "ud"
  WHERE (("ud"."device_uuid" = "connection_heartbeats"."device_uuid") AND ("ud"."user_id" = "auth"."uid"()))))));



CREATE POLICY "heartbeats_user_select" ON "display"."connection_heartbeats" FOR SELECT USING (("display"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "display"."user_devices" "ud"
  WHERE (("ud"."device_uuid" = "connection_heartbeats"."device_uuid") AND ("ud"."user_id" = "auth"."uid"()))))));



CREATE POLICY "heartbeats_user_update" ON "display"."connection_heartbeats" FOR UPDATE USING (("display"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "display"."user_devices" "ud"
  WHERE (("ud"."device_uuid" = "connection_heartbeats"."device_uuid") AND ("ud"."user_id" = "auth"."uid"())))))) WITH CHECK (("display"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "display"."user_devices" "ud"
  WHERE (("ud"."device_uuid" = "connection_heartbeats"."device_uuid") AND ("ud"."user_id" = "auth"."uid"()))))));



CREATE POLICY "logs_admin_select" ON "display"."device_logs" FOR SELECT USING ("display"."is_admin"());



CREATE POLICY "logs_service_full" ON "display"."device_logs" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "logs_user_select" ON "display"."device_logs" FOR SELECT USING ("display"."user_can_access_device"("serial_number"));



ALTER TABLE "display"."oauth_clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "oauth_clients_admin_delete" ON "display"."oauth_clients" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "display"."admin_users" "au"
  WHERE ("au"."user_id" = "auth"."uid"()))));



CREATE POLICY "oauth_clients_admin_insert" ON "display"."oauth_clients" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "display"."admin_users" "au"
  WHERE ("au"."user_id" = "auth"."uid"()))));



CREATE POLICY "oauth_clients_admin_select" ON "display"."oauth_clients" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "display"."admin_users" "au"
  WHERE ("au"."user_id" = "auth"."uid"()))));



CREATE POLICY "oauth_clients_admin_update" ON "display"."oauth_clients" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "display"."admin_users" "au"
  WHERE ("au"."user_id" = "auth"."uid"())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "display"."admin_users" "au"
  WHERE ("au"."user_id" = "auth"."uid"()))));



ALTER TABLE "display"."oauth_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "oauth_state_service_only" ON "display"."oauth_state" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "display"."oauth_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "oauth_tokens_admin_select" ON "display"."oauth_tokens" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "display"."admin_users" "au"
  WHERE ("au"."user_id" = "auth"."uid"()))));



CREATE POLICY "oauth_tokens_device_delete" ON "display"."oauth_tokens" FOR DELETE USING ((((("auth"."jwt"() ->> 'serial_number'::"text") IS NOT NULL) AND (("auth"."jwt"() ->> 'serial_number'::"text") = "serial_number")) OR ((("auth"."jwt"() ->> 'pairing_code'::"text") IS NOT NULL) AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code"))));



CREATE POLICY "oauth_tokens_device_insert" ON "display"."oauth_tokens" FOR INSERT WITH CHECK ((((("auth"."jwt"() ->> 'serial_number'::"text") IS NOT NULL) AND (("auth"."jwt"() ->> 'serial_number'::"text") = "serial_number")) OR ((("auth"."jwt"() ->> 'pairing_code'::"text") IS NOT NULL) AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code"))));



CREATE POLICY "oauth_tokens_device_select" ON "display"."oauth_tokens" FOR SELECT USING ((((("auth"."jwt"() ->> 'serial_number'::"text") IS NOT NULL) AND (("auth"."jwt"() ->> 'serial_number'::"text") = "serial_number")) OR ((("auth"."jwt"() ->> 'pairing_code'::"text") IS NOT NULL) AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code"))));



CREATE POLICY "oauth_tokens_device_select_uuid" ON "display"."oauth_tokens" FOR SELECT TO "authenticated" USING (("display"."is_admin"() OR (("token_scope" = 'device'::"text") AND ("device_uuid" IS NOT NULL) AND ("device_uuid" = ((("current_setting"('request.jwt.claims'::"text", true))::"jsonb" ->> 'device_uuid'::"text"))::"uuid"))));



COMMENT ON POLICY "oauth_tokens_device_select_uuid" ON "display"."oauth_tokens" IS 'UUID-based: Devices can select their own device-scope tokens by device_uuid from JWT. Transitional policy - works alongside legacy pairing_code-based policies.';



CREATE POLICY "oauth_tokens_device_update" ON "display"."oauth_tokens" FOR UPDATE USING ((((("auth"."jwt"() ->> 'serial_number'::"text") IS NOT NULL) AND (("auth"."jwt"() ->> 'serial_number'::"text") = "serial_number")) OR ((("auth"."jwt"() ->> 'pairing_code'::"text") IS NOT NULL) AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code")))) WITH CHECK ((((("auth"."jwt"() ->> 'serial_number'::"text") IS NOT NULL) AND (("auth"."jwt"() ->> 'serial_number'::"text") = "serial_number")) OR ((("auth"."jwt"() ->> 'pairing_code'::"text") IS NOT NULL) AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code"))));



CREATE POLICY "oauth_tokens_user_select" ON "display"."oauth_tokens" FOR SELECT USING ((("token_scope" = 'user'::"text") AND ("user_id" = "auth"."uid"())));



COMMENT ON POLICY "oauth_tokens_user_select" ON "display"."oauth_tokens" IS 'Users can view their own user-scoped OAuth tokens';



CREATE POLICY "oauth_tokens_user_select_uuid" ON "display"."oauth_tokens" FOR SELECT TO "authenticated" USING (("display"."is_admin"() OR (("token_scope" = 'user'::"text") AND ("user_id" = "auth"."uid"()))));



COMMENT ON POLICY "oauth_tokens_user_select_uuid" ON "display"."oauth_tokens" IS 'UUID-based: Users can select their own user-scope tokens by user_id. Transitional policy - works alongside legacy policies.';



ALTER TABLE "display"."pairings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pairings_admin_select" ON "display"."pairings" FOR SELECT USING ("display"."is_admin"());



CREATE POLICY "pairings_app_select" ON "display"."pairings" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND (("auth"."jwt"() ->> 'token_type'::"text") = 'app'::"text") AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code")));



CREATE POLICY "pairings_app_update" ON "display"."pairings" FOR UPDATE USING ((("auth"."role"() = 'authenticated'::"text") AND (("auth"."jwt"() ->> 'token_type'::"text") = 'app'::"text") AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code")));



CREATE POLICY "pairings_device_select" ON "display"."pairings" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND (("auth"."jwt"() ->> 'token_type'::"text") = 'device'::"text") AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code")));



CREATE POLICY "pairings_device_update" ON "display"."pairings" FOR UPDATE USING ((("auth"."role"() = 'authenticated'::"text") AND (("auth"."jwt"() ->> 'token_type'::"text") = 'device'::"text") AND (("auth"."jwt"() ->> 'pairing_code'::"text") = "pairing_code")));



CREATE POLICY "pairings_service_full" ON "display"."pairings" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "pairings_user_select" ON "display"."pairings" FOR SELECT USING ("display"."user_can_access_device"("serial_number"));



CREATE POLICY "pairings_user_select_uuid" ON "display"."pairings" FOR SELECT TO "authenticated" USING (("display"."is_admin"() OR ("user_uuid" = "auth"."uid"()) OR (("device_uuid" IS NOT NULL) AND "display"."user_can_access_device"("device_uuid"))));



COMMENT ON POLICY "pairings_user_select_uuid" ON "display"."pairings" IS 'UUID-based: Users can view pairings by user_uuid or device_uuid. Transitional policy - works alongside legacy serial_number-based policies.';



CREATE POLICY "pairings_user_update_uuid" ON "display"."pairings" FOR UPDATE TO "authenticated" USING (("display"."is_admin"() OR ("user_uuid" = "auth"."uid"()) OR (("device_uuid" IS NOT NULL) AND "display"."user_can_access_device"("target_device_uuid" => "device_uuid")))) WITH CHECK (("display"."is_admin"() OR ("user_uuid" = "auth"."uid"()) OR (("device_uuid" IS NOT NULL) AND "display"."user_can_access_device"("target_device_uuid" => "device_uuid"))));



COMMENT ON POLICY "pairings_user_update_uuid" ON "display"."pairings" IS 'UUID-based: Users can update pairings where user_uuid = auth.uid() or via device_uuid access. Enables user session access for embedded app.';



ALTER TABLE "display"."provision_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "display"."rate_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rate_limits_service_only" ON "display"."rate_limits" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "display"."release_artifacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "display"."releases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "releases_admin_delete" ON "display"."releases" FOR DELETE USING ("display"."is_admin"());



CREATE POLICY "releases_admin_insert" ON "display"."releases" FOR INSERT WITH CHECK ("display"."is_admin"());



CREATE POLICY "releases_admin_update" ON "display"."releases" FOR UPDATE USING ("display"."is_admin"());



CREATE POLICY "releases_public_select" ON "display"."releases" FOR SELECT USING (true);



ALTER TABLE "display"."support_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "display"."user_devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_devices_admin_all" ON "display"."user_devices" USING ("display"."is_admin"()) WITH CHECK ("display"."is_admin"());



CREATE POLICY "user_devices_device_update" ON "display"."user_devices" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (("device_uuid" IS NOT NULL) AND ("device_uuid" = ((("current_setting"('request.jwt.claims'::"text", true))::"jsonb" ->> 'device_uuid'::"text"))::"uuid")))) WITH CHECK ((("user_id" = "auth"."uid"()) OR (("device_uuid" IS NOT NULL) AND ("device_uuid" = ((("current_setting"('request.jwt.claims'::"text", true))::"jsonb" ->> 'device_uuid'::"text"))::"uuid"))));



COMMENT ON POLICY "user_devices_device_update" ON "display"."user_devices" IS 'UUID-based: Devices can update their own row via device_uuid in JWT claims. Also allows users to update their own device assignments.';



CREATE POLICY "user_devices_self_delete" ON "display"."user_devices" FOR DELETE USING (("user_id" = "auth"."uid"()));



COMMENT ON POLICY "user_devices_self_delete" ON "display"."user_devices" IS 'Users can remove their own device assignments (does not delete the device itself)';



CREATE POLICY "user_devices_self_select" ON "display"."user_devices" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_devices_self_update_polling" ON "display"."user_devices" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



COMMENT ON POLICY "user_devices_self_update_polling" ON "display"."user_devices" IS 'Users can update their own device settings including webex_polling_enabled';



ALTER TABLE "display"."user_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_profiles_admin_all" ON "display"."user_profiles" USING ("display"."is_admin"()) WITH CHECK ("display"."is_admin"());



CREATE POLICY "user_profiles_self_select" ON "display"."user_profiles" FOR SELECT USING (("user_id" = "auth"."uid"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "display"."commands";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "display"."connection_heartbeats";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "display"."device_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "display"."devices";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "display"."pairings";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "display"."support_sessions";



ALTER PUBLICATION "supabase_realtime" ADD TABLES IN SCHEMA "display";



SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;



GRANT USAGE ON SCHEMA "display" TO "anon";
GRANT USAGE ON SCHEMA "display" TO "authenticated";
GRANT USAGE ON SCHEMA "display" TO "service_role";
GRANT USAGE ON SCHEMA "display" TO "supabase_auth_admin";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
























GRANT ALL ON FUNCTION "display"."cleanup_stale_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "display"."cleanup_stale_sessions"() TO "service_role";



REVOKE ALL ON FUNCTION "display"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "display"."custom_access_token_hook"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "display"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "display"."is_admin"() TO "authenticated";



GRANT ALL ON FUNCTION "display"."set_latest_release"("target_version" "text") TO "authenticated";
GRANT ALL ON FUNCTION "display"."set_latest_release"("target_version" "text") TO "service_role";



GRANT ALL ON FUNCTION "display"."set_latest_release"("target_version" "text", "target_channel" "text") TO "authenticated";
GRANT ALL ON FUNCTION "display"."set_latest_release"("target_version" "text", "target_channel" "text") TO "service_role";



GRANT ALL ON FUNCTION "display"."status_values_changed"("p_pairing_code" "text", "p_webex_status" "text", "p_camera_on" boolean, "p_mic_muted" boolean, "p_in_call" boolean, "p_display_name" "text", "p_app_connected" boolean) TO "service_role";



GRANT ALL ON FUNCTION "display"."user_can_access_device"("target_serial" "text") TO "authenticated";



GRANT ALL ON FUNCTION "display"."user_can_access_device"("target_device_uuid" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "display"."vault_create_secret"("p_name" "text", "p_secret" "text") TO "service_role";



GRANT ALL ON FUNCTION "display"."vault_find_secret_by_name"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "display"."vault_read_secret"("p_secret_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "display"."vault_update_secret"("p_secret_id" "uuid", "p_secret" "text", "p_name" "text", "p_description" "text", "p_key_id" "uuid") TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."display_check_rate_limit"("rate_key" "text", "max_requests" integer, "window_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."display_check_rate_limit"("rate_key" "text", "max_requests" integer, "window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."display_check_rate_limit"("rate_key" "text", "max_requests" integer, "window_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."display_commands_broadcast_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."display_commands_broadcast_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."display_commands_broadcast_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."display_firmware_updates_broadcast_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."display_firmware_updates_broadcast_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."display_firmware_updates_broadcast_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."display_heartbeats_broadcast_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."display_heartbeats_broadcast_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."display_heartbeats_broadcast_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_latest_release"("target_version" "text", "target_channel" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_latest_release"("target_version" "text", "target_channel" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_latest_release"("target_version" "text", "target_channel" "text") TO "service_role";


















GRANT SELECT ON TABLE "display"."admin_users" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."admin_users" TO "authenticated";
GRANT ALL ON TABLE "display"."admin_users" TO "service_role";



GRANT SELECT ON TABLE "display"."commands" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."commands" TO "authenticated";
GRANT ALL ON TABLE "display"."commands" TO "service_role";



GRANT SELECT ON TABLE "display"."connection_heartbeats" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."connection_heartbeats" TO "authenticated";
GRANT ALL ON TABLE "display"."connection_heartbeats" TO "service_role";



GRANT SELECT ON TABLE "display"."device_logs" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."device_logs" TO "authenticated";
GRANT ALL ON TABLE "display"."device_logs" TO "service_role";



GRANT SELECT ON TABLE "display"."devices" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."devices" TO "authenticated";
GRANT ALL ON TABLE "display"."devices" TO "service_role";



GRANT SELECT ON TABLE "display"."oauth_clients" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."oauth_clients" TO "authenticated";
GRANT ALL ON TABLE "display"."oauth_clients" TO "service_role";



GRANT SELECT ON TABLE "display"."oauth_state" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."oauth_state" TO "authenticated";
GRANT ALL ON TABLE "display"."oauth_state" TO "service_role";



GRANT SELECT ON TABLE "display"."oauth_tokens" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."oauth_tokens" TO "authenticated";
GRANT ALL ON TABLE "display"."oauth_tokens" TO "service_role";



GRANT SELECT ON TABLE "display"."pairings" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."pairings" TO "authenticated";
GRANT ALL ON TABLE "display"."pairings" TO "service_role";



GRANT SELECT ON TABLE "display"."provision_tokens" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."provision_tokens" TO "authenticated";
GRANT ALL ON TABLE "display"."provision_tokens" TO "service_role";



GRANT SELECT ON TABLE "display"."rate_limits" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."rate_limits" TO "authenticated";
GRANT ALL ON TABLE "display"."rate_limits" TO "service_role";



GRANT SELECT ON TABLE "display"."release_artifacts" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."release_artifacts" TO "authenticated";
GRANT ALL ON TABLE "display"."release_artifacts" TO "service_role";



GRANT SELECT ON TABLE "display"."releases" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."releases" TO "authenticated";
GRANT ALL ON TABLE "display"."releases" TO "service_role";



GRANT SELECT ON TABLE "display"."support_sessions" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."support_sessions" TO "authenticated";
GRANT ALL ON TABLE "display"."support_sessions" TO "service_role";



GRANT SELECT ON TABLE "display"."user_devices" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."user_devices" TO "authenticated";
GRANT ALL ON TABLE "display"."user_devices" TO "service_role";



GRANT SELECT ON TABLE "display"."user_profiles" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "display"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "display"."user_profiles" TO "service_role";









SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;



SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "display" GRANT SELECT ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "display" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "display" GRANT ALL ON TABLES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































