/**
 * Configure Supabase Auth Hook for JWT Claims
 *
 * This script registers the auth-hook-set-claims function as a Custom Access Token hook
 * in Supabase, so that is_admin and disabled claims are added to user JWTs automatically.
 *
 * Usage: deno run --allow-net --allow-env scripts/configure-auth-hook.ts
 */

const SUPABASE_PROJECT_REF = 'fmultmlsevqgtnqzaylg';
const SUPABASE_MANAGEMENT_API = 'https://api.supabase.com/v1';

// Get access token from environment or prompt
let accessToken = Deno.env.get('SUPABASE_ACCESS_TOKEN');

if (!accessToken) {
  console.log('SUPABASE_ACCESS_TOKEN not found in environment.');
  console.log('Get your access token from: https://supabase.com/dashboard/account/tokens');
  console.log('');

  const buf = new Uint8Array(1024);
  Deno.stdout.writeSync(new TextEncoder().encode('Enter your Supabase access token: '));
  const n = Deno.stdin.readSync(buf);
  if (n === null) {
    console.error('Failed to read token');
    Deno.exit(1);
  }
  accessToken = new TextDecoder().decode(buf.subarray(0, n)).trim();

  if (!accessToken) {
    console.error('No token provided');
    Deno.exit(1);
  }
}

// Use DEVICE_JWT_SECRET in webhook format (base64 encoded)
const hookSecret = 'v1,whsec_ODA5MzBlNTI4NTMyZGI4N2QzZDhlY2ZhNWI2YmM4MDRlZWFlNjQ5YWE2NmVlZWEyZTcxNTk0MWJiMTY1NzVhNw==';
const hookUrl = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/auth-hook-set-claims`;

console.log('Configuring Custom Access Token auth hook...');
console.log(`Project: ${SUPABASE_PROJECT_REF}`);
console.log(`Hook URL: ${hookUrl}`);

try {
  // First, get current auth config
  const getResponse = await fetch(
    `${SUPABASE_MANAGEMENT_API}/projects/${SUPABASE_PROJECT_REF}/config/auth`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!getResponse.ok) {
    const errorText = await getResponse.text();
    throw new Error(`Failed to get auth config: ${getResponse.status} ${errorText}`);
  }

  const currentConfig = await getResponse.json();
  console.log('Current auth config retrieved');

  // Update with custom access token hook
  const updatedConfig = {
    ...currentConfig,
    HOOK_CUSTOM_ACCESS_TOKEN_URI: hookUrl,
    HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: true,
    HOOK_CUSTOM_ACCESS_TOKEN_SECRETS: hookSecret,
  };

  // Apply the updated config
  const updateResponse = await fetch(
    `${SUPABASE_MANAGEMENT_API}/projects/${SUPABASE_PROJECT_REF}/config/auth`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedConfig),
    }
  );

  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    throw new Error(`Failed to update auth config: ${updateResponse.status} ${errorText}`);
  }

  console.log('✓ Auth hook configured successfully!');
  console.log('\nNext steps:');
  console.log('1. Log out of the admin portal');
  console.log('2. Log back in');
  console.log('3. Check browser console - you should see JWT claims being used (0ms instead of 160ms)');

} catch (error) {
  console.error('Error configuring auth hook:', error);
  Deno.exit(1);
}
