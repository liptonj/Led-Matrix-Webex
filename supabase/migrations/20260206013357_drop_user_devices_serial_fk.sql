-- Migration: Drop serial_number FK from user_devices
--
-- The user_devices table has TWO foreign keys to devices:
--   1. user_devices_serial_number_fkey: serial_number -> devices.serial_number
--   2. user_devices_device_uuid_fkey: device_uuid -> devices.id
--
-- This causes PostgREST/Supabase to fail with an ambiguous relationship error
-- when joining user_devices -> devices in client queries.
--
-- Fix: Drop the legacy serial_number FK, keeping only the device_uuid FK.
-- The serial_number column and its UNIQUE constraint are preserved for
-- backward compatibility; only the FK constraint is removed.

ALTER TABLE display.user_devices
  DROP CONSTRAINT IF EXISTS user_devices_serial_number_fkey;
