/**
 * Insert Device Log Edge Function
 *
 * Devices can publish debug/info/warn/error logs into display.device_logs.
 * Intended for admin troubleshooting via Supabase Realtime on device_logs.
 *
 * Authentication:
 * - Bearer token (from device-auth), signed with SUPABASE_JWT_SECRET, OR
 * - HMAC headers (X-Device-Serial, X-Timestamp, X-Signature)
 *
 * Request body:
 *   { level: "debug"|"info"|"warn"|"error", message: string, metadata?: object }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";

const MAX_LOGS_PER_MINUTE = 60;
const RATE_WINDOW_SECONDS = 60;

type LogLevel = "debug" | "info" | "warn" | "error";

interface InsertLogRequest {
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

interface TokenPayload {
  sub: string;
  role: string;
  aud: string;
  pairing_code: string;
  serial_number: string;
  device_id: string;
  token_type: string;
  exp: number;
}

async function validateBearerToken(
  authHeader: string | null,
  tokenSecret: string,
): Promise<{ valid: boolean; error?: string; device?: TokenPayload }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.substring(7);

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(tokenSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const payload = (await verify(token, key)) as unknown as TokenPayload;

    if (payload.token_type !== "device") {
      return { valid: false, error: "Invalid token type" };
    }

    if (!payload.serial_number || !payload.device_id) {
      return { valid: false, error: "Invalid token payload" };
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

    const tokenSecret = Deno.env.get("SUPABASE_JWT_SECRET") || Deno.env.get("DEVICE_JWT_SECRET");
    if (!tokenSecret) {
      console.error("SUPABASE_JWT_SECRET/DEVICE_JWT_SECRET not configured");
      return new Response(JSON.stringify({ success: false, error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const bodyText = await req.text();

    let serialNumber = "";
    let deviceId = "";
    let isDebugEnabled = false;

    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const tokenResult = await validateBearerToken(authHeader, tokenSecret);
      if (!tokenResult.valid || !tokenResult.device) {
        return new Response(JSON.stringify({ success: false, error: tokenResult.error }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      serialNumber = tokenResult.device.serial_number;
      deviceId = tokenResult.device.device_id;
    } else {
      const hmacResult = await validateHmacRequest(req, supabase, bodyText);
      if (!hmacResult.valid || !hmacResult.device) {
        return new Response(JSON.stringify({ success: false, error: hmacResult.error }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      serialNumber = hmacResult.device.serial_number;
      deviceId = hmacResult.device.device_id;
      isDebugEnabled = hmacResult.device.debug_enabled;
    }

    // If we used a bearer token, fetch debug_enabled once (service role, cheap query).
    if (!isDebugEnabled) {
      const { data: dev } = await supabase
        .schema("display")
        .from("devices")
        .select("debug_enabled")
        .eq("serial_number", serialNumber)
        .single();
      isDebugEnabled = dev?.debug_enabled === true;
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
    if (!logData.level || !validLevels.includes(logData.level)) {
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
    if (!isDebugEnabled && (logData.level === "debug" || logData.level === "info")) {
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
    if (!rateErr && allowed === false && (logData.level === "debug" || logData.level === "info")) {
      return new Response(JSON.stringify({ success: false, error: "Rate limit exceeded" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "5" },
      });
    }

    const { error: insertErr } = await supabase
      .schema("display")
      .from("device_logs")
      .insert({
        serial_number: serialNumber,
        device_id: deviceId,
        level: logData.level,
        message: logData.message,
        metadata: logData.metadata || {},
      });

    if (insertErr) {
      console.error("Failed to insert device log:", insertErr);
      return new Response(JSON.stringify({ success: false, error: "Failed to insert log" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

