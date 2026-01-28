# Rollback Procedure

This document describes the rollback procedure if Phase A of the Supabase migration causes issues.

## Overview

The Supabase migration introduces new communication paths between the embedded app, ESP32 devices, and the backend. If issues arise, we have multiple rollback options depending on the severity and scope of the problem.

## Quick Reference

| Issue Type | Response Time | Action |
|------------|---------------|--------|
| Edge Function errors | Immediate | Feature flag toggle |
| App connectivity issues | Within 24h | Revert app to bridge mode |
| Device connectivity issues | Within 1 week | OTA firmware rollback |

## Immediate Response (Within Minutes)

### 1. Feature Flag Toggle

If Edge Functions are failing or causing issues:

```bash
# Cloudflare Pages environment variable
NEXT_PUBLIC_USE_SUPABASE_EDGE_FUNCTIONS=false
```

This immediately switches the embedded app back to using direct database updates instead of Edge Functions for status updates.

### 2. Monitor Supabase Dashboard

Check for:
- Edge Function error rates (should be < 5%)
- Database connection issues
- Realtime subscription failures

## Short-term Response (Within 24 Hours)

### 1. Revert Embedded App to Bridge Mode

If Supabase Realtime is failing:

```bash
# In Cloudflare Pages environment
NEXT_PUBLIC_USE_SUPABASE_REALTIME=false
NEXT_PUBLIC_BRIDGE_URL=wss://bridge.5ls.us/ws
```

### 2. Verify Bridge Server is Running

```bash
# Check Azure Container Apps
az containerapp show --name webex-bridge --resource-group webex-bridge-rg

# Check logs
az containerapp logs show --name webex-bridge --resource-group webex-bridge-rg
```

### 3. Test Bridge Connectivity

```javascript
// Browser console test
const ws = new WebSocket('wss://bridge.5ls.us/ws');
ws.onopen = () => console.log('Bridge connected');
ws.onerror = (e) => console.error('Bridge error', e);
```

## Firmware Rollback (Within 1 Week)

If device communication is failing with Supabase:

### 1. Upload Previous Firmware Version

```bash
# Upload previous stable firmware to Supabase storage
supabase storage upload firmware/1.4.0/firmware.bin ./firmware-1.4.0.bin
```

### 2. Update Manifest

Edit the firmware manifest to point to the previous version:

```json
{
  "version": "1.4.0",
  "url": "https://xxx.supabase.co/storage/v1/object/public/firmware/1.4.0/firmware.bin",
  "rollout_percentage": 100
}
```

### 3. Trigger OTA Rollback

Devices will automatically download the previous version on next check.

## Monitoring Thresholds

### Alert Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Edge Function success rate | < 98% | < 95% | Investigate / Consider rollback |
| post-device-state latency | > 500ms | > 1000ms | Scale Edge Functions |
| Device last_seen gaps | > 2 min | > 5 min | Check device connectivity |
| Realtime subscription drops | > 5/hour | > 20/hour | Check Supabase status |

### Monitoring Commands

```bash
# Check Edge Function logs
supabase functions logs post-device-state --tail

# Check device last_seen distribution
psql -c "SELECT COUNT(*), 
         CASE 
           WHEN last_seen > NOW() - INTERVAL '1 minute' THEN 'active'
           WHEN last_seen > NOW() - INTERVAL '5 minutes' THEN 'recent'
           ELSE 'stale'
         END as status
         FROM display.devices
         GROUP BY status;"
```

## Post-Rollback Actions

### 1. Document the Issue

Create an incident report including:
- What failed
- When it was detected
- Who was affected
- Root cause (if known)
- Rollback steps taken

### 2. Fix the Issue

- Identify root cause in staging environment
- Create fix in a new branch
- Test thoroughly before re-deployment

### 3. Re-deploy with Caution

- Start with 10% rollout for firmware
- Monitor closely for 24 hours
- Gradually increase rollout percentage

## Rollback Scenarios

### Scenario 1: Edge Function Timeout

Symptoms:
- Devices show "offline" in app
- Edge Function logs show timeout errors

Rollback:
1. Set NEXT_PUBLIC_USE_SUPABASE_EDGE_FUNCTIONS=false
2. Investigate Edge Function code for slow queries
3. Fix and redeploy

### Scenario 2: Token Minting Failure

Symptoms:
- App cannot connect to devices
- "Token exchange failed" errors

Rollback:
1. Check Supabase JWT secret configuration
2. Verify Edge Function has correct environment variables
3. Temporarily allow direct database access

### Scenario 3: Realtime Subscription Failure

Symptoms:
- App connects but doesn't receive updates
- Devices report connected but app shows disconnected

Rollback:
1. Check Supabase Realtime status page
2. Verify table is in supabase_realtime publication
3. Fall back to polling mode

### Scenario 4: Device HMAC Authentication Failure

Symptoms:
- All devices show 401 errors
- device-auth Edge Function rejects all requests

Rollback:
1. Verify HMAC secret matches between device and server
2. Check timestamp validation (clock drift)
3. Push firmware update with corrected HMAC implementation

## Communication Plan

### Internal Notification

1. Post in #led-matrix-alerts channel
2. Tag relevant team members
3. Update status page (if applicable)

### User Communication

If rollback affects users:
1. Update status page
2. Send notification to affected users
3. Provide ETA for resolution

## Recovery Verification

After rollback, verify:

- [ ] Devices can connect and sync status
- [ ] App can exchange pairing codes
- [ ] Commands are delivered and acknowledged
- [ ] No error spikes in logs
- [ ] User reports resolved

## Related Documentation

- Bridge Deprecation Plan: bridge_deprecation.md
- Supabase Setup Guide: supabase_setup.md
- Firmware OTA Guide: ota_updates.md
