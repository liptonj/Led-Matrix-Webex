-- Migration: Add user_uuid column to pairings table
-- Phase 1: UUID-based device identity architecture
--
-- This migration adds user_uuid column (nullable initially) to display.pairings.
-- The column will be backfilled in the next migration from user_devices table.
--
-- The user_uuid represents the user who owns/controls the pairing session.
-- This allows efficient UUID-based lookups for user-scoped queries.

-- =============================================================================
-- Add user_uuid to display.pairings
-- =============================================================================

ALTER TABLE display.pairings
  ADD COLUMN user_uuid UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN display.pairings.user_uuid IS 
  'UUID reference to auth.users.id for the user who owns this pairing session. '
  'Backfilled from user_devices based on serial_number. '
  'NULL if no user is assigned to the device.';
