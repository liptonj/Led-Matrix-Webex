'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

type GlobalWithSupabase = typeof globalThis & {
  __supabaseClient?: SupabaseClient;
};

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  const globalAny = globalThis as GlobalWithSupabase;
  if (!globalAny.__supabaseClient) {
    console.log('[SupabaseClient] Creating new Supabase client');
    globalAny.__supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    console.log('[SupabaseClient] Supabase client created successfully');
  }

  return globalAny.__supabaseClient;
}
