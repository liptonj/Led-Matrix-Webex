-- Migration: Update user_can_access_device() function to support UUID and serial_number
-- Phase 1: UUID-based device identity architecture
--
-- This migration updates the user_can_access_device() helper function to accept
-- either serial_number (TEXT) or device_uuid (UUID) parameters.
--
-- The function maintains backward compatibility with existing serial_number-based
-- calls while adding support for UUID-based lookups.
--
-- Function overloads:
-- - user_can_access_device(target_serial TEXT) - existing signature
-- - user_can_access_device(target_uuid UUID) - new UUID-based signature

-- =============================================================================
-- Update user_can_access_device function with UUID support
-- =============================================================================

-- Drop existing function to recreate with overloads
DROP FUNCTION IF EXISTS display.user_can_access_device(TEXT);

-- Function for serial_number (backward compatibility)
CREATE OR REPLACE FUNCTION display.user_can_access_device(target_serial TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF display.is_admin() THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM display.user_devices ud
        JOIN display.user_profiles up ON up.user_id = ud.user_id
        WHERE ud.user_id = auth.uid()
        AND ud.serial_number = target_serial
        AND up.disabled = FALSE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function for device_uuid (new UUID-based lookup)
CREATE OR REPLACE FUNCTION display.user_can_access_device(target_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    IF display.is_admin() THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM display.user_devices ud
        JOIN display.user_profiles up ON up.user_id = ud.user_id
        WHERE ud.user_id = auth.uid()
        AND ud.device_uuid = target_uuid
        AND up.disabled = FALSE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION display.user_can_access_device(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION display.user_can_access_device(UUID) TO authenticated;

COMMENT ON FUNCTION display.user_can_access_device(TEXT) IS 
  'Returns true if current user can access device by serial_number (admin or assigned). '
  'Maintains backward compatibility.';
COMMENT ON FUNCTION display.user_can_access_device(UUID) IS 
  'Returns true if current user can access device by device_uuid (admin or assigned). '
  'UUID-based lookup for Phase 1 migration.';
