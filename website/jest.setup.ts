/**
 * Jest Global Setup
 *
 * Configures the testing environment for all tests.
 * Uses centralized test utilities to avoid duplication.
 */

import '@testing-library/jest-dom';
import { spyOnConsole } from './src/test-utils/setup';

// Suppress expected errors/warnings during tests
const suppressedPatterns = [
  'Token exchange failed:',
  'Token exchange error:',
  'Failed to fetch status:',
  'Failed to load manifest:',
  'Not authenticated',
  'Supabase is not configured',
  'An update to %s inside a test was not wrapped in act(',
  'Skipping localStorage persistence test - localStorage is not a jest mock',
];

let consoleSpies: ReturnType<typeof spyOnConsole>;

beforeAll(() => {
  consoleSpies = spyOnConsole(suppressedPatterns);
});

afterAll(() => {
  consoleSpies.error.mockRestore();
  consoleSpies.warn.mockRestore();
});

afterEach(() => {
  if (!jest.isMockFunction(setTimeout)) {
    return;
  }

  jest.runOnlyPendingTimers();
  jest.clearAllTimers();
  jest.useRealTimers();
});
