/**
 * UUID Test Fixtures
 *
 * Standard test data for UUID-based device identity testing.
 */

export const TEST_DEVICE_UUID = '550e8400-e29b-41d4-a716-446655440000';
export const TEST_USER_UUID = '550e8400-e29b-41d4-a716-446655440001';
export const TEST_DEVICE_UUID_2 = '550e8400-e29b-41d4-a716-446655440002';
export const TEST_USER_UUID_2 = '550e8400-e29b-41d4-a716-446655440003';

export const TEST_SERIAL_NUMBER = 'A1B2C3D4';
export const TEST_PAIRING_CODE = 'ABC123';
export const TEST_DEVICE_ID = 'webex-display-C3D4';

export const mockDeviceConfig = {
  device_uuid: TEST_DEVICE_UUID,
  user_uuid: TEST_USER_UUID,
  display_name: 'Test User',
  last_webex_status: 'Active',
  serial_number: TEST_SERIAL_NUMBER,
  firmware_version: '1.2.3',
  pairing_code: TEST_PAIRING_CODE,
  device_id: TEST_DEVICE_ID,
};

export const mockDeviceConfigUnassigned = {
  device_uuid: TEST_DEVICE_UUID,
  user_uuid: null,
  display_name: null,
  last_webex_status: null,
  serial_number: TEST_SERIAL_NUMBER,
  firmware_version: '1.2.3',
  pairing_code: TEST_PAIRING_CODE,
  device_id: TEST_DEVICE_ID,
};

export const mockPairingRecord = {
  pairing_code: TEST_PAIRING_CODE,
  serial_number: TEST_SERIAL_NUMBER,
  device_id: TEST_DEVICE_ID,
  device_uuid: TEST_DEVICE_UUID,
  user_uuid: TEST_USER_UUID,
  device_connected: true,
  device_last_seen: new Date().toISOString(),
};

export const mockPairingRecordUnassigned = {
  pairing_code: TEST_PAIRING_CODE,
  serial_number: TEST_SERIAL_NUMBER,
  device_id: TEST_DEVICE_ID,
  device_uuid: TEST_DEVICE_UUID,
  user_uuid: null,
  device_connected: true,
  device_last_seen: new Date().toISOString(),
};

export const mockDeviceRecord = {
  id: TEST_DEVICE_UUID,
  serial_number: TEST_SERIAL_NUMBER,
  pairing_code: TEST_PAIRING_CODE,
  device_id: TEST_DEVICE_ID,
  created_at: new Date().toISOString(),
};

export const mockCommand = {
  id: 'cmd-123',
  command: 'set_brightness',
  payload: { value: 128 },
  pairing_code: TEST_PAIRING_CODE,
  serial_number: TEST_SERIAL_NUMBER,
  device_uuid: TEST_DEVICE_UUID,
  status: 'pending',
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 300000).toISOString(),
};

export const mockJwtPayload = {
  sub: crypto.randomUUID(),
  role: 'authenticated',
  aud: 'authenticated',
  serial_number: TEST_SERIAL_NUMBER,
  pairing_code: TEST_PAIRING_CODE,
  device_id: TEST_DEVICE_ID,
  device_uuid: TEST_DEVICE_UUID,
  user_uuid: TEST_USER_UUID,
  token_type: 'device',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 86400,
};

export const mockJwtPayloadUnassigned = {
  sub: crypto.randomUUID(),
  role: 'authenticated',
  aud: 'authenticated',
  serial_number: TEST_SERIAL_NUMBER,
  pairing_code: TEST_PAIRING_CODE,
  device_id: TEST_DEVICE_ID,
  device_uuid: TEST_DEVICE_UUID,
  user_uuid: null,
  token_type: 'device',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 86400,
};
