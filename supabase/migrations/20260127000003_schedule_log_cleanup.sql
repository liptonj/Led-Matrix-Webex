-- Migration: Schedule log cleanup using pg_cron (if available)
-- Falls back gracefully if pg_cron is not installed

-- =============================================================================
-- pg_cron scheduling for log retention
-- Runs daily at 3:00 AM UTC to delete logs older than 7 days
-- =============================================================================

-- Check if pg_cron extension is available and schedule cleanup
DO $$
BEGIN
    -- Check if pg_cron extension exists
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        -- Schedule daily cleanup at 3:00 AM UTC
        -- cron expression: minute hour day month day_of_week
        PERFORM cron.schedule(
            'cleanup-device-logs',          -- job name
            '0 3 * * *',                    -- daily at 3:00 AM UTC
            'SELECT display.cleanup_old_logs()'
        );
        
        RAISE NOTICE 'pg_cron job scheduled: cleanup-device-logs (daily at 3:00 AM UTC)';
    ELSE
        RAISE NOTICE 'pg_cron extension not available - use Edge Function or external scheduler for log cleanup';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not schedule pg_cron job: %. Use Edge Function cleanup-logs instead.', SQLERRM;
END $$;

-- =============================================================================
-- Alternative: Manual cleanup via RPC (for Edge Function or admin use)
-- =============================================================================

-- The display.cleanup_old_logs() function created in the previous migration
-- can be called via RPC from an Edge Function or manually by admins
