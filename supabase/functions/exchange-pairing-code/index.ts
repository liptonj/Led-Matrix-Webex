/**
 * Exchange Pairing Code for App Token
 *
 * This Edge Function exchanges a device pairing code for a short-lived
 * JWT token that the embedded app uses to authenticate with Supabase
 * (PostgREST + Realtime) without requiring a Supabase Auth user session.
 *
 * Input: { pairing_code: string }
 * Output: { serial_number, device_id, device_uuid, token, expires_at }
 *
 * The token is signed with SUPABASE_JWT_SECRET using HS256 and has a short TTL.
 */

import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { getUserFromRequest } from "../_shared/user_auth.ts";

// Token configuration
const TOKEN_TTL_SECONDS = 3600; // 1 hour
const TOKEN_ALGORITHM = "HS256";

interface ExchangeRequest {
  pairing_code: string;
}

interface ExchangeResponse {
  serial_number: string;
  device_id: string;
  device_uuid: string;
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

    // Get JWT signing material (ES256/RS256 preferred, HS256 fallback)
    // Note: This must match BRIDGE_APP_TOKEN_SECRET in bridge environment
    // for bridge token validation to work. Both should be set to the same value.
    const supabaseJwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    const deviceJwtSecret = Deno.env.get("DEVICE_JWT_SECRET");
    const deviceJwtPrivateJwk = Deno.env.get("DEVICE_JWT_PRIVATE_KEY_JWK");
    const deviceJwtKid = Deno.env.get("DEVICE_JWT_KID");
    const deviceJwtAlg = Deno.env.get("DEVICE_JWT_ALG");

    const tokenSecret = supabaseJwtSecret || deviceJwtSecret;
    if (!deviceJwtPrivateJwk && !tokenSecret) {
      console.error("DEVICE_JWT_PRIVATE_KEY_JWK or SUPABASE_JWT_SECRET/DEVICE_JWT_SECRET not configured");
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
      .select("id, serial_number, device_id, pairing_code, pairing_code_expires_at, is_provisioned")
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

    // Check if pairing code has expired
    if (device.pairing_code_expires_at) {
      const expiresAt = new Date(device.pairing_code_expires_at);
      if (expiresAt < new Date()) {
        console.log(`Pairing code expired: ${normalizedCode}`);
        return new Response(
          JSON.stringify({ error: "Pairing code expired" }),
          {
            status: 410,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const deviceUuid = device.id;

    // Look up pairing record to get user_uuid (if already paired)
    const { data: pairing } = await supabase
      .schema("display")
      .from("pairings")
      .select("device_uuid, user_uuid")
      .eq("device_uuid", deviceUuid)
      .maybeSingle();

    // Try to get authenticated user from request (optional - user may not be authenticated)
    let userUuid: string | null = null;
    const authResult = await getUserFromRequest(req);
    if (authResult.user && !authResult.error) {
      userUuid = authResult.user.id;
    }

    // Update pairings table with user_uuid if user is authenticated
    if (userUuid) {
      const { error: updateError } = await supabase
        .schema("display")
        .from("pairings")
        .upsert(
          {
            device_uuid: deviceUuid,
            user_uuid: userUuid,
            serial_number: device.serial_number,
            device_id: device.device_id,
          },
          {
            onConflict: "device_uuid",
            ignoreDuplicates: false,
          },
        );

      if (updateError) {
        console.error("Failed to update pairing with user_uuid:", updateError);
        // Continue anyway - pairing might already exist with different user
      }
    }

    // Calculate expiration
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + TOKEN_TTL_SECONDS;
    const expiresAtISO = new Date(expiresAt * 1000).toISOString();

    const payload = {
      // Supabase expects sub to be a UUID for auth.uid()
      sub: crypto.randomUUID(),
      role: "authenticated",
      aud: "authenticated",
      pairing_code: device.pairing_code,
      serial_number: device.serial_number,
      device_id: device.device_id,
      // Include device_uuid (primary identifier) and user_uuid
      device_uuid: deviceUuid,
      ...(userUuid && { user_uuid: userUuid }),
      // "token_type" is used by RLS policies (must be "app")
      token_type: "app",
      // "type" field is used by bridge for token validation (must be "app_auth")
      type: "app_auth",
      iat: getNumericDate(0),
      exp: getNumericDate(TOKEN_TTL_SECONDS),
    };

    let token: string;
    if (deviceJwtPrivateJwk) {
      let jwk: JsonWebKey;
      try {
        jwk = JSON.parse(deviceJwtPrivateJwk);
      } catch {
        console.error("DEVICE_JWT_PRIVATE_KEY_JWK is not valid JSON");
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!deviceJwtKid && !jwk.kid) {
        console.error("DEVICE_JWT_KID not configured and JWK is missing kid");
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const alg = deviceJwtAlg ?? jwk.alg ?? (jwk.kty === "EC" ? "ES256" : "RS256");
      if (alg !== "ES256" && alg !== "RS256") {
        console.error(`Unsupported DEVICE_JWT_ALG: ${alg}`);
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (alg === "ES256" && (jwk.kty !== "EC" || jwk.crv !== "P-256")) {
        console.error("DEVICE_JWT_PRIVATE_KEY_JWK must be EC P-256 for ES256");
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const jwkSanitized = { ...jwk } as JsonWebKey;
      // deno-lint-ignore no-explicit-any
      delete (jwkSanitized as any).key_ops;
      // deno-lint-ignore no-explicit-any
      delete (jwkSanitized as any).use;

      const key =
        alg === "ES256"
          ? await crypto.subtle.importKey(
              "jwk",
              jwkSanitized,
              { name: "ECDSA", namedCurve: "P-256" },
              false,
              ["sign"],
            )
          : await crypto.subtle.importKey(
              "jwk",
              jwkSanitized,
              { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
              false,
              ["sign"],
            );

      token = await create(
        { alg, typ: "JWT", kid: deviceJwtKid ?? jwk.kid },
        payload,
        key,
      );
    } else {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(tokenSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );

      token = await create(
        { alg: TOKEN_ALGORITHM, typ: "JWT" },
        payload,
        key,
      );
    }

    // Clear pairing code after successful pairing
    const { error: clearError } = await (supabase as any).schema("display").rpc("clear_pairing_code", {
      target_device_uuid: deviceUuid,
    });

    if (clearError) {
      console.error("Failed to clear pairing code:", clearError);
      // Continue anyway - token is already issued
    }

    console.log(`Token issued for device ${device.serial_number} (device_uuid: ${deviceUuid}, expires ${expiresAtISO})`);

    const response: ExchangeResponse = {
      serial_number: device.serial_number,
      device_id: device.device_id,
      device_uuid: deviceUuid,
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
