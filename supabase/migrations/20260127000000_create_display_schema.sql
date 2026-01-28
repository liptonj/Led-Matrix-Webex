-- Migration: Create display schema for LED Matrix Webex Display
-- This schema is isolated from other projects on the same Supabase instance

-- Create the display schema
CREATE SCHEMA IF NOT EXISTS display;

-- =============================================================================
-- Table: display.devices
-- Stores device registration with persistent pairing codes and HMAC auth
-- =============================================================================
CREATE TABLE display.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_number TEXT UNIQUE NOT NULL,          -- CRC32 of eFuse MAC (8 hex chars)
    device_id TEXT UNIQUE NOT NULL,              -- Formatted ID (webex-display-XXXX)
    pairing_code TEXT UNIQUE NOT NULL,           -- 6-char code (assigned once, persists forever)
    key_hash TEXT NOT NULL,                      -- SHA256 hash of device secret (for HMAC validation)
    display_name TEXT,                           -- User-friendly name
    firmware_version TEXT,
    target_firmware_version TEXT,                -- Admin sets target for rollout
    ip_address INET,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    last_auth_timestamp BIGINT,                  -- Last used timestamp (replay protection)
    debug_enabled BOOLEAN DEFAULT FALSE,         -- Enable debug logging to bridge
    is_provisioned BOOLEAN DEFAULT FALSE,        -- True after first successful auth
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    provisioned_at TIMESTAMPTZ,                  -- When device first connected
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for devices table
CREATE INDEX idx_devices_serial ON display.devices(serial_number);
CREATE INDEX idx_devices_pairing_code ON display.devices(pairing_code);
CREATE INDEX idx_devices_debug ON display.devices(debug_enabled) WHERE debug_enabled = TRUE;
CREATE INDEX idx_devices_provisioned ON display.devices(is_provisioned);

-- Trigger to update updated_at automatically
CREATE OR REPLACE FUNCTION display.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER devices_updated_at
    BEFORE UPDATE ON display.devices
    FOR EACH ROW EXECUTE FUNCTION display.update_updated_at();

-- =============================================================================
-- Table: display.device_logs
-- Stores debug logs from devices for troubleshooting
-- =============================================================================
CREATE TABLE display.device_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL REFERENCES display.devices(device_id) ON DELETE CASCADE,
    level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for device_logs table
CREATE INDEX idx_logs_device_time ON display.device_logs(device_id, created_at DESC);
CREATE INDEX idx_logs_created ON display.device_logs(created_at);

-- =============================================================================
-- Table: display.releases
-- Stores firmware releases for OTA updates
-- =============================================================================
CREATE TABLE display.releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version TEXT UNIQUE NOT NULL,                -- e.g., "1.4.4"
    tag TEXT UNIQUE NOT NULL,                    -- e.g., "v1.4.4"
    name TEXT,                                   -- Release name
    notes TEXT,                                  -- Release notes (markdown)
    firmware_url TEXT NOT NULL,                  -- Supabase Storage URL for OTA
    firmware_merged_url TEXT,                    -- Full flash image URL
    firmware_size INTEGER,
    build_id TEXT,
    build_date TIMESTAMPTZ,
    is_latest BOOLEAN DEFAULT FALSE,
    is_prerelease BOOLEAN DEFAULT FALSE,
    rollout_percentage INTEGER DEFAULT 100 CHECK (rollout_percentage BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Indexes for releases table
CREATE INDEX idx_releases_version ON display.releases(version);
CREATE INDEX idx_releases_latest ON display.releases(is_latest) WHERE is_latest = TRUE;

-- Ensure only one release is marked as latest
CREATE OR REPLACE FUNCTION display.ensure_single_latest()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_latest = TRUE THEN
        UPDATE display.releases SET is_latest = FALSE WHERE id != NEW.id AND is_latest = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER releases_single_latest
    BEFORE INSERT OR UPDATE ON display.releases
    FOR EACH ROW WHEN (NEW.is_latest = TRUE)
    EXECUTE FUNCTION display.ensure_single_latest();

-- =============================================================================
-- Row Level Security (RLS) Policies
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE display.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE display.device_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE display.releases ENABLE ROW LEVEL SECURITY;

-- Devices: service role and authenticated access only (no public read)
CREATE POLICY "devices_service_write" ON display.devices
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "devices_admin_write" ON display.devices
    FOR ALL USING (auth.role() = 'authenticated');

-- Device logs: authenticated read, service role insert
CREATE POLICY "logs_admin_read" ON display.device_logs
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "logs_service_insert" ON display.device_logs
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Releases: public read, authenticated write
CREATE POLICY "releases_public_read" ON display.releases
    FOR SELECT USING (true);

CREATE POLICY "releases_admin_write" ON display.releases
    FOR ALL USING (auth.role() = 'authenticated');

-- =============================================================================
-- Storage Bucket for Firmware
-- =============================================================================

-- Create private firmware bucket (devices access via signed URLs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('firmware', 'firmware', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: only service role can read, authenticated can upload
CREATE POLICY "firmware_service_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'firmware' AND auth.role() = 'service_role');

CREATE POLICY "firmware_admin_write" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'firmware' AND auth.role() = 'authenticated');

CREATE POLICY "firmware_admin_delete" ON storage.objects
    FOR DELETE USING (bucket_id = 'firmware' AND auth.role() = 'authenticated');
