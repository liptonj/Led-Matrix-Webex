# UUID Architecture Deployment Guide

## Quick Start - Deploy to Staging

### Step 1: Apply Database Migrations

```bash
cd /Users/jolipton/Projects/Led-Matrix-Webex

# Verify migrations are ready
supabase migration list

# Deploy migrations (order matters - handled automatically)
supabase migration deploy

# Verify deployment
supabase db pull  # Should see new columns: device_uuid, user_uuid
```

### Step 2: Deploy Edge Functions

```bash
# Deploy all updated functions
supabase functions deploy

# Test device-auth
supabase functions invoke device-auth --body '{
  "pairing_code": "TEST_CODE",
  "serial_number": "SN_TEST"
}'
# Expected: Response includes device_uuid and user_uuid fields
```

### Step 3: Deploy Firmware

```bash
cd firmware

# Build firmware with UUID support
pio run -e esp32-s3 --target build

# Create OTA package
./scripts/create_ota_package.sh

# Upload to Supabase storage
supabase storage from /build/output.bin --bucket firmware

# Release new firmware version with OTA manifest
```

### Step 4: Deploy Website

```bash
cd website

# Build
npm run build

# Deploy to production/staging
npm run deploy
```

---

## Detailed Validation Checklist

### 1. Database Level

```sql
-- Connect to Supabase database
psql $SUPABASE_DATABASE_URL

-- Verify migrations
SELECT name, executed_at FROM _migrations 
WHERE name LIKE '20260205%' 
ORDER BY executed_at DESC;

-- Check device_uuid columns
SELECT 
  table_schema, table_name, column_name 
FROM information_schema.columns 
WHERE table_schema = 'display' 
  AND column_name LIKE '%uuid%'
ORDER BY table_name, column_name;

-- Check indexes
SELECT indexname FROM pg_indexes 
WHERE schemaname = 'display' 
  AND indexname LIKE 'idx_%uuid%';

-- Test user_can_access_device function
SELECT 
  display.user_can_access_device('550e8400-e29b-41d4-a716-446655440000'::uuid) AS by_uuid,
  display.user_can_access_device('SN12345') AS by_serial;

-- Count RLS policies
SELECT table_name, count(*) FROM pg_policies 
WHERE schema_name = 'display' 
GROUP BY table_name;
```

### 2. API Level (Edge Functions)

```bash
# Test device-auth response includes UUIDs
curl -X POST https://YOUR_SUPABASE_URL/functions/v1/device-auth \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "pairing_code": "TEST_PAIR_CODE",
    "serial_number": "SN_TEST"
  }'

# Expected response:
{
  "device_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "user_uuid": null,  # or user UUID if assigned
  "token": "JWT_WITH_UUIDS",
  ...
}

# Decode JWT to verify UUIDs included
# Use: https://jwt.io to inspect token
# JWT payload should include:
{
  "device_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "user_uuid": null,
  ...
}
```

### 3. Firmware Level

**After OTA Update:**

```
Monitor device logs:

✅ Device Startup
[CONFIG] Device UUID: 550e8400-e29b-41d4-a716-446655440000
[CONFIG] Stored in NVS successfully

✅ Authentication
[AUTH] Sending HMAC auth request...
[AUTH] Received device_uuid: 550e8400-e29b-41d4-a716-446655440000
[AUTH] Received user_uuid: 550e8400-e29b-41d4-a716-446655440001
[AUTH] JWT created with UUIDs

✅ Realtime Connection
[REALTIME] Subscribing to: user:550e8400-e29b-41d4-a716-446655440001
[REALTIME] User channel subscribed successfully

✅ Status Reception
[REALTIME] Received webex_status event
[REALTIME] Status: Active, in_call: false
[LED] Display updated: Active

✅ Config Endpoint
GET /api/config returns:
{
  "device_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "user_uuid": "550e8400-e29b-41d4-a716-446655440001",
  "display_name": "John Doe",
  "last_webex_status": "Active",
  "serial_number": "SN_TEST",
  "firmware_version": "2.0.0",
  ...
}
```

### 4. Website Level

```bash
cd website

# Run tests
npm test

# Check that:
# ✅ usePairing uses selectedDeviceUuid (not selectedDevice)
# ✅ useRealtimeStatus subscribes to user channel
# ✅ useWebexStatus broadcasts with device_uuid
# ✅ EmbeddedAppClient passes deviceUuid to child hooks

# Manual testing in browser:
# 1. Connect to device
# 2. Verify device config loads with device_uuid
# 3. Change Webex status in Webex app
# 4. Verify LED updates within 2 seconds
# 5. Check browser console shows user channel subscription
```

---

## Monitoring Post-Deployment

### Key Metrics

```sql
-- Track device authentication methods
SELECT 
  COUNT(*) as total_auths,
  SUM(CASE WHEN device_uuid IS NOT NULL THEN 1 ELSE 0 END) as uuid_auths,
  SUM(CASE WHEN device_uuid IS NULL THEN 1 ELSE 0 END) as legacy_auths
FROM display.devices
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Track user channel subscriptions vs pairing channel
-- (Requires application logging)
SELECT 
  DATE_TRUNC('hour', timestamp) as hour,
  COUNT(*) as subscription_count,
  COUNT(DISTINCT user_uuid) as unique_users
FROM logs.realtime_subscriptions
WHERE channel LIKE 'user:%'
GROUP BY DATE_TRUNC('hour', timestamp)
ORDER BY hour DESC;

-- Track broadcast latency
SELECT 
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) as p50_latency,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_latency,
  MAX(latency_ms) as max_latency
FROM logs.broadcast_events
WHERE event = 'webex_status'
  AND created_at > NOW() - INTERVAL '24 hours';

-- Track RLS policy performance
SELECT 
  query_time_ms,
  COUNT(*) as query_count
FROM logs.database_queries
WHERE policy_applied = true
  AND table_name IN ('commands', 'pairings', 'oauth_tokens')
GROUP BY ROUND(query_time_ms, 1)
ORDER BY query_time_ms DESC;
```

### Alerting (Recommended)

Set up alerts for:
- ❌ Device UUID is NULL (suggests auth failure)
- ❌ RLS policy query time > 500ms (performance issue)
- ❌ Broadcast latency > 5 seconds (delivery issue)
- ⚠️ Legacy authentication > 10% (migration stalled)

---

## Rollback Instructions

### If Critical Issues Discovered

**Option 1: Immediate Code Rollback**
```bash
# Revert to previous commit
git revert 4aa6eab5555688a38a647f6d4e8252e0467929df

# Deploy reverted functions
supabase functions deploy

# Deploy reverted website
cd website && npm run deploy

# Database remains unchanged (backward compatible)
# Devices will automatically fall back to pairing_code auth
```

**Option 2: Keep Database, Revert Functions**
```bash
# If database is stable but functions have bugs:
git checkout HEAD~1 -- supabase/functions/
supabase functions deploy

# Devices will still send device_uuid in JWT but functions won't use it
# Graceful degradation to serial_number-based operations
```

**Option 3: Full Database Rollback**
```bash
# WARNING: Data loss! Only if absolutely necessary

# Revert migrations
supabase db reset

# Restore from backup
psql $DATABASE_URL < backup.sql

# This removes all UUID columns
# Run old firmware builds
```

---

## Performance Benchmarks

Expected performance after deployment:

| Operation | Latency | Notes |
|-----------|---------|-------|
| Device Auth | < 500ms | JWT creation with UUIDs |
| Poll Commands | < 100ms | UUID-based query (indexed) |
| Webex Status Broadcast | < 2s | Realtime channel delivery |
| RLS Check | < 50ms | With proper indexes |
| Config Endpoint | < 100ms | HTTP API on device |

---

## FAQ & Troubleshooting

### Q: Device shows "invalid user_uuid"
**A:** Device received `user_uuid: null` (not yet approved). This is normal. After user approval, device will receive `user_assigned` event with proper user_uuid.

### Q: Device doesn't update LED after Webex status changes
**A:** 
1. Check if device is subscribed to user channel: `GET /api/config` shows `user_uuid`
2. Verify broadcast is being sent: Check Edge Function logs
3. Check device subscription: Monitor device serial logs
4. Manual test: Call webex-status-sweep Edge Function directly

### Q: "device_uuid is NULL" database errors
**A:** Migrations didn't backfill properly. Check migration logs:
```bash
supabase migration logs
```
Re-run migration manually:
```sql
UPDATE display.pairings p
SET device_uuid = d.id
FROM display.devices d
WHERE p.serial_number = d.serial_number
  AND p.device_uuid IS NULL;
```

### Q: Old firmware can't authenticate
**A:** Old firmware doesn't know about UUIDs. Options:
1. Force firmware update via OTA manifest
2. Keep backward compatibility in device-auth function (returns legacy response if old client detected)
3. Run two auth functions (old and new) during transition period

### Q: RLS policies blocking commands
**A:** Check that user_devices has device_uuid populated:
```sql
SELECT COUNT(*) as missing_uuid FROM display.user_devices WHERE device_uuid IS NULL;
```
If > 0, backfill missed:
```sql
UPDATE display.user_devices ud
SET device_uuid = d.id
FROM display.devices d
WHERE ud.serial_number = d.serial_number
  AND ud.device_uuid IS NULL;
```

---

## Migration Timeline

### Week 1: Staging Validation
- Deploy to staging environment
- Run full test suite
- Validate end-to-end flow
- Collect metrics for 3-5 days

### Week 2: Canary Deployment
- Deploy to 5-10% of production devices
- Monitor for issues
- Validate metrics
- Adjust if needed

### Week 3: Gradual Rollout
- Deploy to 25% of devices
- Monitor performance
- Validate RLS policies
- Check LED display updates

### Week 4: Full Production
- Deploy to 100% of devices
- Monitor completion rate
- Track legacy vs UUID usage
- Plan deprecation timeline

### Weeks 5-12: Deprecation Phase
- Monitor old code usage
- Plan removal of old RLS policies
- Update documentation
- Notify users of changes

---

## Support & Escalation

### If Issues Arise During Deployment

1. **Check logs**
   - Edge Function logs: `supabase functions logs <function-name>`
   - Database logs: Query PostgreSQL logs
   - Device logs: Monitor firmware serial output

2. **Validate database state**
   - Verify migrations applied: `SELECT * FROM _migrations`
   - Check data integrity: `SELECT COUNT(*) FROM display.devices WHERE id IS NULL`
   - Verify indexes: `SELECT * FROM pg_stat_user_indexes WHERE idx_name LIKE 'idx_%uuid%'`

3. **Test endpoints**
   - device-auth: Should return device_uuid and user_uuid
   - poll-commands: Should filter by device_uuid
   - webex-status-sweep: Should broadcast to user channel

4. **Escalate if needed**
   - Contact Supabase support for database issues
   - Review GitHub Issues for known Edge Function bugs
   - Check device firmware logs for hardware issues

---

## Sign-Off Checklist

Before moving to production:

- [ ] All database migrations applied successfully
- [ ] Edge Function tests pass
- [ ] Firmware builds and OTA updates work
- [ ] Website/app deploys successfully
- [ ] Device receives device_uuid and user_uuid
- [ ] Device subscribes to user channel
- [ ] Webex status broadcasts work end-to-end
- [ ] LED display updates automatically
- [ ] Backward compatibility verified with old firmware
- [ ] RLS policies prevent unauthorized access
- [ ] Performance meets benchmarks
- [ ] Monitoring/alerting configured
- [ ] Rollback plan tested
- [ ] Team trained on new architecture
- [ ] Documentation updated

---

**Ready to deploy!**

For any questions or issues, refer to `UUID_IMPLEMENTATION_COMPLETE.md` for detailed technical documentation.
