-- Migration: Add pairings and commands tables for Supabase Realtime pairing
--
-- This migration creates:
-- 1. display.pairings - Live state cache per pairing code for realtime sync
-- 2. display.commands - Durable command queue for device commands
--
-- Both tables are added to supabase_realtime publication for live updates.

-- =============================================================================
-- Part 1: display.pairings - Live State Cache
-- =============================================================================

CREATE TABLE display.pairings (
    pairing_code TEXT PRIMARY KEY,
    serial_number TEXT NOT NULL REFERENCES display.devices(serial_number) ON DELETE CASCADE,
    device_id TEXT,
    
    -- Connection state
    app_last_seen TIMESTAMPTZ,
    device_last_seen TIMESTAMPTZ,
    app_connected BOOLEAN DEFAULT FALSE,
    device_connected BOOLEAN DEFAULT FALSE,
    
    -- Webex status (set by embedded app)
    webex_status TEXT DEFAULT 'offline',
    camera_on BOOLEAN DEFAULT FALSE,
    mic_muted BOOLEAN DEFAULT FALSE,
    in_call BOOLEAN DEFAULT FALSE,
    display_name TEXT,
    
    -- Device telemetry (set by device)
    rssi INTEGER,
    free_heap INTEGER,
    uptime INTEGER,
    temperature REAL,
    
    -- Cached config snapshot
    config JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_pairings_serial ON display.pairings(serial_number);
CREATE INDEX idx_pairings_updated ON display.pairings(updated_at);
CREATE INDEX idx_pairings_device_connected ON display.pairings(device_connected) 
    WHERE device_connected = TRUE;
CREATE INDEX idx_pairings_app_connected ON display.pairings(app_connected) 
    WHERE app_connected = TRUE;

-- Updated_at trigger (reuses existing function from devices table)
CREATE TRIGGER pairings_updated_at
    BEFORE UPDATE ON display.pairings
    FOR EACH ROW EXECUTE FUNCTION display.update_updated_at();

-- Enable RLS
ALTER TABLE display.pairings ENABLE ROW LEVEL SECURITY;

-- Service role: full access for Edge Functions
CREATE POLICY "pairings_service_full" ON display.pairings
    FOR ALL USING (auth.role() = 'service_role');

-- Admins: read-only access via admin dashboard
CREATE POLICY "pairings_admin_select" ON display.pairings
    FOR SELECT USING (display.is_admin());

-- Enable realtime for pairings table
ALTER PUBLICATION supabase_realtime ADD TABLE display.pairings;

-- Migrate existing devices with pairing codes
INSERT INTO display.pairings (pairing_code, serial_number, device_id)
SELECT pairing_code, serial_number, device_id 
FROM display.devices
WHERE pairing_code IS NOT NULL
ON CONFLICT (pairing_code) DO NOTHING;

COMMENT ON TABLE display.pairings IS 'Live state cache for pairing sessions - both app and device sync here';
COMMENT ON COLUMN display.pairings.webex_status IS 'Webex presence status: offline, active, dnd, away, meeting';
COMMENT ON COLUMN display.pairings.config IS 'Device configuration snapshot for realtime config updates';

-- =============================================================================
-- Part 2: display.commands - Durable Command Queue
-- =============================================================================

CREATE TABLE display.commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pairing_code TEXT NOT NULL REFERENCES display.pairings(pairing_code) ON DELETE CASCADE,
    serial_number TEXT NOT NULL,
    
    -- Command details
    command TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'acked', 'failed', 'expired')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    acked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '5 minutes'),
    
    -- Response data
    response JSONB,
    error TEXT
);

-- Indexes for efficient polling and cleanup
CREATE INDEX idx_commands_pending ON display.commands(pairing_code, status, created_at) 
    WHERE status = 'pending';
CREATE INDEX idx_commands_serial_pending ON display.commands(serial_number, status, created_at)
    WHERE status = 'pending';
CREATE INDEX idx_commands_cleanup ON display.commands(created_at) 
    WHERE status IN ('acked', 'failed', 'expired');
CREATE INDEX idx_commands_expires ON display.commands(expires_at)
    WHERE status = 'pending';

-- Enable RLS
ALTER TABLE display.commands ENABLE ROW LEVEL SECURITY;

-- Service role: full access for Edge Functions
CREATE POLICY "commands_service_full" ON display.commands
    FOR ALL USING (auth.role() = 'service_role');

-- Admins: full access for dashboard management
CREATE POLICY "commands_admin_all" ON display.commands
    FOR ALL USING (display.is_admin());

-- Enable realtime for commands table
ALTER PUBLICATION supabase_realtime ADD TABLE display.commands;

COMMENT ON TABLE display.commands IS 'Durable command queue - app inserts commands, device polls and acks';
COMMENT ON COLUMN display.commands.status IS 'pending=waiting for device, acked=completed, failed=device reported error, expired=timed out';
COMMENT ON COLUMN display.commands.expires_at IS 'Commands expire after 5 minutes by default';

-- =============================================================================
-- Part 3: Command Cleanup Function
-- =============================================================================

-- Function to clean up old/expired commands
CREATE OR REPLACE FUNCTION display.cleanup_old_commands()
RETURNS INTEGER AS $$
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION display.cleanup_old_commands() IS 'Marks expired pending commands and deletes old completed ones';

-- =============================================================================
-- Part 4: Helper Function for Connection Timeout Detection
-- =============================================================================

-- Function to mark connections as disconnected if no heartbeat
CREATE OR REPLACE FUNCTION display.check_connection_timeouts(timeout_seconds INTEGER DEFAULT 60)
RETURNS INTEGER AS $$
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION display.check_connection_timeouts(INTEGER) IS 'Marks connections as disconnected if no heartbeat within timeout seconds';

-- =============================================================================
-- Part 5: Rate Limiting Table for Edge Functions
-- =============================================================================

CREATE TABLE display.rate_limits (
    key TEXT PRIMARY KEY,           -- e.g., "device:A1B2C3D4:post-state"
    request_count INTEGER DEFAULT 1,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cleanup
CREATE INDEX idx_rate_limits_updated ON display.rate_limits(updated_at);

-- Cleanup function for old rate limit entries
CREATE OR REPLACE FUNCTION display.cleanup_rate_limits()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete entries older than 2 minutes (rate window is 1 minute)
    DELETE FROM display.rate_limits 
    WHERE updated_at < NOW() - INTERVAL '2 minutes';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Rate limit check/increment function
-- Returns TRUE if request should be allowed, FALSE if rate limited
CREATE OR REPLACE FUNCTION display.check_rate_limit(
    rate_key TEXT,
    max_requests INTEGER DEFAULT 12,
    window_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
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
$$ LANGUAGE plpgsql;

-- Enable RLS on rate_limits
ALTER TABLE display.rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service role can access rate limits
CREATE POLICY "rate_limits_service_only" ON display.rate_limits
    FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE display.rate_limits IS 'Rate limiting state for Edge Functions';
COMMENT ON FUNCTION display.check_rate_limit(TEXT, INTEGER, INTEGER) IS 'Returns TRUE if request allowed, FALSE if rate limited';

-- Public schema wrapper for RPC access from Edge Functions
CREATE OR REPLACE FUNCTION public.display_check_rate_limit(
    rate_key TEXT,
    max_requests INTEGER DEFAULT 12,
    window_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN display.check_rate_limit(rate_key, max_requests, window_seconds);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION public.display_check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
