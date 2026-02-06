/**
 * Post Device State Edge Function
 *
 * Devices post their current state (telemetry) and receive an echo
 * of the telemetry plus app status in response.
 *
 * Authentication: Bearer token (from device-auth) OR HMAC headers
 *
 * Request body:
 *   {
 *     rssi: number,          // WiFi signal strength
 *     free_heap: number,     // Free memory in bytes
 *     uptime: number,        // Uptime in seconds
 *     temperature?: number   // Optional temperature reading
 *     firmware_version?: string
 *     ssid?: string
 *     ota_partition?: string
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     rssi?: number,
 *     free_heap?: number,
 *     uptime?: number,
 *     temperature?: number,
 *     firmware_version?: string,
 *     ssid?: string,
 *     ota_partition?: string,
 *     debug_enabled?: boolean,
 *     app_connected?: boolean,
 *     webex_status?: string,
 *     camera_on?: boolean,
 *     mic_muted?: boolean,
 *     in_call?: boolean,
 *     display_name?: string | null
 *   }
 *
 * Rate limited: 12 requests per minute per device
 */

import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";

// Rate limit configuration
const MAX_REQUESTS_PER_MINUTE = 12;
const RATE_WINDOW_SECONDS = 60;

interface DeviceStateRequest {
  rssi?: number;
  free_heap?: number;
  uptime?: number;
  temperature?: number;
  firmware_version?: string;
  ssid?: string;
  ota_partition?: string;
}

interface DeviceStateResponse {
  success: boolean;
  rssi?: number;
  free_heap?: number;
  uptime?: number;
  temperature?: number;
  firmware_version?: string;
  ssid?: string;
  ota_partition?: string;
  debug_enabled?: boolean;
  app_connected?: boolean;
  webex_status?: string;
  camera_on?: boolean;
  mic_muted?: boolean;
  in_call?: boolean;
  display_name?: string | null;
}

interface TokenPayload {
  sub: string;
  pairing_code: string;
  serial_number: string;
  token_type: string;
  exp: number;
  device_uuid?: string;
}

/**
 * Validate bearer token and return device info
 */
async function validateBearerToken(
  authHeader: string | null,
  tokenSecret: string,
): Promise<{ valid: boolean; error?: string; device?: TokenPayload }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.substring(7);

  try {
    const payload = await verifyDeviceToken(token, tokenSecret);

    // Verify token type
  if (payload.token_type !== "device") {
      return { valid: false, error: "Invalid token type" };
    }

    return { valid: true, device: payload };
  } catch (err) {
    if (err instanceof Error && err.message.includes("expired")) {
      return { valid: false, error: "Token expired" };
    }
    return { valid: false, error: "Invalid token" };
  }
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

    // Get Supabase JWT signing secret (required for PostgREST/Realtime auth)
    const tokenSecret = Deno.env.get("SUPABASE_JWT_SECRET") || Deno.env.get("DEVICE_JWT_SECRET");
    if (!tokenSecret) {
      console.error("SUPABASE_JWT_SECRET/DEVICE_JWT_SECRET not configured");
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

    // Read body
    const body = await req.text();
    let deviceInfo: { serial_number: string; pairing_code: string };

    // Try bearer token first, fall back to HMAC
    const authHeader = req.headers.get("Authorization");

    if (authHeader?.startsWith("Bearer ")) {
      const tokenResult = await validateBearerToken(authHeader, tokenSecret);
      if (!tokenResult.valid || !tokenResult.device) {
        return new Response(
          JSON.stringify({ success: false, error: tokenResult.error }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      deviceInfo = {
        serial_number: tokenResult.device.serial_number,
        pairing_code: tokenResult.device.pairing_code,
      };
    } else {
      // Fall back to HMAC authentication
      const hmacResult = await validateHmacRequest(req, supabase, body);
      if (!hmacResult.valid || !hmacResult.device) {
        return new Response(
          JSON.stringify({ success: false, error: hmacResult.error }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      deviceInfo = {
        serial_number: hmacResult.device.serial_number,
        pairing_code: hmacResult.device.pairing_code,
      };
    }

    // Check rate limit using public schema wrapper
    const rateLimitKey = `device:${deviceInfo.serial_number}:post-state`;
    const { data: rateLimitResult, error: rateLimitError } = await supabase
      .rpc("display_check_rate_limit", {
        rate_key: rateLimitKey,
        max_requests: MAX_REQUESTS_PER_MINUTE,
        window_seconds: RATE_WINDOW_SECONDS,
      });

    // If rate limit check fails, log but continue (fail open)
    if (rateLimitError) {
      console.error("Rate limit check failed:", rateLimitError);
      // Continue processing - don't block on rate limit errors
    }

    if (rateLimitResult === false) {
      console.log(`Rate limited: ${deviceInfo.serial_number}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Rate limit exceeded. Max 12 requests per minute.",
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": "5",
          },
        },
      );
    }

    // Parse request body
    let stateData: DeviceStateRequest = {};
    if (body) {
      try {
        stateData = JSON.parse(body);
      } catch {
        // Body might be empty for simple heartbeat
      }
    }

    const now = new Date().toISOString();

    // Always fetch current debug_enabled so devices can react without separate realtime channel.
    const { data: dev } = await supabase
      .schema("display")
      .from("devices")
      .select("debug_enabled")
      .eq("serial_number", deviceInfo.serial_number)
      .single();

    // Fetch app status from pairings table
    const { data: pairingData } = await supabase
      .schema("display")
      .from("pairings")
      .select("webex_status, camera_on, mic_muted, in_call, display_name, app_connected")
      .eq("pairing_code", deviceInfo.pairing_code)
      .single();

    // ALWAYS update heartbeat table (does NOT trigger realtime to device)
    // Include device_uuid for UUID-based queries
    await supabase
      .schema("display")
      .from("connection_heartbeats")
      .upsert({
        pairing_code: deviceInfo.pairing_code,
        device_uuid: deviceInfo.device_uuid || null,
        device_last_seen: now,
        device_connected: true,
      }, { onConflict: "pairing_code" });

    // Build telemetry update data (only include fields that are provided)
    const telemetryData: Record<string, unknown> = {};
    let hasTelemetryUpdate = false;

    if (typeof stateData.rssi === "number") {
      telemetryData.rssi = stateData.rssi;
      hasTelemetryUpdate = true;
    }
    if (typeof stateData.free_heap === "number") {
      telemetryData.free_heap = stateData.free_heap;
      hasTelemetryUpdate = true;
    }
    if (typeof stateData.uptime === "number") {
      telemetryData.uptime = stateData.uptime;
      hasTelemetryUpdate = true;
    }
    if (typeof stateData.temperature === "number") {
      telemetryData.temperature = stateData.temperature;
      hasTelemetryUpdate = true;
    }
    if (typeof stateData.firmware_version === "string" && stateData.firmware_version) {
      telemetryData.firmware_version = stateData.firmware_version;
      hasTelemetryUpdate = true;
    }
    if (typeof stateData.ssid === "string" && stateData.ssid) {
      telemetryData.ssid = stateData.ssid;
      hasTelemetryUpdate = true;
    }
    if (typeof stateData.ota_partition === "string" && stateData.ota_partition) {
      telemetryData.ota_partition = stateData.ota_partition;
      hasTelemetryUpdate = true;
    }

    // Only update pairings table if there's telemetry data (reduces realtime noise)
    // Pure heartbeats (no telemetry) only update the heartbeat table
    let updateError: { code?: string; message?: string } | null = null;

    if (hasTelemetryUpdate) {
      const { error } = await supabase
        .schema("display")
        .from("pairings")
        .update(telemetryData)
        .eq("pairing_code", deviceInfo.pairing_code)
        .select("pairing_code")
        .single();
      updateError = error;
    }

    if (updateError) {
      // If pairing doesn't exist, try to create it
      if (updateError.code === "PGRST116") {
        // No rows returned - pairing doesn't exist
        const { error: insertError } = await supabase
          .schema("display")
          .from("pairings")
          .insert({
            pairing_code: deviceInfo.pairing_code,
            serial_number: deviceInfo.serial_number,
            ...telemetryData,
          });

        if (insertError) {
          console.error("Failed to create pairing:", insertError);
        }

        // Also ensure heartbeat record exists with device_uuid
        await supabase
          .schema("display")
          .from("connection_heartbeats")
          .upsert({
            pairing_code: deviceInfo.pairing_code,
            device_uuid: deviceInfo.device_uuid || null,
            device_last_seen: now,
            device_connected: true,
          }, { onConflict: "pairing_code" });

        // Return telemetry echo with app state
        const response: DeviceStateResponse = {
          success: true,
          rssi: stateData.rssi,
          free_heap: stateData.free_heap,
          uptime: stateData.uptime,
          temperature: stateData.temperature,
          firmware_version: stateData.firmware_version,
          ssid: stateData.ssid,
          ota_partition: stateData.ota_partition,
          debug_enabled: dev?.debug_enabled === true,
          app_connected: pairingData?.app_connected || false,
          webex_status: pairingData?.webex_status || "offline",
          camera_on: pairingData?.camera_on || false,
          mic_muted: pairingData?.mic_muted || false,
          in_call: pairingData?.in_call || false,
          display_name: pairingData?.display_name || null,
        };

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.error("Failed to update pairing:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update state" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Return telemetry echo with app state
    const response: DeviceStateResponse = {
      success: true,
      rssi: stateData.rssi,
      free_heap: stateData.free_heap,
      uptime: stateData.uptime,
      temperature: stateData.temperature,
      firmware_version: stateData.firmware_version,
      ssid: stateData.ssid,
      ota_partition: stateData.ota_partition,
      debug_enabled: dev?.debug_enabled === true,
      app_connected: pairingData?.app_connected || false,
      webex_status: pairingData?.webex_status || "offline",
      camera_on: pairingData?.camera_on || false,
      mic_muted: pairingData?.mic_muted || false,
      in_call: pairingData?.in_call || false,
      display_name: pairingData?.display_name || null,
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
