-- Migration: Add provisioning method tracking to user_devices
-- Records how each device was provisioned to a user

-- Add provisioning method tracking
ALTER TABLE display.user_devices
    ADD COLUMN IF NOT EXISTS provisioning_method TEXT,
    ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN display.user_devices.provisioning_method IS 'How device was provisioned: user_approved, web_flash, etc';
COMMENT ON COLUMN display.user_devices.provisioned_at IS 'When device was provisioned to this user';
