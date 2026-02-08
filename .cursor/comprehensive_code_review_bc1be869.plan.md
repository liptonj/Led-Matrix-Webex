---
name: Comprehensive Code Review
overview: Full code review of the realtime-first architecture implementation. Identifies remaining issues across firmware, website, Edge Functions, and database -- categorized as critical bugs, code quality improvements, and cleanup items.
todos:
  - id: fix-realtime-rls-policies
    content: "CRITICAL: Create RLS policies on realtime.messages to authorize private channel access for both device JWTs and user sessions"
    status: pending
  - id: fix-website-private-channel
    content: "CRITICAL: Add private: true to website channel subscriptions (usePairing + useWebexStatus)"
    status: pending
  - id: fix-firmware-user-uuid-polling
    content: "CRITICAL: Parse user_uuid from post-device-state response in firmware and trigger realtime reconnect"
    status: pending
  - id: fix-broadcast-channel-reuse
    content: "CRITICAL: Refactor broadcastStatusUpdate to reuse existing user channel from usePairing instead of creating a new channel per broadcast"
    status: pending
  - id: fix-sweep-pairing-code
    content: "HIGH: Change webex-status-sweep to update pairings by device_uuid instead of pairing_code"
    status: pending
  - id: fix-oauth-callback-lookup
    content: "HIGH: Update webex-oauth-callback to query tokens by user_id instead of pairing_code/serial_number"
    status: pending
  - id: fix-webex-status-fallback
    content: "HIGH: Remove pairing_code fallback from webex-status pairings update"
    status: pending
  - id: cleanup-dead-code
    content: "MEDIUM: Remove legacy handleBroadcastMessage, dead postgres_changes handlers in firmware; mark update-app-state for removal"
    status: pending
isProject: false
---

# Comprehensive Code Review: Realtime-First Architecture

## Review Scope

Reviewed all layers against the `consolidated_realtime_fixes_v2` plan and the Supabase JS SDK source. Cross-referenced firmware Phoenix protocol, website hooks, Edge Functions, and database schema.

---

## CRITICAL: Must Fix (4 issues)

### 1. No RLS policies on `realtime.messages` -- private channels completely broken

**Root cause of:** `"Unauthorized: You do not have permissions to read from this Channel topic"`

RLS is enabled on `realtime.messages` but there are **zero policies**. When the firmware joins with `private: true`, Supabase checks RLS and denies access to all clients. Confirmed via:

```sql
SELECT * FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages';
-- Returns: [] (empty!)
```

The device JWT (from `device-auth`) includes `user_uuid` in its claims with `role: "authenticated"`. The RLS policy needs to authorize access based on the JWT's `user_uuid` claim matching the channel topic.

The admin devices page (`DeviceDetailPanel.tsx` line 191) also subscribes to `user:{userUuid}` channels for device logs. Admin users need access to ANY user's channel, not just their own. The auth hook (`display.custom_access_token_hook`) injects `is_admin` into `app_metadata` of the JWT, so we can check for admin access.

**FIX:** Create a new migration with RLS policies on `realtime.messages`:

```sql
-- Allow authenticated users to READ broadcasts on user channels
CREATE POLICY "user_channel_read" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    -- User session: auth.uid() matches topic
    realtime.topic() = 'user:' || auth.uid()::text
    OR
    -- Device JWT: user_uuid claim matches topic
    realtime.topic() = 'user:' || (current_setting('request.jwt.claims', true)::json->>'user_uuid')
    OR
    -- Admin users: can subscribe to any user channel
    (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'is_admin')::boolean = true
  );

-- Allow authenticated users to WRITE broadcasts on user channels
CREATE POLICY "user_channel_write" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    -- User session: auth.uid() matches topic
    realtime.topic() = 'user:' || auth.uid()::text
    OR
    -- Device JWT: user_uuid claim matches topic
    realtime.topic() = 'user:' || (current_setting('request.jwt.claims', true)::json->>'user_uuid')
    OR
    -- Admin users: can broadcast on any user channel
    (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'is_admin')::boolean = true
  );
```

The three access paths are:

- **Regular users** (embedded app): `auth.uid()` matches the channel topic `user:{their_uuid}`
- **Devices** (firmware): JWT `user_uuid` claim matches the channel topic
- **Admin users** (admin panel): `app_metadata.is_admin = true` grants access to any channel

### 2. Website does NOT use private channels

**File:** [website/src/app/embedded/hooks/usePairing.ts](website/src/app/embedded/hooks/usePairing.ts) lines 212-216

The website creates the user channel WITHOUT `private: true`. This means the channel is publicly accessible to anyone who knows the user UUID. Both the firmware and website should use private channels.

**FIX:** Add `private: true` to the channel config in `usePairing.ts`:

```typescript
const channel = supabase.channel(channelName, {
  config: {
    broadcast: { self: true },
    presence: { key: 'app' },
    private: true
  }
})
```

Also add `private: true` in [website/src/app/embedded/hooks/useWebexStatus.ts](website/src/app/embedded/hooks/useWebexStatus.ts) line 187-191 (the `broadcastStatusUpdate` channel).

### 3. Firmware doesn't parse `user_uuid` from `post-device-state` response

**File:** [firmware/src/supabase/supabase_client.cpp](firmware/src/supabase/supabase_client.cpp) lines 106-141

The `post-device-state` Edge Function returns `user_uuid` in every response (confirmed at line 420 of the Edge Function), but the firmware's `postDeviceState()` method ignores it completely. After a device is approved, the device never picks up the new `user_uuid` until it reboots and calls `device-auth` again.

This is why the user had to reboot to get `User: Yes` in the diagnostics.

**FIX:** Add `user_uuid` parsing after the response parse (around line 139 of `supabase_client.cpp`):

```cpp
// Check for user_uuid assignment (device may get user after approval)
String newUserUuid = respDoc["user_uuid"] | "";
if (!newUserUuid.isEmpty()) {
    auto& deps = getDependencies();
    String currentUserUuid = deps.config.getUserUuid();
    if (currentUserUuid.isEmpty() || currentUserUuid != newUserUuid) {
        deps.config.setUserUuid(newUserUuid);
        Serial.printf("[SUPABASE] User UUID updated from post-device-state: %s\n",
                      newUserUuid.substring(0, 8).c_str());
        deps.realtime.disconnect(); // Reconnect to user channel
    }
}
```

### 4. broadcastStatusUpdate creates a new channel per broadcast (resource leak)

**File:** [website/src/app/embedded/hooks/useWebexStatus.ts](website/src/app/embedded/hooks/useWebexStatus.ts) lines 156-225

Every status change creates a new Supabase channel, subscribes, sends one broadcast, then removes it. This is extremely wasteful -- it creates a new WebSocket subscription round-trip for every single Webex status change.

The `usePairing` hook already maintains a persistent channel at `userChannelRef.current`. The `broadcastStatusUpdate` should reuse that channel instead.

**FIX:** Refactor `broadcastStatusUpdate` to accept the existing channel ref from `usePairing` and call `.send()` on it directly, eliminating the subscribe/unsubscribe cycle. Move `broadcastStatusUpdate` into `usePairing.ts` where it has direct access to `userChannelRef`.

---

## HIGH: Should Fix (3 issues)

### 5. webex-status-sweep updates pairings by pairing_code, not device_uuid

**File:** [supabase/functions/webex-status-sweep/index.ts](supabase/functions/webex-status-sweep/index.ts) ~line 213

The sweep function has `device_uuid` available from the pairing query but still uses `pairing_code` for the `.eq()` filter when updating pairings.

**FIX:** Change `.eq("pairing_code", pairing.pairing_code)` to `.eq("device_uuid", pairing.device_uuid)`.

### 6. webex-oauth-callback still queries tokens by pairing_code/serial_number

**File:** [supabase/functions/webex-oauth-callback/index.ts](supabase/functions/webex-oauth-callback/index.ts) ~lines 209-215

When checking for existing tokens, it queries by `pairing_code` and `serial_number` instead of `user_id` (which is resolved earlier in the function). Since Webex tokens are user-owned (not device-owned), the primary lookup should be by `user_id`.

**FIX:** Query existing tokens by `user_id` when available, falling back to `pairing_code`/`serial_number` only for migration.

### 7. webex-status has pairing_code fallback for pairings update

**File:** [supabase/functions/webex-status/index.ts](supabase/functions/webex-status/index.ts) ~lines 299-327

When updating pairings with the Webex status, if `device_uuid` is not available it falls back to `pairing_code`. This fallback should be removed since all devices now get `device_uuid` from `device-auth`.

**FIX:** Remove the `pairing_code` fallback path. If `device_uuid` is not available, log a warning and skip the update.

---

## MEDIUM: Code Quality (4 issues)

### 8. Duplicate channel subscription logic between usePairing and useWebexStatus

**Files:**

- [website/src/app/embedded/hooks/usePairing.ts](website/src/app/embedded/hooks/usePairing.ts) lines 193-304
- [website/src/app/embedded/hooks/useWebexStatus.ts](website/src/app/embedded/hooks/useWebexStatus.ts) lines 156-225

Both hooks independently create and manage channels to the same `user:{userId}` topic. This violates DRY and can cause race conditions. Resolved by Critical issue #4.

### 9. update-app-state Edge Function still deployed

**File:** [supabase/functions/update-app-state/index.ts](supabase/functions/update-app-state/index.ts)

Marked `@deprecated` but still deployed. No clients call it anymore. Should be undeployed to avoid confusion.

**ACTION:** Remove from `config.toml` or add a `// DEPRECATED` comment. Do NOT delete the file yet.

### 10. Firmware dead code: legacy broadcast handler and postgres_changes handlers

**File:** [firmware/src/realtime/realtime_handlers.cpp](firmware/src/realtime/realtime_handlers.cpp)

- `handleBroadcastMessage()` (lines 190-220) -- unreachable since pairing-based subscription was removed
- `postgres_changes` handlers (lines 388-406) -- unreachable since user channels don't include postgres_changes

**ACTION:** Remove these dead handlers or add comments explaining they're for future use.

### 11. exchange-pairing-code token payload missing device_uuid/user_uuid

**File:** [supabase/functions/exchange-pairing-code/index.ts](supabase/functions/exchange-pairing-code/index.ts) ~line 151

**ACTION:** Add `device_uuid` to the token payload for consistency.

---

## LOW: Informational (3 items)

### 12. Firmware VSN 1.0.0 vs SDK default 2.0.0

The firmware uses Phoenix VSN `1.0.0` (JSON format), while the JS SDK defaults to `2.0.0` (binary serializer). Both are supported. The firmware's choice is correct for ESP32 -- JSON is simpler to parse on embedded. No change needed.

### 13. Missing UNIQUE constraint on pairings.device_uuid

The `display.pairings` table allows multiple pairings with the same `device_uuid`. Consider adding `UNIQUE(device_uuid)` if one pairing per device is required.

### 14. Deprecated columns in display.pairings

Columns `app_last_seen`, `device_last_seen`, `app_connected`, `device_connected` are documented as deprecated but intentionally kept for backward compatibility. The Postgres trigger still writes to them. Acceptable.

---

## What's CORRECT (verified working)

- Firmware `realtime:` prefix on user channel topic
- Firmware broadcast parsing (reads `event` and `payload` at correct nesting level for VSN 1.0.0)
- Firmware heartbeat (30s interval, 60s timeout, topic `phoenix`)
- Firmware user_uuid persistence to NVS
- Firmware device_uuid filtering on received broadcasts
- Website `updatePairingState` field names (`mic_muted`, `in_call`, `camera_on`)
- Website heartbeat writes to `connection_heartbeats` using `device_uuid`
- Website command sending via `insert-command` Edge Function
- Database `SECURITY DEFINER` on `pairings_presence_trigger`
- Database `UNIQUE(device_uuid)` on `connection_heartbeats`
- Database RLS policies on `display.pairings` and `display.connection_heartbeats`
- `device-auth` returns `user_uuid` in token and response
- `post-device-state` correctly uses `device_uuid` and returns `user_uuid`
- `approve-device` and `provision-device` correctly UPSERT `user_uuid` in pairings
- `insert-command` and `insert-device-log` broadcast to user channels
- `ack-command` correctly uses `device_uuid`
- `webex-token` correctly uses `user_uuid` for token lookups
- All 845 firmware tests passing
- All 93 embedded app tests passing
- Website build passing

---

## Execution Order

1. **Issue 1** -- RLS policies on `realtime.messages` (database migration, unblocks everything)
2. **Issue 2** -- Website private channel flag (must go with #1)
3. **Issue 3** -- Firmware `user_uuid` polling from `post-device-state`
4. **Issue 4** -- Refactor `broadcastStatusUpdate` to reuse channel
5. **Issues 5-7** -- Edge Function pairing_code cleanup
6. **Issues 8-11** -- Dead code removal and cleanup

