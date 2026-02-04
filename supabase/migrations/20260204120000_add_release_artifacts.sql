-- Add release_artifacts table for multi-board firmware support
-- Allows dynamic board types without schema changes

CREATE TABLE IF NOT EXISTS display.release_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES display.releases(id) ON DELETE CASCADE,
  
  -- Board identification
  board_type TEXT NOT NULL,      -- 'esp32s3', 'esp32s2', 'esp32' (normalized, no hyphens)
  chip_family TEXT NOT NULL,     -- 'ESP32-S3', 'ESP32-S2', 'ESP32' (for ESP Web Tools)
  
  -- Firmware URLs and metadata
  firmware_url TEXT NOT NULL,           -- OTA firmware binary URL
  firmware_merged_url TEXT,             -- Full merged binary for web installer
  firmware_size INTEGER,                -- Size in bytes
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(release_id, board_type)
);

-- Indexes for fast lookups
CREATE INDEX idx_release_artifacts_release ON display.release_artifacts(release_id);
CREATE INDEX idx_release_artifacts_board ON display.release_artifacts(board_type);
CREATE INDEX idx_release_artifacts_composite ON display.release_artifacts(release_id, board_type);

-- Enable RLS
ALTER TABLE display.release_artifacts ENABLE ROW LEVEL SECURITY;

-- RLS Policies (public read access, service role for writes)
CREATE POLICY "Public read access to release artifacts"
  ON display.release_artifacts
  FOR SELECT
  USING (true);

CREATE POLICY "Service role full access to release artifacts"
  ON display.release_artifacts
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Function to automatically update updated_at
CREATE OR REPLACE FUNCTION display.update_release_artifacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_release_artifacts_updated_at
  BEFORE UPDATE ON display.release_artifacts
  FOR EACH ROW
  EXECUTE FUNCTION display.update_release_artifacts_updated_at();

-- Grant necessary permissions
GRANT SELECT ON display.release_artifacts TO anon, authenticated;
GRANT ALL ON display.release_artifacts TO service_role;

-- Comment on table and columns for documentation
COMMENT ON TABLE display.release_artifacts IS 'Stores firmware binaries for each board type per release version. Enables multi-board support without schema changes.';
COMMENT ON COLUMN display.release_artifacts.board_type IS 'Normalized board identifier without hyphens (e.g., esp32s3, esp32s2)';
COMMENT ON COLUMN display.release_artifacts.chip_family IS 'Chip family name for ESP Web Tools manifest (e.g., ESP32-S3, ESP32-S2)';
COMMENT ON COLUMN display.release_artifacts.firmware_url IS 'URL to OTA firmware binary (firmware-{board}.bin)';
COMMENT ON COLUMN display.release_artifacts.firmware_merged_url IS 'URL to merged binary for web installer (firmware-merged-{board}.bin)';
