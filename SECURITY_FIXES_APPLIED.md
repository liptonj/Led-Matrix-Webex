# Security Fixes Applied

This document summarizes the critical security fixes applied based on the code review.

## Critical Fixes Implemented

### 1. ✅ Fixed JWT Token Type Mismatch (CRITICAL)

**Issue**: Edge Function was creating tokens with `type: "app_auth"` but RLS policies expected `token_type: "app"`, causing embedded app to be blocked by RLS.

**Fix**: Added `token_type: "app"` to JWT payload in `exchange-pairing-code` Edge Function.

**Files Changed**:
- `supabase/functions/exchange-pairing-code/index.ts`

### 2. ✅ Fixed Secret Mismatch Documentation (HIGH)

**Issue**: Bridge uses `BRIDGE_APP_TOKEN_SECRET` while Edge Function uses `SUPABASE_JWT_SECRET`. If they differ, token validation fails.

**Fix**: 
- Updated bridge to check both environment variables (preferring `BRIDGE_APP_TOKEN_SECRET`, falling back to `SUPABASE_JWT_SECRET`)
- Added warning if both are set but differ
- Updated documentation to clarify they must match

**Files Changed**:
- `bridge/src/storage/supabase_store.ts`
- `bridge/env.example`
- `supabase/functions/exchange-pairing-code/index.ts` (added comment)

### 3. ✅ Restricted Admin Updates to Safe Columns (HIGH)

**Issue**: Admin RLS policy allowed updates to ANY column, including `key_hash`, which violates security requirements.

**Fix**: Created new migration that adds `WITH CHECK` constraint preventing admins from updating:
- `key_hash`
- `serial_number`
- `device_id`
- `pairing_code`

**Files Changed**:
- `supabase/migrations/20260128000003_restrict_admin_updates.sql` (new file)

### 4. ✅ Added Rate Limiting for Debug Logs (MEDIUM)

**Issue**: High-volume debug logs could overwhelm database and Realtime replication without throttling.

**Fix**: Implemented per-device rate limiting:
- Always persist `warn`/`error` logs (no rate limit)
- Rate limit `info`/`debug` logs when `debug_enabled` is true
- Configurable via `DEBUG_LOG_RATE_LIMIT` env var (default: 10 logs/second)

**Files Changed**:
- `bridge/src/websocket/ws_server.ts`
- `bridge/env.example`

### 5. ✅ Fixed Admin UI Log Loading (MEDIUM)

**Issue**: Admin UI only loaded logs when `debug_enabled` was true, hiding persisted `warn`/`error` logs.

**Fix**: Always load logs on page load. Realtime streaming still requires `debug_enabled`.

**Files Changed**:
- `website/src/app/admin/devices/[serial]/page.tsx`

## Known Security Limitations (Documented)

### 1. MQTT TLS Uses setInsecure() (Medium Priority)

**Issue**: MQTT client uses `setInsecure()` which skips certificate verification when TLS is enabled.

**Location**: `firmware/src/meraki/mqtt_client.cpp` line 109

```cpp
if (use_tls) {
    wifi_client_secure.setInsecure();  // Skip certificate verification for simplicity
    mqtt_client.setClient(wifi_client_secure);
}
```

**Risk**: Susceptible to man-in-the-middle attacks if attacker can intercept MQTT traffic.

**Justification**: 
- MQTT is used for Meraki MT sensor integration (optional feature)
- Users configure their own MQTT broker with varying certificate chains
- Creating a universal CA bundle for all possible MQTT brokers is impractical
- Encrypted transport (TLS) still provides confidentiality even without certificate verification

**Mitigations**:
- MQTT is optional and disabled by default
- Most deployments use MQTT on trusted internal networks
- Data transmitted is sensor readings (temperature, humidity) - low sensitivity

**Future Improvement**: Consider adding a configurable CA certificate field in MQTT settings to allow users to provide their own CA certificate for strict verification.

### 2. CORS Allows Any Origin (Low Priority)

**Issue**: Web server allows requests from any origin via `Access-Control-Allow-Origin: *`.

**Location**: `firmware/src/web/web_server.cpp` lines 229-235

```cpp
void WebServerManager::addCorsHeaders(AsyncWebServerResponse* response) {
    response->addHeader("Access-Control-Allow-Origin", "*");
    response->addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-API-Key");
}
```

**Risk**: Any website can make requests to the device's API endpoints if they know the device IP.

**Justification - Required for Architecture**:

The device is accessed from multiple origins that cannot be enumerated:

| Category | Origin Examples | Use Case |
|----------|-----------------|----------|
| **Cloud Services** | | |
| Webex Embedded App | `https://app.webex.com` | Primary status display control (runs in Webex iframe) |
| Cloud Dashboard | `https://display.5ls.us` | Device configuration & management |
| Supabase API | `https://fmultmlsevqgtnqzaylg.supabase.co` | Backend API calls to device |
| **Local Network Access** | | |
| Private IP (Class C) | `http://192.168.x.x` | Most common home/office networks |
| Private IP (Class A) | `http://10.x.x.x` | Enterprise networks |
| Private IP (Class B) | `http://172.16-31.x.x` | Some corporate networks |
| AP Mode (Captive Portal) | `http://192.168.4.1` | Device setup/provisioning mode |
| **mDNS Access** | | |
| Default mDNS | `http://webex-display.local` | Default device hostname |
| Custom mDNS | `http://<user-configured>.local` | User-configured device name |
| **Development** | | |
| Local Dev Server | `http://localhost:3000` | Website development |
| Local Dev Server | `http://127.0.0.1:3000` | Alternative localhost |
| **Third-Party Tools** | | |
| ESP Web Tools | Various CDN origins | Browser-based firmware flashing |

**Note on Dynamic Origins**:
- **Private IPs**: Device IP depends on DHCP assignment from user's router
- **mDNS Names**: Default is `webex-display.local`, but users can configure custom names via web UI or serial commands
- **Supabase**: Project-specific subdomain (`fmultmlsevqgtnqzaylg.supabase.co` for production)
- **ESP Web Tools**: Can be hosted from `unpkg.com`, `jsdelivr.net`, or self-hosted

**Mitigations Already In Place**:
1. **API Token Required**: All sensitive endpoints require `X-API-Key` header or `token` query parameter
2. **Local Network Only**: Devices are typically on private LANs, not internet-exposed
3. **Token Not Guessable**: API token is a randomly generated 32-character hex string
4. **Sensitive Data Protected**: `/api/status` gates sensitive info behind authentication

**Why Restricting Origins Won't Work**:
- **Webex Embedded App**: Runs inside Webex's iframe with `app.webex.com` origin
- **Private IPs**: Three RFC1918 ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x) with dynamic DHCP assignment
- **mDNS Names**: User-configurable device names mean `http://*.local` cannot be allowlisted
- **Supabase**: Project-specific subdomain would need to be configured per-deployment
- **ESP Web Tools**: Can run from various CDN origins (unpkg, jsdelivr, self-hosted)
- **Development**: localhost:3000, 127.0.0.1:3000, potentially other ports
- **AP Mode**: Always uses fixed IP `192.168.4.1` but browser origin varies

**Recommendation**: This is acceptable for a local-network IoT device. Document in user guide that devices should not be exposed directly to the internet without additional network-level protection (firewall, VPN).

---

## Security Warnings (Not Fixed - Requires External Action)

### SHA-1 Signed Root Certificates

**Issue**: `CA_CERT_GLOBALSIGN_ROOT` and `CA_CERT_DIGICERT_GLOBAL` are signed with SHA-1, which is insecure per security rules.

**Status**: ⚠️ **Documented but not replaced** - Requires:
1. Obtaining SHA-256 signed replacements from certificate authorities
2. Verifying they work with existing certificate chains
3. Testing firmware TLS connections

**Action Required**: Replace these certificates with SHA-256 signed versions:
- GlobalSign Root CA → Use GlobalSign Root R46 or newer
- DigiCert Global Root CA → Use DigiCert Global Root G2 or G3

**Files Affected**:
- `firmware/src/common/ca_certs.h`

### ISRG Root X1 Certificate Parsing Issue

**Issue**: OpenSSL cannot parse the public key from `CA_CERT_ISRG_ROOT_X1` PEM block, suggesting potential corruption.

**Status**: ⚠️ **Needs verification** - The PEM block may be malformed or the OpenSSL version may have compatibility issues.

**Action Required**: 
1. Verify the PEM block is correct (compare with official Let's Encrypt source)
2. Test TLS connections using this certificate
3. Replace if corrupted

**Files Affected**:
- `firmware/src/common/ca_certs.h`

## Testing Recommendations

After applying these fixes, verify:

1. **Embedded App Authentication**:
   - Embedded app can connect and access Supabase Realtime
   - Token refresh works without disruption
   - RLS policies allow app to read/update pairings

2. **Admin Updates**:
   - Admin can update `debug_enabled`, `target_firmware_version`, etc.
   - Admin cannot update `key_hash`, `serial_number`, `device_id`, `pairing_code`
   - Attempts to update restricted columns are rejected

3. **Debug Logging**:
   - `warn`/`error` logs are always persisted
   - `info`/`debug` logs are rate-limited when `debug_enabled` is true
   - Admin UI shows all persisted logs regardless of `debug_enabled` status
   - Realtime streaming only works when `debug_enabled` is true

4. **Token Validation**:
   - Bridge accepts tokens signed with `SUPABASE_JWT_SECRET`
   - Bridge accepts tokens signed with `BRIDGE_APP_TOKEN_SECRET` (if set)
   - Warning is logged if both secrets are set but differ

## Migration Instructions

1. **Deploy Supabase Migration**:
   ```bash
   supabase migration up
   ```
   This will apply `20260128000003_restrict_admin_updates.sql`

2. **Update Bridge Environment**:
   - Ensure `BRIDGE_APP_TOKEN_SECRET` matches `SUPABASE_JWT_SECRET` in Supabase
   - Optionally set `DEBUG_LOG_RATE_LIMIT` (default: 10)

3. **Redeploy Edge Function**:
   - The `exchange-pairing-code` function now includes `token_type: "app"` in tokens

4. **Redeploy Bridge**:
   - Bridge now supports both secret environment variables
   - Rate limiting is enabled for debug logs

5. **Redeploy Website**:
   - Admin UI now always loads logs (not just when debug is enabled)

## Notes

- The certificate warnings require manual action to obtain and verify replacement certificates
- All code fixes are backward compatible (existing functionality preserved)
- Rate limiting can be disabled by setting `DEBUG_LOG_RATE_LIMIT=0` (not recommended)
