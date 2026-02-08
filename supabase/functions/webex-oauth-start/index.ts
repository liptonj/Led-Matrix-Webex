/**
 * Webex OAuth Start
 *
 * Validates device HMAC + JWT and returns a Webex authorization URL.
 */

import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";
import { verifyDeviceToken } from "../_shared/jwt.ts";

interface TokenPayload {
  pairing_code: string;
  serial_number: string;
  device_id?: string;
  token_type: string;
}

function toBase64Url(input: string): string {
  return encodeBase64(new TextEncoder().encode(input))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const tokenSecret = Deno.env.get("SUPABASE_JWT_SECRET") || Deno.env.get("DEVICE_JWT_SECRET");

    if (!tokenSecret) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing device token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.slice(7);
    const payload = (await verifyDeviceToken(token, tokenSecret)) as unknown as TokenPayload;
    if (payload.token_type !== "device" && payload.token_type !== "app") {
      return new Response(JSON.stringify({ error: "Invalid token type" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let pairingCode = payload.pairing_code;
    let serialNumber = payload.serial_number;
    let deviceId = payload.device_id ?? "";
    // Always set a timestamp for state validation (app tokens need this for callback validation)
    let ts = String(Math.floor(Date.now() / 1000));
    let sig = "";

    if (payload.token_type === "device") {
      const body = await req.text();
      const hmacResult = await validateHmacRequest(req, supabase, body);
      if (!hmacResult.valid || !hmacResult.device) {
        return new Response(JSON.stringify({ error: hmacResult.error || "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (hmacResult.device.serial_number !== payload.serial_number) {
        return new Response(JSON.stringify({ error: "Token does not match device" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      pairingCode = hmacResult.device.pairing_code;
      serialNumber = hmacResult.device.serial_number;
      deviceId = hmacResult.device.device_id ?? deviceId;
      ts = req.headers.get("X-Timestamp") || "";
      sig = req.headers.get("X-Signature") || "";
    } else {
      if (!pairingCode || !serialNumber) {
        return new Response(JSON.stringify({ error: "Token missing pairing/serial" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: clientRow, error: clientError } = await supabase
      .schema("display")
      .from("oauth_clients")
      .select("client_id, redirect_uri, active")
      .eq("provider", "webex")
      .eq("purpose", "device")
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (clientError || !clientRow) {
      return new Response(JSON.stringify({ error: "Webex client not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const statePayload = {
      pairing_code: pairingCode,
      serial: serialNumber,
      device_id: deviceId,
      ts,
      sig,
      token,
      token_type: payload.token_type,
    };

    const state = toBase64Url(JSON.stringify(statePayload));
    const authUrl = new URL("https://webexapis.com/v1/authorize");
    authUrl.searchParams.set("client_id", clientRow.client_id as string);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", clientRow.redirect_uri as string);
    authUrl.searchParams.set("scope", "spark:people_read");
    authUrl.searchParams.set("state", state);

    return new Response(JSON.stringify({ auth_url: authUrl.toString() }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("webex-oauth-start error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
