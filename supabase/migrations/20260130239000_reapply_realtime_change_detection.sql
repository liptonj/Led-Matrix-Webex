-- Re-apply realtime change detection/connection_heartbeats pieces if missing.
-- This migration exists because the original 20260130210000 did not run on remote.

-- =============================================================================
-- Part 0: Create connection_heartbeats table for connection tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS display.connection_heartbeats (
    pairing_code TEXT PRIMARY KEY REFERENCES display.pairings(pairing_code) ON DELETE CASCADE,
    app_last_seen TIMESTAMPTZ,
    app_connected BOOLEAN DEFAULT FALSE,
    device_last_seen TIMESTAMPTZ,
    device_connected BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE display.connection_heartbeats IS 'Tracks app/device connection state separately from status. Updates to this table do NOT trigger realtime notifications to devices.';

-- Ensure updated_at trigger exists
DROP TRIGGER IF EXISTS connection_heartbeats_updated_at ON display.connection_heartbeats;
CREATE TRIGGER connection_heartbeats_updated_at
    BEFORE UPDATE ON display.connection_heartbeats
    FOR EACH ROW
    EXECUTE FUNCTION display.update_updated_at();

-- Enable RLS
ALTER TABLE display.connection_heartbeats ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'display' AND tablename = 'connection_heartbeats'
      AND policyname = 'Devices can read own heartbeat'
  ) THEN
    CREATE POLICY "Devices can read own heartbeat"
      ON display.connection_heartbeats FOR SELECT
      USING (
        pairing_code = current_setting('request.jwt.claims', true)::json->>'pairing_code'
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'display' AND tablename = 'connection_heartbeats'
      AND policyname = 'Service role full access to heartbeats'
  ) THEN
    CREATE POLICY "Service role full access to heartbeats"
      ON display.connection_heartbeats FOR ALL
      USING (
        current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_heartbeats_pairing ON display.connection_heartbeats(pairing_code);

-- Backfill from pairings
INSERT INTO display.connection_heartbeats (pairing_code, app_last_seen, app_connected, device_last_seen, device_connected)
SELECT pairing_code, app_last_seen, app_connected, device_last_seen, device_connected
FROM display.pairings
WHERE pairing_code IS NOT NULL
ON CONFLICT (pairing_code) DO UPDATE SET
    app_last_seen = EXCLUDED.app_last_seen,
    app_connected = EXCLUDED.app_connected,
    device_last_seen = EXCLUDED.device_last_seen,
    device_connected = EXCLUDED.device_connected;

-- =============================================================================
-- Part 1: status_updated_at column for change detection
-- =============================================================================
ALTER TABLE display.pairings
    ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

UPDATE display.pairings
SET status_updated_at = COALESCE(updated_at, created_at, NOW())
WHERE status_updated_at IS NULL;

ALTER TABLE display.pairings
    ALTER COLUMN status_updated_at SET DEFAULT NOW();

COMMENT ON COLUMN display.pairings.status_updated_at IS 'Timestamp when status-relevant fields last changed (webex_status, camera_on, mic_muted, in_call, display_name). Used for realtime filtering.';

-- =============================================================================
-- Part 2: Trigger function for status change detection
-- =============================================================================
CREATE OR REPLACE FUNCTION display.update_status_timestamp()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pairings_status_change ON display.pairings;
CREATE TRIGGER pairings_status_change
    BEFORE UPDATE ON display.pairings
    FOR EACH ROW
    EXECUTE FUNCTION display.update_status_timestamp();

COMMENT ON FUNCTION display.update_status_timestamp() IS 'Updates status_updated_at only when status-relevant fields change, preventing heartbeat-only updates from triggering realtime notifications.';

-- =============================================================================
-- Part 3: Index for filtering
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_pairings_status_updated
    ON display.pairings(pairing_code, status_updated_at DESC);

-- =============================================================================
-- Part 4: Helper function for change detection
-- =============================================================================
CREATE OR REPLACE FUNCTION display.status_values_changed(
    p_pairing_code TEXT,
    p_webex_status TEXT DEFAULT NULL,
    p_camera_on BOOLEAN DEFAULT NULL,
    p_mic_muted BOOLEAN DEFAULT NULL,
    p_in_call BOOLEAN DEFAULT NULL,
    p_display_name TEXT DEFAULT NULL,
    p_app_connected BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN AS $$
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
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION display.status_values_changed(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) IS
'Returns TRUE if the provided status values differ from current values in the pairings table.
Used by Edge Functions to avoid unnecessary database updates that would trigger realtime notifications.

Parameter behavior:
- NULL (default): Field is not being updated, skip comparison
- FALSE: Field is being set to FALSE, compare against current value
- TRUE: Field is being set to TRUE, compare against current value

Note: device_connected is NOT included because this function is called by the embedded app,
which cannot change the device connection state.';

DROP FUNCTION IF EXISTS display.status_values_changed(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT);
GRANT EXECUTE ON FUNCTION display.status_values_changed(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) TO service_role;

-- =============================================================================
-- Part 5: Deprecated columns comments
-- =============================================================================
COMMENT ON COLUMN display.pairings.app_last_seen IS 'DEPRECATED: Use connection_heartbeats.app_last_seen instead. Kept for backwards compatibility.';
COMMENT ON COLUMN display.pairings.device_last_seen IS 'DEPRECATED: Use connection_heartbeats.device_last_seen instead. Kept for backwards compatibility.';
COMMENT ON COLUMN display.pairings.app_connected IS 'App connection state. Updated via Edge Functions. Note: For heartbeat tracking, use connection_heartbeats table to avoid triggering realtime.';
COMMENT ON COLUMN display.pairings.device_connected IS 'Device connection state. Note: For heartbeat tracking, use connection_heartbeats table to avoid triggering realtime.';
