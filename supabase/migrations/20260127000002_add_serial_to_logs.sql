-- Migration: Add serial_number to device_logs and enable Realtime
-- This enables efficient filtering of logs by serial_number for Supabase Realtime subscriptions

-- =============================================================================
-- Add serial_number column to device_logs
-- =============================================================================

-- Add serial_number column (nullable to allow backfill)
ALTER TABLE display.device_logs
ADD COLUMN IF NOT EXISTS serial_number TEXT;

-- Add foreign key constraint to devices table (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'device_logs_serial_number_fkey'
    ) THEN
        ALTER TABLE display.device_logs
            ADD CONSTRAINT device_logs_serial_number_fkey
            FOREIGN KEY (serial_number) REFERENCES display.devices(serial_number)
            ON DELETE CASCADE;
    END IF;
END $$;

-- Add index for efficient filtering by serial_number (used by Realtime subscriptions)
CREATE INDEX IF NOT EXISTS idx_logs_serial_time
ON display.device_logs(serial_number, created_at DESC);

-- =============================================================================
-- Backfill serial_number from devices table via device_id join
-- =============================================================================

UPDATE display.device_logs dl
SET serial_number = d.serial_number
FROM display.devices d
WHERE dl.device_id = d.device_id
  AND dl.serial_number IS NULL;

-- =============================================================================
-- Enable Supabase Realtime for device_logs table
-- This allows the admin UI to subscribe to INSERT events filtered by serial_number
-- =============================================================================

-- Enable Realtime replication for the device_logs table (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'display'
          AND tablename = 'device_logs'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE display.device_logs;
    END IF;
END $$;

-- =============================================================================
-- Log retention cleanup function (for pg_cron)
-- Deletes logs older than 7 days to prevent unbounded growth
-- =============================================================================

CREATE OR REPLACE FUNCTION display.cleanup_old_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM display.device_logs
    WHERE created_at < NOW() - INTERVAL '7 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role (for manual invocation or Edge Function)
GRANT EXECUTE ON FUNCTION display.cleanup_old_logs() TO service_role;
