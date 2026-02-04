#!/bin/bash
# Fix OAuth Callback URL - Update database to use correct unified callback

echo "Updating OAuth redirect_uri to /auth-callback..."

cat <<'EOF' | supabase db execute -
-- Update OAuth redirect_uri for user authentication
UPDATE display.oauth_clients
SET redirect_uri = 'https://display.5ls.us/auth-callback'
WHERE provider = 'webex' AND purpose = 'user';

-- Verify the update
SELECT provider, purpose, redirect_uri, active
FROM display.oauth_clients
WHERE provider = 'webex'
ORDER BY purpose;
EOF

echo "✅ OAuth callback URL updated to: https://display.5ls.us/auth-callback"
echo ""
echo "Make sure to also update Webex OAuth app settings if needed."
