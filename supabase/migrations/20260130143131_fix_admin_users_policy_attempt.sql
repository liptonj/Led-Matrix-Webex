-- Migration: Attempted fix for admin_users_admin_read policy recursion
--
-- This migration was applied directly to the database but immediately replaced
-- by 20260130143142_fix_admin_users_policy_no_recursion.sql (11 seconds later).
--
-- The original policy in 20260127000004_secure_rls.sql had a recursive check:
--   EXISTS (SELECT 1 FROM display.admin_users au WHERE au.user_id = auth.uid())
-- This caused infinite recursion when checking admin status.
--
-- This migration attempted to fix it but was quickly superseded by the correct fix.
-- The correct fix (20260130143142) drops admin_users_admin_read and creates
-- admin_users_self_read with auth.uid() = user_id (non-recursive).
--
-- Note: This migration file is reconstructed based on migration history.
-- The actual SQL that was applied may have differed slightly, but this represents
-- the most likely attempt that still had recursion issues.

-- Attempt to fix the recursive policy (this version likely still had recursion)
DROP POLICY IF EXISTS "admin_users_admin_read" ON display.admin_users;

-- Likely attempted fix that still had recursion (recreated based on context)
-- The actual SQL may have been slightly different, but this represents the pattern
CREATE POLICY "admin_users_admin_read" ON display.admin_users
    FOR SELECT USING (
        auth.role() = 'service_role'
        OR EXISTS (SELECT 1 FROM display.admin_users au WHERE au.user_id = auth.uid())
    );
