-- Migration: Add RLS DELETE policy for admins on devices table
-- Created: 2026-02-04
-- Purpose: Allow admins to delete devices from the admin dashboard

-- Add DELETE policy for admins on devices table
CREATE POLICY "devices_admin_delete" ON display.devices
    FOR DELETE 
    USING (display.is_admin());

-- Verify policy was created
COMMENT ON POLICY "devices_admin_delete" ON display.devices IS 
    'Allow admins to delete devices. Related records (device_logs, user_devices, pairings) cascade automatically via ON DELETE CASCADE constraints.';
