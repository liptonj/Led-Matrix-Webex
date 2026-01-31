/**
 * Supabase Client Configuration
 *
 * Barrel exports for Supabase helpers and domain-specific APIs.
 */

export { getSupabase, getCachedSession, isSupabaseConfigured } from "./supabase/core";
export * from "./supabase/types";
export * from "./supabase/devices";
export * from "./supabase/releases";
export * from "./supabase/auth";
export * from "./supabase/users";
export * from "./supabase/oauth";
export * from "./supabase/pairings";
