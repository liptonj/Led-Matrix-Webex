/**
 * Exchange Pairing Code for App Token
 *
 * This Edge Function exchanges a device pairing code for a short-lived
 * JWT token that the embedded app uses to authenticate with Supabase
 * (PostgREST + Realtime) without requiring a Supabase Auth user session.
 *
 * Input: { pairing_code: string }
 * Output: { serial_number, device_id, token, expires_at }
 *
 * The token is signed with SUPABASE_JWT_SECRET using HS256 and has a short TTL.
 */

import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Token configuration
const TOKEN_TTL_SECONDS = 3600; // 1 hour
const TOKEN_ALGORITHM = "HS256";

interface ExchangeRequest {
  pairing_code: string;
}

interface ExchangeResponse {
  serial_number: string;
  device_id: string;
  token: string;
  expires_at: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only allow POST requests
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Parse request body
    let body: ExchangeRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { pairing_code } = body;

    if (!pairing_code || typeof pairing_code !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid pairing_code" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Normalize pairing code to uppercase
    const normalizedCode = pairing_code.toUpperCase().trim();

    if (normalizedCode.length !== 6) {
      return new Response(
        JSON.stringify({ error: "Pairing code must be 6 characters" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get Supabase JWT signing secret (required for PostgREST/Realtime auth)
    // Note: This must match BRIDGE_APP_TOKEN_SECRET in bridge environment
    // for bridge token validation to work. Both should be set to the same value.
    const tokenSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (!tokenSecret) {
      console.error("SUPABASE_JWT_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Look up device by pairing code
    const { data: device, error: dbError } = await supabase
      .schema("display")
      .from("devices")
      .select("serial_number, device_id, pairing_code, is_provisioned")
      .eq("pairing_code", normalizedCode)
      .single();

    if (dbError || !device) {
      console.log(`Pairing code not found: ${normalizedCode}`);
      return new Response(
        JSON.stringify({ error: "Invalid pairing code" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Calculate expiration
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + TOKEN_TTL_SECONDS;
    const expiresAtISO = new Date(expiresAt * 1000).toISOString();

    // Create JWT token
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(tokenSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );

    const token = await create(
      { alg: TOKEN_ALGORITHM, typ: "JWT" },
      {
        // Supabase expects sub to be a UUID for auth.uid()
        sub: crypto.randomUUID(),
        role: "authenticated",
        aud: "authenticated",
        pairing_code: device.pairing_code,
        serial_number: device.serial_number,
        device_id: device.device_id,
        // "token_type" is used by RLS policies (must be "app")
        token_type: "app",
        // "type" field is used by bridge for token validation (must be "app_auth")
        type: "app_auth",
        iat: getNumericDate(0),
        exp: getNumericDate(TOKEN_TTL_SECONDS),
      },
      key,
    );

    console.log(`Token issued for device ${device.serial_number} (expires ${expiresAtISO})`);

    const response: ExchangeResponse = {
      serial_number: device.serial_number,
      device_id: device.device_id,
      token,
      expires_at: expiresAtISO,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
