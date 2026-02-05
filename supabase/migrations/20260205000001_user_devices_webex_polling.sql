-- Migration: Add webex_polling_enabled to user_devices
-- Allows users to toggle automatic Webex status polling per device

-- Add column (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'display' AND table_name = 'user_devices' AND column_name = 'webex_polling_enabled'
  ) THEN
    ALTER TABLE display.user_devices 
      ADD COLUMN webex_polling_enabled BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add index for efficient queries in webex-status-sweep (idempotent)
CREATE INDEX IF NOT EXISTS user_devices_polling_enabled_idx 
  ON display.user_devices (user_id) 
  WHERE webex_polling_enabled = true;

COMMENT ON COLUMN display.user_devices.webex_polling_enabled IS 
  'When true, webex-status-sweep will poll Webex status for this device using the owner user token';
