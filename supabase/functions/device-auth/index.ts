/**
 * Device Authentication Edge Function
 *
 * Authenticates ESP32 devices using HMAC-SHA256 signatures and returns
 * a device token for subsequent API calls.
 *
 * Headers (HMAC auth):
 *   X-Device-Serial: Device serial number (8-char CRC32)
 *   X-Timestamp: Unix timestamp (seconds)
 *   X-Signature: Base64-encoded HMAC-SHA256 signature
 *
 * Response:
 *   {
 *     success: true,
 *     serial_number: string,
 *     pairing_code: string,
 *     device_id: string,
 *     token: string,
 *     expires_at: string,
 *     target_firmware_version: string | null
 *     anon_key: string | null
 *   }
 */

import { createClient } from "@supabase/supabase-js";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";

// Device token configuration
const DEVICE_TOKEN_TTL_SECONDS = 86400; // 24 hours
const TOKEN_ALGORITHM = "HS256";

interface DeviceAuthResponse {
  success: boolean;
  serial_number: string;
  pairing_code: string;
  device_id: string;
  device_uuid: string;
  user_uuid: string | null;
  token: string;
  expires_at: string;
  target_firmware_version: string | null;
  debug_enabled: boolean;
  anon_key: string | null;
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
        JSON.stringify({ success: false, error: "Method not allowed" }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get JWT signing material (RS256 preferred, HS256 fallback)
    const supabaseJwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    const deviceJwtSecret = Deno.env.get("DEVICE_JWT_SECRET");
    const deviceJwtPrivateJwk = Deno.env.get("DEVICE_JWT_PRIVATE_KEY_JWK");
    const deviceJwtKid = Deno.env.get("DEVICE_JWT_KID");
    const deviceJwtAlg = Deno.env.get("DEVICE_JWT_ALG");
    console.log(`Device auth SUPABASE_JWT_SECRET: ${supabaseJwtSecret ?? "null"}`);
    console.log(`Device auth DEVICE_JWT_SECRET: ${deviceJwtSecret ?? "null"}`);
    console.log(`Device auth DEVICE_JWT_PRIVATE_KEY_JWK: ${deviceJwtPrivateJwk ?? "null"}`);
    console.log(`Device auth DEVICE_JWT_KID: ${deviceJwtKid ?? "null"}`);

    const tokenSecret = supabaseJwtSecret || deviceJwtSecret;
    const tokenSource = deviceJwtPrivateJwk
      ? "DEVICE_JWT_PRIVATE_KEY_JWK"
      : supabaseJwtSecret
      ? "SUPABASE_JWT_SECRET"
      : deviceJwtSecret
      ? "DEVICE_JWT_SECRET"
      : "none";
    console.log(`Device auth token secret source: ${tokenSource}`);

    if (!deviceJwtPrivateJwk && !tokenSecret) {
      console.error("DEVICE_JWT_PRIVATE_KEY_JWK or SUPABASE_JWT_SECRET/DEVICE_JWT_SECRET not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
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

    // Read body for HMAC validation
    const body = await req.text();

    // Validate HMAC signature
    const validation = await validateHmacRequest(req, supabase, body);

    if (!validation.valid || !validation.device) {
      console.log(`Device auth failed: ${validation.error}`);
      return new Response(
        JSON.stringify({ success: false, error: validation.error }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const device = validation.device;

    // Get device UUID from devices table
    const { data: deviceRecord, error: deviceRecordError } = await (supabase as any)
      .schema("display")
      .from("devices")
      .select("id")
      .eq("serial_number", device.serial_number)
      .single();

    if (deviceRecordError || !deviceRecord) {
      console.error("Failed to fetch device UUID:", deviceRecordError);
      return new Response(
        JSON.stringify({ success: false, error: "Device record not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const deviceUuid = deviceRecord.id;

    // Ensure pairing row exists (upsert) with device_uuid as conflict target (PK post-migration)
    const { error: pairingError } = await (supabase as any)
      .schema("display")
      .from("pairings")
      .upsert(
        {
          device_uuid: deviceUuid,
          serial_number: device.serial_number,
          device_id: device.device_id,
          device_connected: true,
          device_last_seen: new Date().toISOString(),
        },
        {
          onConflict: "device_uuid",
          ignoreDuplicates: false,
        },
      );

    if (pairingError) {
      console.error("Failed to upsert pairing:", pairingError);
      // Continue anyway - pairing might already exist
    }

    // Get user_uuid from pairings table (null if not assigned)
    const { data: pairingRecord } = await (supabase as any)
      .schema("display")
      .from("pairings")
      .select("user_uuid")
      .eq("device_uuid", deviceUuid)
      .maybeSingle();

    const userUuid = pairingRecord?.user_uuid || null;

    // Calculate token expiration
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + DEVICE_TOKEN_TTL_SECONDS;
    const expiresAtISO = new Date(expiresAt * 1000).toISOString();

    // Create JWT token for device
    const payload = {
      sub: crypto.randomUUID(),
      role: "authenticated",
      aud: "authenticated",
      serial_number: device.serial_number,
      token_type: "device",
      device_uuid: deviceUuid,
      user_uuid: userUuid,
      iat: getNumericDate(0),
      exp: getNumericDate(DEVICE_TOKEN_TTL_SECONDS),
    };

    let token: string;
    if (deviceJwtPrivateJwk) {
      let jwk: JsonWebKey;
      try {
        jwk = JSON.parse(deviceJwtPrivateJwk);
      } catch {
        console.error("DEVICE_JWT_PRIVATE_KEY_JWK is not valid JSON");
        return new Response(
          JSON.stringify({ success: false, error: "Server configuration error" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!deviceJwtKid && !jwk.kid) {
        console.error("DEVICE_JWT_KID not configured and JWK is missing kid");
        return new Response(
          JSON.stringify({ success: false, error: "Server configuration error" }),
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
          JSON.stringify({ success: false, error: "Server configuration error" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (alg === "ES256" && (jwk.kty !== "EC" || jwk.crv !== "P-256")) {
        console.error("DEVICE_JWT_PRIVATE_KEY_JWK must be EC P-256 for ES256");
        return new Response(
          JSON.stringify({ success: false, error: "Server configuration error" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const jwkSanitized = { ...jwk } as JsonWebKey & { kid?: string };
      // Deno importKey is strict about key_ops/use; remove to avoid validation errors.
      // We only need the private key material for signing here.
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

      const kid = deviceJwtKid ?? jwkSanitized.kid;
      token = await create(
        { alg, typ: "JWT", ...(kid ? { kid } : {}) },
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

    console.log(
      `Device token issued for ${device.serial_number} (expires ${expiresAtISO})`,
    );

    const anonKey =
      Deno.env.get("DEVICE_ANON_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY") ??
      null;
    console.log(`Device auth anon_key: ${anonKey ?? "null"}`);

    const response: DeviceAuthResponse = {
      success: true,
      serial_number: device.serial_number,
      pairing_code: device.pairing_code,
      device_id: device.device_id,
      device_uuid: deviceUuid,
      user_uuid: userUuid,
      token,
      expires_at: expiresAtISO,
      target_firmware_version: device.target_firmware_version,
      debug_enabled: device.debug_enabled,
      anon_key: anonKey,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
