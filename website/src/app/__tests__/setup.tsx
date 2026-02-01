/**
 * Jest setup file for app tests
 *
 * Configures the test environment for React component tests.
 * Uses centralized test utilities and mocks.
 */

import "@testing-library/jest-dom";
import { setupGlobalMocks, cleanupGlobalMocks } from "@/test-utils/setup";

// Mock Next.js modules
jest.mock("next/script", () => require("@/__mocks__/next").Script);
jest.mock("next/image", () => require("@/__mocks__/next").Image);
jest.mock("next/link", () => require("@/__mocks__/next").Link);

// Setup global mocks before each test
beforeEach(() => {
  setupGlobalMocks();
});

// Cleanup after each test
afterEach(() => {
  cleanupGlobalMocks();
});

export {};
