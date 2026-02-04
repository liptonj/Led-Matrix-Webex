-- Allow users to delete their own device assignments
-- This enables the "Remove Device" feature in the user dashboard

DROP POLICY IF EXISTS "user_devices_self_delete" ON display.user_devices;

CREATE POLICY "user_devices_self_delete" ON display.user_devices
    FOR DELETE USING (user_id = auth.uid());

COMMENT ON POLICY "user_devices_self_delete" ON display.user_devices IS 
  'Users can remove their own device assignments (does not delete the device itself)';
