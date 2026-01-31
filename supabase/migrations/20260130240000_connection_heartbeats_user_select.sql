-- Migration: Allow admin/assigned users to read connection heartbeats
-- Uses existing helper functions to enforce per-user access.

DROP POLICY IF EXISTS "connection_heartbeats_user_select" ON display.connection_heartbeats;
CREATE POLICY "connection_heartbeats_user_select"
    ON display.connection_heartbeats
    FOR SELECT
    USING (
        display.is_admin()
        OR EXISTS (
            SELECT 1
            FROM display.pairings p
            WHERE p.pairing_code = connection_heartbeats.pairing_code
              AND display.user_can_access_device(p.serial_number)
        )
    );
