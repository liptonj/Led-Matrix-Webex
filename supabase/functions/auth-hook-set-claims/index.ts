/**
 * Supabase Auth Hook: Set JWT Claims
 *
 * This hook runs on login and token refresh to set custom claims in the JWT:
 * - app_metadata.is_admin: Whether the user is an admin
 * - app_metadata.disabled: Whether the user account is disabled
 *
 * This eliminates the need for database queries on every auth check.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface WebhookPayload {
  user_id: string;
  claims?: Record<string, unknown>;
}

interface CustomClaims {
  is_admin: boolean;
  disabled: boolean;
}

Deno.serve(async (req) => {
  try {
    // Verify webhook signature using DEVICE_JWT_SECRET
    const authHeader = req.headers.get('Authorization');
    const deviceJwtSecret = Deno.env.get('DEVICE_JWT_SECRET');

    if (deviceJwtSecret) {
      const expectedHeader = `Bearer ${deviceJwtSecret}`;
      if (authHeader !== expectedHeader) {
        console.error('[auth-hook] Invalid authorization header');
        console.error(`Expected: ${expectedHeader.substring(0, 20)}...`);
        console.error(`Received: ${authHeader?.substring(0, 20)}...`);
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const payload: WebhookPayload = await req.json();
    const userId = payload.user_id;

    console.log(`[auth-hook] Processing claims for user ${userId}`);

    // Create admin client to query database
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Query admin status and profile in parallel
    const [adminResult, profileResult] = await Promise.allSettled([
      supabaseAdmin
        .from('admin_users')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('user_profiles')
        .select('disabled')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    const isAdmin =
      adminResult.status === 'fulfilled' && adminResult.value.data !== null;
    const disabled =
      profileResult.status === 'fulfilled' &&
      profileResult.value.data?.disabled === true;

    console.log(`[auth-hook] User ${userId}: is_admin=${isAdmin}, disabled=${disabled}`);

    const customClaims: CustomClaims = {
      is_admin: isAdmin && !disabled, // Only admin if not disabled
      disabled,
    };

    return new Response(
      JSON.stringify({
        app_metadata: customClaims,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('[auth-hook] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
