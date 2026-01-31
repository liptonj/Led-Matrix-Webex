-- Migration: Add content feeds and display pages for extensible display content
--
-- Dependencies:
--   - display schema (20260127000000_create_display_schema.sql)
--   - display.pairings table (20260128000000_add_pairings_and_commands.sql)
--   - display.update_updated_at() function (20260127000000_create_display_schema.sql)
--   - display.is_admin() function (secure_rls migrations)
--
-- This migration creates:
-- 1. display.feeds - Content feeds (news, stocks, weather, sports, etc.)
-- 2. display.feed_data - Cached feed content with TTL
-- 3. display.display_pages - Page configuration per pairing (which pages to show, order, duration)
--
-- This enables custom content beyond Webex status (news tickers, stock prices, weather, sports scores)

-- =============================================================================
-- Part 0: Verify Dependencies
-- =============================================================================

DO $$
BEGIN
    -- Verify display schema exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'display') THEN
        RAISE EXCEPTION 'Missing dependency: display schema does not exist';
    END IF;
    
    -- Verify pairings table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'display' AND table_name = 'pairings') THEN
        RAISE EXCEPTION 'Missing dependency: display.pairings table does not exist';
    END IF;
    
    -- Verify update_updated_at function exists
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid 
                   WHERE n.nspname = 'display' AND p.proname = 'update_updated_at') THEN
        RAISE EXCEPTION 'Missing dependency: display.update_updated_at() function does not exist';
    END IF;
END $$;

-- =============================================================================
-- Part 1: display.feeds - Feed Definitions
-- =============================================================================

CREATE TABLE display.feeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pairing_code TEXT NOT NULL REFERENCES display.pairings(pairing_code) ON DELETE CASCADE,
    
    -- Feed identification
    feed_type TEXT NOT NULL CHECK (feed_type IN ('news', 'stocks', 'weather', 'sports', 'custom')),
    feed_name TEXT NOT NULL,  -- User-friendly name (e.g., "Tech News", "AAPL Stock", "Local Weather")
    
    -- Feed configuration (JSONB for flexibility)
    config JSONB DEFAULT '{}'::jsonb,  -- API keys, locations, symbols, etc.
    
    -- Feed status
    enabled BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0,  -- Lower number = higher priority (shown first)
    
    -- Update frequency
    update_interval_seconds INTEGER DEFAULT 300,  -- How often to fetch new data (5 min default)
    cache_ttl_seconds INTEGER DEFAULT 600,       -- How long cached data is valid (10 min default)
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_fetched_at TIMESTAMPTZ,
    last_successful_fetch_at TIMESTAMPTZ,
    
    -- Error tracking
    consecutive_failures INTEGER DEFAULT 0,
    last_error TEXT
);

-- Indexes
CREATE INDEX idx_feeds_pairing ON display.feeds(pairing_code);
CREATE INDEX idx_feeds_pairing_enabled ON display.feeds(pairing_code, enabled, priority) 
    WHERE enabled = TRUE;
CREATE INDEX idx_feeds_type ON display.feeds(feed_type);
CREATE INDEX idx_feeds_fetch ON display.feeds(last_fetched_at, update_interval_seconds)
    WHERE enabled = TRUE;

-- Updated_at trigger
CREATE TRIGGER feeds_updated_at
    BEFORE UPDATE ON display.feeds
    FOR EACH ROW EXECUTE FUNCTION display.update_updated_at();

COMMENT ON TABLE display.feeds IS 'Content feed definitions - news, stocks, weather, sports, etc.';
COMMENT ON COLUMN display.feeds.feed_type IS 'Type of feed: news, stocks, weather, sports, custom';
COMMENT ON COLUMN display.feeds.config IS 'Feed-specific configuration (API keys, locations, symbols, URLs, etc.)';
COMMENT ON COLUMN display.feeds.priority IS 'Display priority - lower numbers shown first';
COMMENT ON COLUMN display.feeds.update_interval_seconds IS 'How often to fetch new data from source';
COMMENT ON COLUMN display.feeds.cache_ttl_seconds IS 'How long cached data remains valid';

-- =============================================================================
-- Part 2: display.feed_data - Cached Feed Content
-- =============================================================================

CREATE TABLE display.feed_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feed_id UUID NOT NULL REFERENCES display.feeds(id) ON DELETE CASCADE,
    
    -- Content data (flexible JSONB structure)
    content JSONB NOT NULL DEFAULT '{}'::jsonb,  -- Actual feed content (headlines, prices, scores, etc.)
    
    -- Metadata
    content_hash TEXT,  -- Hash of content for change detection
    content_version INTEGER DEFAULT 1,  -- Increments on each update
    
    -- Timestamps
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,  -- When this data expires
    
    -- Status
    is_valid BOOLEAN DEFAULT TRUE  -- False if fetch failed or data is stale
);

-- Indexes for efficient queries
CREATE INDEX idx_feed_data_feed ON display.feed_data(feed_id, fetched_at DESC);
CREATE INDEX idx_feed_data_expires ON display.feed_data(expires_at) WHERE is_valid = TRUE;
CREATE INDEX idx_feed_data_valid ON display.feed_data(feed_id, is_valid, fetched_at DESC)
    WHERE is_valid = TRUE;

-- Function to get latest valid feed data
CREATE OR REPLACE FUNCTION display.get_latest_feed_data(p_feed_id UUID)
RETURNS display.feed_data AS $$
    SELECT * FROM display.feed_data
    WHERE feed_id = p_feed_id
    AND is_valid = TRUE
    AND expires_at > NOW()
    ORDER BY fetched_at DESC
    LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON TABLE display.feed_data IS 'Cached feed content with TTL - stores actual headlines, prices, scores, etc.';
COMMENT ON COLUMN display.feed_data.content IS 'Feed content as JSONB (structure varies by feed_type)';
COMMENT ON COLUMN display.feed_data.content_hash IS 'Hash of content for change detection (avoid duplicate storage)';

-- =============================================================================
-- Part 3: display.display_pages - Page Configuration
-- =============================================================================

CREATE TABLE display.display_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pairing_code TEXT NOT NULL REFERENCES display.pairings(pairing_code) ON DELETE CASCADE,
    
    -- Page identification
    page_type TEXT NOT NULL CHECK (page_type IN ('status', 'sensors', 'in_call', 'feed', 'custom')),
    page_name TEXT NOT NULL,  -- User-friendly name
    
    -- Page configuration
    enabled BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,  -- Order in rotation (lower = shown first)
    display_duration_ms INTEGER DEFAULT 5000,  -- How long to show this page (ms)
    
    -- Feed association (if page_type = 'feed')
    feed_id UUID REFERENCES display.feeds(id) ON DELETE SET NULL,
    
    -- Custom content (if page_type = 'custom')
    custom_content JSONB DEFAULT '{}'::jsonb,  -- Static content, templates, etc.
    
    -- Display settings
    show_always BOOLEAN DEFAULT FALSE,  -- If true, always show (don't rotate)
    show_conditions JSONB DEFAULT '{}'::jsonb,  -- Conditions for showing (e.g., {"time_of_day": "09:00-17:00"})
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint for conflict resolution
CREATE UNIQUE INDEX idx_display_pages_unique ON display.display_pages(pairing_code, page_type)
    WHERE page_type IN ('status', 'sensors', 'in_call');  -- Only unique for core page types

-- Indexes
CREATE INDEX idx_display_pages_pairing ON display.display_pages(pairing_code);
CREATE INDEX idx_display_pages_pairing_enabled ON display.display_pages(pairing_code, enabled, display_order)
    WHERE enabled = TRUE;
CREATE INDEX idx_display_pages_feed ON display.display_pages(feed_id) WHERE feed_id IS NOT NULL;

-- Updated_at trigger
CREATE TRIGGER display_pages_updated_at
    BEFORE UPDATE ON display.display_pages
    FOR EACH ROW EXECUTE FUNCTION display.update_updated_at();

COMMENT ON TABLE display.display_pages IS 'Page configuration - defines which pages to show and in what order';
COMMENT ON COLUMN display.display_pages.page_type IS 'Type: status, sensors, in_call, feed, custom';
COMMENT ON COLUMN display.display_pages.display_order IS 'Order in page rotation (0 = first)';
COMMENT ON COLUMN display.display_pages.display_duration_ms IS 'How long to display this page before rotating';
COMMENT ON COLUMN display.display_pages.show_always IS 'If true, always show this page (e.g., status page)';
COMMENT ON COLUMN display.display_pages.show_conditions IS 'JSON conditions for when to show (time-based, event-based, etc.)';

-- =============================================================================
-- Part 4: Helper Functions
-- =============================================================================

-- Function to get active pages for a pairing (ordered)
CREATE OR REPLACE FUNCTION display.get_active_pages(p_pairing_code TEXT)
RETURNS TABLE (
    id UUID,
    page_type TEXT,
    page_name TEXT,
    display_order INTEGER,
    display_duration_ms INTEGER,
    feed_id UUID,
    custom_content JSONB,
    show_always BOOLEAN
) AS $$
    SELECT 
        dp.id,
        dp.page_type,
        dp.page_name,
        dp.display_order,
        dp.display_duration_ms,
        dp.feed_id,
        dp.custom_content,
        dp.show_always
    FROM display.display_pages dp
    WHERE dp.pairing_code = p_pairing_code
    AND dp.enabled = TRUE
    ORDER BY dp.show_always DESC, dp.display_order ASC;
$$ LANGUAGE sql STABLE;

-- Function to get feed content for a pairing (all active feeds)
CREATE OR REPLACE FUNCTION display.get_active_feed_content(p_pairing_code TEXT)
RETURNS TABLE (
    feed_id UUID,
    feed_type TEXT,
    feed_name TEXT,
    content JSONB,
    fetched_at TIMESTAMPTZ
) AS $$
    SELECT 
        f.id,
        f.feed_type,
        f.feed_name,
        fd.content,
        fd.fetched_at
    FROM display.feeds f
    LEFT JOIN LATERAL (
        SELECT * FROM display.get_latest_feed_data(f.id)
    ) fd ON TRUE
    WHERE f.pairing_code = p_pairing_code
    AND f.enabled = TRUE
    ORDER BY f.priority ASC;
$$ LANGUAGE sql STABLE;

-- Function to mark feed data as expired
CREATE OR REPLACE FUNCTION display.expire_feed_data()
RETURNS INTEGER AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE display.feed_data
    SET is_valid = FALSE
    WHERE expires_at < NOW()
    AND is_valid = TRUE;
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Part 5: RLS Policies
-- =============================================================================

-- Enable RLS
ALTER TABLE display.feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE display.feed_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE display.display_pages ENABLE ROW LEVEL SECURITY;

-- Service role: full access for Edge Functions
CREATE POLICY "feeds_service_full" ON display.feeds
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "feed_data_service_full" ON display.feed_data
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "display_pages_service_full" ON display.display_pages
    FOR ALL USING (auth.role() = 'service_role');

-- Admins: full access
CREATE POLICY "feeds_admin_all" ON display.feeds
    FOR ALL USING (display.is_admin());

CREATE POLICY "feed_data_admin_all" ON display.feed_data
    FOR ALL USING (display.is_admin());

CREATE POLICY "display_pages_admin_all" ON display.display_pages
    FOR ALL USING (display.is_admin());

-- Device access: Devices can read their own feeds and pages via JWT claims
-- The JWT contains device_id, serial_number, and pairing_code for authorization
CREATE POLICY "feeds_device_read" ON display.feeds
    FOR SELECT USING (
        pairing_code = COALESCE(
            current_setting('request.jwt.claims', true)::json->>'pairing_code',
            ''
        )
    );

CREATE POLICY "feed_data_device_read" ON display.feed_data
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM display.feeds f
            WHERE f.id = display.feed_data.feed_id
            AND f.pairing_code = COALESCE(
                current_setting('request.jwt.claims', true)::json->>'pairing_code',
                ''
            )
        )
    );

CREATE POLICY "display_pages_device_read" ON display.display_pages
    FOR SELECT USING (
        pairing_code = COALESCE(
            current_setting('request.jwt.claims', true)::json->>'pairing_code',
            ''
        )
    );

-- User access: Future - when user-pairing ownership is defined, add policies here
-- For now, users manage feeds through Edge Functions (service_role) which have full access

-- =============================================================================
-- Part 6: Enable Realtime
-- =============================================================================

-- Enable realtime for feeds and pages (for live updates)
ALTER PUBLICATION supabase_realtime ADD TABLE display.feeds;
ALTER PUBLICATION supabase_realtime ADD TABLE display.feed_data;
ALTER PUBLICATION supabase_realtime ADD TABLE display.display_pages;

-- =============================================================================
-- Part 7: Default Pages for Existing Pairings
-- =============================================================================

-- Insert default pages for existing pairings (status, sensors, in_call)
INSERT INTO display.display_pages (pairing_code, page_type, page_name, enabled, display_order, display_duration_ms, show_always)
SELECT 
    pairing_code,
    'status',
    'Status',
    TRUE,
    0,
    COALESCE((config->>'page_interval_ms')::integer, 5000),  -- Use existing config or default
    FALSE
FROM display.pairings
ON CONFLICT (pairing_code, page_type) WHERE page_type IN ('status', 'sensors', 'in_call') DO NOTHING;

-- Insert sensor pages only for pairings that have sensors configured
-- Check if sensor_page_enabled is true in config, or if MQTT broker is configured
INSERT INTO display.display_pages (pairing_code, page_type, page_name, enabled, display_order, display_duration_ms, show_always)
SELECT 
    pairing_code,
    'sensors',
    'Sensors',
    COALESCE((config->>'sensor_page_enabled')::boolean, TRUE),  -- Default to enabled
    1,
    5000,
    FALSE
FROM display.pairings
WHERE (config->>'sensor_page_enabled')::boolean IS NOT FALSE  -- Include if not explicitly disabled
   OR config->>'mqtt_broker' IS NOT NULL  -- Or if MQTT is configured
   OR config IS NULL  -- Or if no config yet (new pairings)
ON CONFLICT (pairing_code, page_type) WHERE page_type IN ('status', 'sensors', 'in_call') DO NOTHING;

INSERT INTO display.display_pages (pairing_code, page_type, page_name, enabled, display_order, display_duration_ms, show_always)
SELECT 
    pairing_code,
    'in_call',
    'In Call',
    TRUE,
    -1,  -- Negative order = shown when condition met (in_call = true)
    0,   -- 0 = show until condition changes
    TRUE  -- Always show when condition is met
FROM display.pairings
ON CONFLICT (pairing_code, page_type) WHERE page_type IN ('status', 'sensors', 'in_call') DO NOTHING;

COMMENT ON TABLE display.feeds IS 'Content feed definitions for news, stocks, weather, sports, etc.';
COMMENT ON TABLE display.feed_data IS 'Cached feed content with expiration - stores actual data from feeds';
COMMENT ON TABLE display.display_pages IS 'Page configuration - defines which pages to show, order, and duration';
