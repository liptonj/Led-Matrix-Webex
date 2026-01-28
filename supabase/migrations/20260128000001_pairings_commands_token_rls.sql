-- Migration: Allow app/device scoped access to pairings/commands via JWT claims
--
-- Goal: enable Supabase Realtime + PostgREST access for embedded app (and later device)
-- without granting broad authenticated access to devices/logs.
--
-- Tokens are minted by Edge Functions and are signed with DEVICE_JWT_SECRET.
-- They include:
--   pairing_code: TEXT
--   serial_number: TEXT
--   token_type: 'app' | 'device'
--   role: 'authenticated'
--
-- RLS below gates access strictly by pairing_code (and token_type where relevant).

-- =============================================================================
-- display.pairings
-- =============================================================================

DROP POLICY IF EXISTS "pairings_app_select" ON display.pairings;
DROP POLICY IF EXISTS "pairings_app_update" ON display.pairings;
DROP POLICY IF EXISTS "pairings_device_select" ON display.pairings;
DROP POLICY IF EXISTS "pairings_device_update" ON display.pairings;

-- Embedded app: read the single pairing row it is bound to
CREATE POLICY "pairings_app_select" ON display.pairings
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt() ->> 'token_type') = 'app'
    AND (auth.jwt() ->> 'pairing_code') = pairing_code
  );

-- Embedded app: update its state (webex_status, display_name, etc.)
CREATE POLICY "pairings_app_update" ON display.pairings
  FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt() ->> 'token_type') = 'app'
    AND (auth.jwt() ->> 'pairing_code') = pairing_code
  );

-- Device (optional Phase B): read pairing row for app state
CREATE POLICY "pairings_device_select" ON display.pairings
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt() ->> 'token_type') = 'device'
    AND (auth.jwt() ->> 'pairing_code') = pairing_code
  );

-- Device (optional Phase B): update telemetry fields on its pairing row
CREATE POLICY "pairings_device_update" ON display.pairings
  FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt() ->> 'token_type') = 'device'
    AND (auth.jwt() ->> 'pairing_code') = pairing_code
  );

-- =============================================================================
-- display.commands
-- =============================================================================

DROP POLICY IF EXISTS "commands_app_insert" ON display.commands;
DROP POLICY IF EXISTS "commands_app_select" ON display.commands;
DROP POLICY IF EXISTS "commands_device_select" ON display.commands;
DROP POLICY IF EXISTS "commands_device_update" ON display.commands;

-- Embedded app: insert commands for its pairing_code (durable queue)
CREATE POLICY "commands_app_insert" ON display.commands
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND (auth.jwt() ->> 'token_type') = 'app'
    AND (auth.jwt() ->> 'pairing_code') = pairing_code
    AND (auth.jwt() ->> 'serial_number') = serial_number
  );

-- Embedded app: read command status/response for its pairing_code
CREATE POLICY "commands_app_select" ON display.commands
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt() ->> 'token_type') = 'app'
    AND (auth.jwt() ->> 'pairing_code') = pairing_code
  );

-- Device (optional Phase B): read pending commands for its pairing_code
CREATE POLICY "commands_device_select" ON display.commands
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt() ->> 'token_type') = 'device'
    AND (auth.jwt() ->> 'pairing_code') = pairing_code
  );

-- Device (optional Phase B): ack/update commands for its pairing_code
CREATE POLICY "commands_device_update" ON display.commands
  FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt() ->> 'token_type') = 'device'
    AND (auth.jwt() ->> 'pairing_code') = pairing_code
  );
