/**
 * @file setup.js
 * @brief Test setup for firmware web interface
 */

// Mock global fetch API
global.fetch = jest.fn();

// Mock global confirm/alert
global.confirm = jest.fn(() => true);
global.alert = jest.fn();

// Mock console methods to reduce noise in test output
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
};

// Reset mocks before each test
beforeEach(() => {
  fetch.mockClear();
  confirm.mockClear();
  alert.mockClear();
  console.log.mockClear();
  console.error.mockClear();
  console.warn.mockClear();
  console.info.mockClear();
});
