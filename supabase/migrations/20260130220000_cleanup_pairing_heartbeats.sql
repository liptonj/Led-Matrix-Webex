-- Migration: Cleanup pairing_heartbeats table and related objects
--
-- This migration removes objects created by 20260130164530_remote_schema.sql
-- that conflict with our connection_heartbeats architecture.
--
-- We're keeping connection_heartbeats (from 20260130210000) instead because:
-- 1. It doesn't trigger realtime notifications (solves the problem)
-- 2. It tracks both app and device heartbeats separately
-- 3. Edge Functions already use it
--
-- This migration runs AFTER 20260130210000_realtime_change_detection.sql
-- to ensure connection_heartbeats exists before we clean up pairing_heartbeats

-- =============================================================================
-- Part 1: Drop trigger and policies for pairing_heartbeats (if table exists)
-- =============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'display'
               AND table_name = 'pairing_heartbeats') THEN
        DROP TRIGGER IF EXISTS tr_display_heartbeats_broadcast ON display.pairing_heartbeats;
    END IF;
END $$;

DROP POLICY IF EXISTS "pairing_can_read" ON realtime.messages;
DROP POLICY IF EXISTS "pairing_can_write" ON realtime.messages;

-- =============================================================================
-- Part 2: Revoke grants on pairing_heartbeats (if table exists)
-- =============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'display'
               AND table_name = 'pairing_heartbeats') THEN
        REVOKE ALL ON display.pairing_heartbeats FROM anon;
        REVOKE ALL ON display.pairing_heartbeats FROM authenticated;
        REVOKE ALL ON display.pairing_heartbeats FROM service_role;
    END IF;
END $$;

-- =============================================================================
-- Part 3: Drop the pairing_heartbeats table and sequence
-- =============================================================================

DROP TABLE IF EXISTS display.pairing_heartbeats CASCADE;
DROP SEQUENCE IF EXISTS display.pairing_heartbeats_id_seq CASCADE;

-- =============================================================================
-- Part 4: Drop broadcast trigger functions if they're no longer needed
-- =============================================================================

-- Only drop if no other tables are using them
-- (These might be used by other triggers, so we'll be conservative)
-- DROP FUNCTION IF EXISTS public.display_heartbeats_broadcast_trigger() CASCADE;

COMMENT ON SCHEMA display IS 'Display management schema. Use connection_heartbeats table (from migration 20260130210000) for heartbeat tracking without triggering realtime notifications.';
