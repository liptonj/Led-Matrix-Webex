/**
 * Broadcast Device Log Edge Function
 *
 * Devices can publish debug/info/warn/error logs via Realtime Broadcast.
 * Intended for admin dashboards; logs are NOT stored in the database.
 *
 * Authentication:
 * - Bearer token (from device-auth) AND HMAC headers (both required)
 * - Headers: Authorization Bearer + X-Device-Serial, X-Timestamp, X-Signature
 *
 * Request body:
 *   { level: "debug"|"info"|"warn"|"error", message: string, metadata?: object }
 */

import { createClient } from "@supabase/supabase-js";
import { sendBroadcast } from "../_shared/broadcast.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { validateDeviceAuth } from "../_shared/device_auth.ts";

const MAX_LOGS_PER_MINUTE = 60;
const RATE_WINDOW_SECONDS = 60;

type LogLevel = "debug" | "info" | "warn" | "error";

interface InsertLogRequest {
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const bodyText = await req.text();

    // Authenticate: require both JWT + HMAC with serial cross-validation
    const authResult = await validateDeviceAuth(req, supabase, bodyText);
    if (!authResult.valid) {
      return new Response(JSON.stringify({ success: false, error: authResult.error }), {
        status: authResult.httpStatus || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let serialNumber = authResult.serialNumber || "";
    let deviceId = authResult.deviceId || "";
    let deviceUuid = authResult.deviceUuid || "";
    let isDebugEnabled = authResult.debugEnabled || false;

    // If we used a bearer token, fetch device_id and debug_enabled once (service role, cheap query).
    if (!deviceId || !deviceUuid || !isDebugEnabled) {
      const { data: dev } = await supabase
        .schema("display")
        .from("devices")
        .select("id, device_id, debug_enabled")
        .eq("serial_number", serialNumber)
        .single();
      if (dev) {
        if (!deviceId) deviceId = dev.device_id;
        if (!deviceUuid) deviceUuid = dev.id;
        if (!isDebugEnabled) isDebugEnabled = dev.debug_enabled === true;
      }
    }

    // Fetch user_uuid from pairings table
    let userUuid: string | null = null;
    if (deviceUuid) {
      const { data: pairing } = await supabase
        .schema("display")
        .from("pairings")
        .select("user_uuid")
        .eq("device_uuid", deviceUuid)
        .maybeSingle();
      userUuid = pairing?.user_uuid || null;
    } else {
      // Fallback: query by serial_number if device_uuid not available
      const { data: pairing } = await supabase
        .schema("display")
        .from("pairings")
        .select("user_uuid")
        .eq("serial_number", serialNumber)
        .maybeSingle();
      userUuid = pairing?.user_uuid || null;
    }

    let logData: InsertLogRequest;
    try {
      logData = JSON.parse(bodyText) as InsertLogRequest;
    } catch {
      return new Response(JSON.stringify({ success: false, error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
    const normalizedLevel =
      typeof logData.level === "string"
        ? (logData.level.toLowerCase() as LogLevel)
        : logData.level;
    if (!normalizedLevel || !validLevels.includes(normalizedLevel)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid log level" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!logData.message || typeof logData.message !== "string") {
      return new Response(JSON.stringify({ success: false, error: "Missing or invalid message" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gate high-volume levels unless debug is enabled.
    // Always keep warn/error so we don't miss real issues.
    if (!isDebugEnabled && (normalizedLevel === "debug" || normalizedLevel === "info")) {
      return new Response(JSON.stringify({ success: true, dropped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit (fail open if RPC fails; fail closed for debug/info if limited)
    const rateKey = `device:${serialNumber}:log`;
    const { data: allowed, error: rateErr } = await supabase.rpc("display_check_rate_limit", {
      rate_key: rateKey,
      max_requests: MAX_LOGS_PER_MINUTE,
      window_seconds: RATE_WINDOW_SECONDS,
    });
    if (!rateErr && allowed === false && (normalizedLevel === "debug" || normalizedLevel === "info")) {
      return new Response(JSON.stringify({ success: false, error: "Rate limit exceeded" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "5" },
      });
    }

    // Prepare broadcast payload
    const broadcastPayload = {
      device_uuid: deviceUuid,
      serial_number: serialNumber,
      level: normalizedLevel,
      message: logData.message,
      metadata: logData.metadata || {},
      ts: Date.now(),
    };

    // Always broadcast to device channel if deviceUuid is available
    if (deviceUuid) {
      try {
        await sendBroadcast(`device:${deviceUuid}`, "debug_log", broadcastPayload);
        console.log(`[broadcast-device-log] Broadcast successful to device:${deviceUuid}`);
      } catch (err) {
        console.error("[broadcast-device-log] Device channel broadcast failed:", err);
        return new Response(JSON.stringify({ success: false, error: "Failed to broadcast log" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Also broadcast to user channel if user_uuid is available (for embedded app)
    if (userUuid) {
      try {
        await sendBroadcast(`user:${userUuid}`, "debug_log", broadcastPayload);
        console.log(`[broadcast-device-log] Broadcast successful to user:${userUuid}`);
      } catch (err) {
        console.error("[broadcast-device-log] User channel broadcast failed:", err);
        // Don't fail the request if user channel broadcast fails, device channel is primary
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ success: false, error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
