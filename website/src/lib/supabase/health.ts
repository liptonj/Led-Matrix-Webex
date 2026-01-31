/**
 * Supabase Health Check
 * Simple connectivity test to diagnose Supabase connection issues
 */

import { supabaseUrl, supabaseAnonKey } from './core';

export async function checkSupabaseHealth(): Promise<{
  healthy: boolean;
  latency?: number;
  error?: string;
}> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      healthy: false,
      error: 'Supabase not configured',
    };
  }

  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    if (!response.ok) {
      return {
        healthy: false,
        latency,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return {
      healthy: true,
      latency,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    return {
      healthy: false,
      error,
    };
  }
}
