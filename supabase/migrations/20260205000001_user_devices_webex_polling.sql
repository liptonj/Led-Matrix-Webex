-- Migration: Add webex_polling_enabled to user_devices
-- Allows users to toggle automatic Webex status polling per device

ALTER TABLE display.user_devices 
  ADD COLUMN webex_polling_enabled BOOLEAN NOT NULL DEFAULT false;

-- Add index for efficient queries in webex-status-sweep
CREATE INDEX user_devices_polling_enabled_idx 
  ON display.user_devices (user_id) 
  WHERE webex_polling_enabled = true;

COMMENT ON COLUMN display.user_devices.webex_polling_enabled IS 
  'When true, webex-status-sweep will poll Webex status for this device using the owner user token';
