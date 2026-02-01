/**
 * Mock Supabase Client
 *
 * Centralized Supabase mock for consistent testing.
 */

import { createMockSupabaseClient } from "@/test-utils/mocks";

export const createClient = jest.fn(() => createMockSupabaseClient());

export { createMockSupabaseClient };
