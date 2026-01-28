-- Migration: Grant display schema/table privileges to API roles
-- Ensures PostgREST can access display.* with RLS enforcing permissions.

-- Allow API roles to use the schema
GRANT USAGE ON SCHEMA display TO anon, authenticated, service_role;

-- Public read access for anon clients
GRANT SELECT ON ALL TABLES IN SCHEMA display TO anon;

-- Authenticated access for admin UI (RLS still enforced)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA display TO authenticated;

-- Service role access for backend/CI
GRANT ALL ON ALL TABLES IN SCHEMA display TO service_role;

-- Ensure future tables inherit privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA display
  GRANT SELECT ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA display
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA display
  GRANT ALL ON TABLES TO service_role;
