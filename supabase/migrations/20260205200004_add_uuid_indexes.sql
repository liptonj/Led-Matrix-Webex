-- Migration: Create indexes on UUID columns
-- Phase 1: UUID-based device identity architecture
--
-- This migration creates indexes on the new UUID columns for efficient lookups.
-- Indexes are created on:
-- - device_uuid columns in pairings, commands, user_devices, oauth_tokens
-- - user_uuid column in pairings
--
-- These indexes enable fast UUID-based queries and joins.

-- =============================================================================
-- Part 1: Indexes on device_uuid columns
-- =============================================================================

-- Index on pairings.device_uuid for device lookups
CREATE INDEX IF NOT EXISTS idx_pairings_device_uuid 
  ON display.pairings(device_uuid)
  WHERE device_uuid IS NOT NULL;

-- Index on commands.device_uuid for device command queries
CREATE INDEX IF NOT EXISTS idx_commands_device_uuid 
  ON display.commands(device_uuid)
  WHERE device_uuid IS NOT NULL;

-- Index on user_devices.device_uuid for reverse lookups (device -> users)
CREATE INDEX IF NOT EXISTS idx_user_devices_device_uuid 
  ON display.user_devices(device_uuid)
  WHERE device_uuid IS NOT NULL;

-- Index on oauth_tokens.device_uuid for device token lookups
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_device_uuid 
  ON display.oauth_tokens(device_uuid)
  WHERE device_uuid IS NOT NULL;

-- =============================================================================
-- Part 2: Indexes on user_uuid column
-- =============================================================================

-- Index on pairings.user_uuid for user lookups
CREATE INDEX IF NOT EXISTS idx_pairings_user_uuid 
  ON display.pairings(user_uuid)
  WHERE user_uuid IS NOT NULL;

-- =============================================================================
-- Part 3: Composite indexes for common query patterns
-- =============================================================================

-- Composite index for user + device lookups in pairings
CREATE INDEX IF NOT EXISTS idx_pairings_user_device_uuid 
  ON display.pairings(user_uuid, device_uuid)
  WHERE user_uuid IS NOT NULL AND device_uuid IS NOT NULL;

-- Composite index for device + status lookups in commands
CREATE INDEX IF NOT EXISTS idx_commands_device_status 
  ON display.commands(device_uuid, status, created_at)
  WHERE device_uuid IS NOT NULL AND status = 'pending';

COMMENT ON INDEX display.idx_pairings_device_uuid IS 
  'Index for UUID-based device lookups in pairings table';
COMMENT ON INDEX display.idx_commands_device_uuid IS 
  'Index for UUID-based device lookups in commands table';
COMMENT ON INDEX display.idx_user_devices_device_uuid IS 
  'Index for reverse lookups from device UUID to user assignments';
COMMENT ON INDEX display.idx_oauth_tokens_device_uuid IS 
  'Index for UUID-based device token lookups';
COMMENT ON INDEX display.idx_pairings_user_uuid IS 
  'Index for UUID-based user lookups in pairings table';
COMMENT ON INDEX display.idx_pairings_user_device_uuid IS 
  'Composite index for user + device UUID lookups';
COMMENT ON INDEX display.idx_commands_device_status IS 
  'Composite index for pending commands by device UUID';
