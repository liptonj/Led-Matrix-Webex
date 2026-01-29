-- Migration: Add admin control flags for device access

ALTER TABLE display.devices
    ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS disabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS blacklisted BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_devices_approval_required
    ON display.devices(approval_required)
    WHERE approval_required = TRUE;

CREATE INDEX IF NOT EXISTS idx_devices_disabled
    ON display.devices(disabled)
    WHERE disabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_devices_blacklisted
    ON display.devices(blacklisted)
    WHERE blacklisted = TRUE;
