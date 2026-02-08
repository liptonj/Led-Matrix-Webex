-- Realtime Channel Authorization Policies
-- Supabase Realtime uses RLS policies on realtime.messages to authorize
-- private channel subscriptions.

-- Enable RLS on realtime.messages (required for private channels)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Allow devices to subscribe to their user channel
-- Matches topic user:{user_uuid} against the JWT user_uuid claim
CREATE POLICY "Allow user channel subscriptions"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() = 'user:' || (
    (current_setting('request.jwt.claims', true)::jsonb)->>'user_uuid'
  )
);

-- Allow devices to subscribe to their device channel
-- Matches topic device:{device_uuid} against the JWT device_uuid claim
CREATE POLICY "Allow device channel subscriptions"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() = 'device:' || (
    (current_setting('request.jwt.claims', true)::jsonb)->>'device_uuid'
  )
);

-- Allow authenticated users to subscribe to support session channels
CREATE POLICY "Allow support channel subscriptions"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE 'support:%'
);

-- Allow subscriptions to pairing event channels
CREATE POLICY "Allow pairing channel subscriptions"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE 'pairing:%:events'
);

-- Allow admin users to subscribe to any channel
CREATE POLICY "Allow admin channel subscriptions"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  coalesce(
    ((current_setting('request.jwt.claims', true)::jsonb)->'app_metadata'->>'is_admin')::boolean,
    false
  ) = true
);
