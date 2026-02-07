-- Update log retention from 7 days to 30 days
CREATE OR REPLACE FUNCTION display.cleanup_old_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM display.device_logs 
    WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment explaining the retention policy
COMMENT ON FUNCTION display.cleanup_old_logs() IS 'Deletes device logs older than 30 days. Runs daily via pg_cron.';
