-- Allow service_role to upload firmware (required for CI/CD)
-- =============================================================================

-- Drop existing policy and recreate with service_role support
DROP POLICY IF EXISTS "firmware_admin_write" ON storage.objects;

-- Allow both authenticated users (admin dashboard) and service_role (CI/CD) to upload
CREATE POLICY "firmware_admin_write" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'firmware' AND 
        (auth.role() = 'authenticated' OR auth.role() = 'service_role')
    );

-- Also allow service_role to update firmware files (for overwriting existing versions)
CREATE POLICY "firmware_service_update" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'firmware' AND auth.role() = 'service_role'
    );
