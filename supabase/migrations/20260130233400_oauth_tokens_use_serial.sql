-- Use serial_number as the canonical key for OAuth tokens
-- (device_id is retained as metadata only)

DROP INDEX IF EXISTS display.oauth_tokens_provider_device_idx;

CREATE UNIQUE INDEX IF NOT EXISTS oauth_tokens_provider_serial_idx
  ON display.oauth_tokens (provider, serial_number);
