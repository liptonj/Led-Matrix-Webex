-- Migration: Create OAuth state table for PKCE flow
-- Stores temporary OAuth state and code verifiers for secure OAuth flows

-- OAuth state storage for PKCE flow
CREATE TABLE IF NOT EXISTS display.oauth_state (
    state_key TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-cleanup expired state
CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON display.oauth_state(expires_at);

-- RLS: only service role can access
ALTER TABLE display.oauth_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oauth_state_service_only" ON display.oauth_state;
CREATE POLICY "oauth_state_service_only" ON display.oauth_state
    FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE display.oauth_state IS 'Temporary storage for OAuth PKCE state (auto-cleaned)';
COMMENT ON COLUMN display.oauth_state.state_key IS 'OAuth state parameter (PKCE)';
COMMENT ON COLUMN display.oauth_state.code_verifier IS 'PKCE code verifier (hashed to create challenge)';
COMMENT ON COLUMN display.oauth_state.expires_at IS 'When this state expires (typically 10 minutes)';
