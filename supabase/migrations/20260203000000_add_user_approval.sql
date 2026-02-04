-- Migration: Add user approval fields to devices table
-- Tracks which user authorized each device for provisioning

-- Add user approval field to existing devices table
ALTER TABLE display.devices 
    ADD COLUMN IF NOT EXISTS user_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

COMMENT ON COLUMN display.devices.user_approved_by IS 'User who authorized this device (NULL = not approved yet)';
COMMENT ON COLUMN display.devices.approved_at IS 'When device was approved by user';
