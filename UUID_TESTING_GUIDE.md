# UUID-Based Device Identity Testing Guide

This guide provides comprehensive instructions for running and maintaining the test suite for the UUID-Based Device Identity Architecture.

## Table of Contents

1. [Overview](#overview)
2. [Test Structure](#test-structure)
3. [Running Tests](#running-tests)
4. [Coverage Requirements](#coverage-requirements)
5. [Known Test Failures and Workarounds](#known-test-failures-and-workarounds)
6. [Testing Edge Functions Locally](#testing-edge-functions-locally)
7. [Testing Firmware UUID Handling](#testing-firmware-uuid-handling)
8. [Testing React Components with UUID Data](#testing-react-components-with-uuid-data)

## Overview

The UUID-Based Device Identity Architecture introduces UUIDs (`device_uuid` and `user_uuid`) as primary identifiers for devices and users, replacing the previous serial_number-based approach. This test suite validates:

- UUID extraction and storage
- UUID-based queries and filtering
- Backward compatibility with legacy serial_number-based code
- Security and access control via RLS policies
- Realtime channel subscriptions using UUIDs

## Test Structure

### Supabase Edge Function Tests

Located in: `supabase/functions/_tests/`

**Test Files:**
- `device-auth.test.ts` - Tests device authentication with UUID support
- `approve-device.test.ts` - Tests device approval and UUID assignment
- `poll-commands.test.ts` - Tests command polling using device_uuid
- `insert-command.test.ts` - Tests command insertion with device_uuid
- `webex-status-sweep.test.ts` - Tests status broadcasting to user channels

**Test Fixtures:**
- `fixtures/uuid-fixtures.ts` - Standard UUID test data

### Firmware Tests

Located in: `firmware/test/`

**Test Files:**
- `test_config_uuid/test_config_uuid.cpp` - Tests UUID storage in NVS
- `test_realtime_uuid/test_realtime_uuid.cpp` - Tests UUID-based realtime subscriptions
- `test_auth_response/test_auth_response.cpp` - Tests auth response parsing and UUID extraction

### Website Tests

Located in: `website/src/app/embedded/__tests__/` and `website/src/app/embedded/hooks/__tests__/`

**Test Files:**
- `useDeviceConfig.test.ts` - Tests config fetching with UUID support
- `usePairing.test.ts` - Tests device selection and UUID handling
- `useWebexStatus.test.ts` - Tests status broadcasting with UUIDs
- `EmbeddedAppClient.test.tsx` - Tests component integration with UUIDs

## Running Tests

### Supabase Edge Function Tests

```bash
cd supabase/functions
deno test --allow-net --allow-env _tests/
```

**Run specific test file:**
```bash
deno test --allow-net --allow-env _tests/device-auth.test.ts
```

**Run with coverage:**
```bash
deno test --allow-net --allow-env --coverage=cov_profile _tests/
deno coverage cov_profile
```

### Firmware Tests

**Using PlatformIO:**
```bash
cd firmware
pio test -e native
```

**Run specific test:**
```bash
pio test -e native -f test_config_uuid
```

**Using Unity test runner directly:**
```bash
cd firmware/test/test_config_uuid
g++ -DUNIT_TEST -DNATIVE_BUILD test_config_uuid.cpp -I../../src -I../../lib/Unity/src -L../../lib/Unity/src -lUnity -o test_config_uuid
./test_config_uuid
```

### Website Tests

**Run all tests:**
```bash
cd website
npm test
```

**Run specific test file:**
```bash
npm test -- useDeviceConfig.test.ts
```

**Run with coverage:**
```bash
npm test -- --coverage
```

**Run in watch mode:**
```bash
npm test -- --watch
```

## Coverage Requirements

### Unit Tests

Each function/hook should have:
- ✅ Happy path tests
- ✅ Error case tests
- ✅ Edge case tests
- ✅ UUID validation and bounds checking

### Integration Tests

- ✅ Edge Function + Database interactions
- ✅ Firmware + NVS interactions
- ✅ React component + hook interactions

### Error Cases

- ✅ Missing device_uuid
- ✅ Missing user_uuid
- ✅ Invalid UUID format
- ✅ Database constraints
- ✅ Network failures

### Backward Compatibility

- ✅ Code works with old serial_number-based data
- ✅ Graceful fallback when UUID fields missing
- ✅ Existing tests still pass

### Security

- ✅ User cannot access other user's devices
- ✅ Device cannot access other device's commands
- ✅ RLS policies properly enforced

## Known Test Failures and Workarounds

### Edge Function Tests

**Issue:** Tests may fail if Supabase environment variables are not set.

**Workaround:** Set required environment variables:
```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export SUPABASE_JWT_SECRET="your-jwt-secret"
```

**Issue:** HMAC signature tests may fail due to timing differences.

**Workaround:** Use fixed timestamps in test fixtures or mock the timestamp validation.

### Firmware Tests

**Issue:** NVS tests may fail if NVS namespace is already initialized.

**Workaround:** Clear NVS before running tests:
```cpp
prefs.clear(); // In setUp() function
```

**Issue:** Tests may fail on native builds if ESP32-specific headers are missing.

**Workaround:** Use `#ifdef NATIVE_BUILD` guards for ESP32-specific code.

### Website Tests

**Issue:** React tests may fail due to missing Supabase client mocks.

**Workaround:** Ensure all Supabase client methods are properly mocked in test setup.

**Issue:** Tests may timeout waiting for async operations.

**Workaround:** Increase timeout or use `waitFor` with appropriate timeout values.

## Testing Edge Functions Locally

### Prerequisites

1. Install Deno: https://deno.land/
2. Set up Supabase CLI: https://supabase.com/docs/guides/cli
3. Configure environment variables

### Running Locally

```bash
cd supabase/functions
supabase functions serve device-auth --env-file .env.local
```

### Testing with curl

```bash
curl -X POST http://localhost:54321/functions/v1/device-auth \
  -H "Content-Type: application/json" \
  -H "X-Device-Serial: A1B2C3D4" \
  -H "X-Timestamp: $(date +%s)" \
  -H "X-Signature: <calculated-signature>" \
  -d '{}'
```

### Mocking Database Responses

Use Supabase local development:
```bash
supabase start
supabase db reset
```

## Testing Firmware UUID Handling

### NVS Storage Tests

Tests verify UUID storage in ESP32 NVS (Non-Volatile Storage):

```cpp
// Test UUID storage
ConfigManager config;
config.begin();
config.setDeviceUuid("550e8400-e29b-41d4-a716-446655440000");
String uuid = config.getDeviceUuid();
TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", uuid.c_str());
```

### Realtime Subscription Tests

Tests verify UUID-based channel subscriptions:

```cpp
// Test user channel subscription
String userUuid = "550e8400-e29b-41d4-a716-446655440001";
String channelName = "user:" + userUuid;
TEST_ASSERT_EQUAL_STRING("user:550e8400-e29b-41d4-a716-446655440001", channelName.c_str());
```

### Auth Response Parsing Tests

Tests verify UUID extraction from auth responses:

```cpp
// Test UUID extraction from JSON
JsonDocument doc;
deserializeJson(doc, authResponseJson);
String deviceUuid = doc["device_uuid"] | "";
TEST_ASSERT_EQUAL_STRING("550e8400-e29b-41d4-a716-446655440000", deviceUuid.c_str());
```

## Testing React Components with UUID Data

### Mock UUID Data

```typescript
const TEST_DEVICE_UUID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_USER_UUID = '550e8400-e29b-41d4-a716-446655440001';

const mockDeviceConfig = {
  device_uuid: TEST_DEVICE_UUID,
  user_uuid: TEST_USER_UUID,
  brightness: 128,
  // ... other fields
};
```

### Testing Hook with UUIDs

```typescript
const { result } = renderHook(() => useDeviceConfig({
  isPeerConnected: true,
  sendCommand: mockSendCommand,
  addLog: mockAddLog,
  deviceIp: '192.168.1.100',
}));

await waitFor(() => {
  expect(result.current.deviceConfig?.device_uuid).toBe(TEST_DEVICE_UUID);
});
```

### Testing Component with UUIDs

```typescript
const mockAppToken = {
  device_uuid: TEST_DEVICE_UUID,
  token: 'test-token',
  expires_at: new Date(Date.now() + 3600000).toISOString(),
};

render(<EmbeddedAppClient />);
// ... test interactions
```

## Test Data Fixtures

Standard test UUIDs are defined in `supabase/functions/_tests/fixtures/uuid-fixtures.ts`:

```typescript
export const TEST_DEVICE_UUID = '550e8400-e29b-41d4-a716-446655440000';
export const TEST_USER_UUID = '550e8400-e29b-41d4-a716-446655440001';
export const TEST_DEVICE_UUID_2 = '550e8400-e29b-41d4-a716-446655440002';
export const TEST_USER_UUID_2 = '550e8400-e29b-41d4-a716-446655440003';
```

Use these fixtures consistently across all test files to ensure test data consistency.

## Next Steps for Deployment Testing

1. **Integration Testing:** Test UUID flow end-to-end in staging environment
2. **Performance Testing:** Verify UUID-based queries perform well at scale
3. **Migration Testing:** Test backward compatibility with existing devices
4. **Security Testing:** Verify RLS policies prevent unauthorized access
5. **Load Testing:** Test UUID-based operations under load

## Troubleshooting

### Tests Fail Due to Missing UUIDs

**Solution:** Ensure test fixtures include UUID fields and mock responses include UUIDs.

### Tests Fail Due to Database Constraints

**Solution:** Use test database or mock database responses. Ensure foreign key relationships are properly mocked.

### Tests Fail Due to Network Issues

**Solution:** Mock network requests or use local Supabase instance for testing.

## Contributing

When adding new UUID-related functionality:

1. Add tests for new UUID fields
2. Test backward compatibility
3. Test error cases (missing UUIDs, invalid formats)
4. Update this guide with new test patterns
5. Ensure all tests pass before submitting PR
