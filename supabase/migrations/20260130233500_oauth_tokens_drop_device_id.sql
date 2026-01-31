-- Drop device_id from oauth_tokens; serial_number is now canonical

DROP POLICY IF EXISTS oauth_tokens_device_select ON display.oauth_tokens;
DROP POLICY IF EXISTS oauth_tokens_device_insert ON display.oauth_tokens;
DROP POLICY IF EXISTS oauth_tokens_device_update ON display.oauth_tokens;
DROP POLICY IF EXISTS oauth_tokens_device_delete ON display.oauth_tokens;

DROP INDEX IF EXISTS display.oauth_tokens_device_id_idx;

ALTER TABLE display.oauth_tokens
  DROP COLUMN IF EXISTS device_id;

DO $$
BEGIN
  CREATE POLICY oauth_tokens_device_select
    ON display.oauth_tokens
    FOR SELECT
    USING (
      (auth.jwt() ->> 'serial_number') is not null and (auth.jwt() ->> 'serial_number') = serial_number
      or (auth.jwt() ->> 'pairing_code') is not null and (auth.jwt() ->> 'pairing_code') = pairing_code
    );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY oauth_tokens_device_insert
    ON display.oauth_tokens
    FOR INSERT
    WITH CHECK (
      (auth.jwt() ->> 'serial_number') is not null and (auth.jwt() ->> 'serial_number') = serial_number
      or (auth.jwt() ->> 'pairing_code') is not null and (auth.jwt() ->> 'pairing_code') = pairing_code
    );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY oauth_tokens_device_update
    ON display.oauth_tokens
    FOR UPDATE
    USING (
      (auth.jwt() ->> 'serial_number') is not null and (auth.jwt() ->> 'serial_number') = serial_number
      or (auth.jwt() ->> 'pairing_code') is not null and (auth.jwt() ->> 'pairing_code') = pairing_code
    )
    WITH CHECK (
      (auth.jwt() ->> 'serial_number') is not null and (auth.jwt() ->> 'serial_number') = serial_number
      or (auth.jwt() ->> 'pairing_code') is not null and (auth.jwt() ->> 'pairing_code') = pairing_code
    );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY oauth_tokens_device_delete
    ON display.oauth_tokens
    FOR DELETE
    USING (
      (auth.jwt() ->> 'serial_number') is not null and (auth.jwt() ->> 'serial_number') = serial_number
      or (auth.jwt() ->> 'pairing_code') is not null and (auth.jwt() ->> 'pairing_code') = pairing_code
    );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
