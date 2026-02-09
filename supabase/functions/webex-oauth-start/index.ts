/**
 * Webex OAuth Start
 *
 * Two modes:
 * 1. Create Mode (with Authorization header): Device creates a nonce, returns nonce + page_url
 * 2. Resolve Mode (no Authorization header): Browser resolves nonce to get OAuth URL
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { validateHmacRequest } from "../_shared/hmac.ts";
import { verifyDeviceToken, type TokenPayload } from "../_shared/jwt.ts";

interface ExtendedTokenPayload extends TokenPayload {
  device_id?: string;
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

    // CREATE MODE: Device creates a nonce
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = (await verifyDeviceToken(token, tokenSecret)) as unknown as ExtendedTokenPayload;

      if (payload.token_type !== "device" && payload.token_type !== "app") {
        return new Response(JSON.stringify({ error: "Invalid token type" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let serialNumber = payload.serial_number;
      let deviceId: string | undefined = payload.device_id;
      let deviceUuid = payload.device_uuid;
      let userUuid = payload.user_uuid ?? null;

      // For device tokens: validate HMAC and cross-validate serial
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

        serialNumber = hmacResult.device.serial_number;
        deviceId = hmacResult.device.device_id ?? deviceId;
      } else {
        // For app tokens: require serial_number and device_uuid in JWT payload
        if (!serialNumber) {
          return new Response(JSON.stringify({ error: "Token missing serial_number" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!deviceUuid) {
          return new Response(JSON.stringify({ error: "Token missing device_uuid" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Create nonce
      const { data: nonceRow, error: nonceError } = await supabase
        .schema("display")
        .from("oauth_nonces")
        .insert({
          serial_number: serialNumber,
          device_id: deviceId,
          device_uuid: deviceUuid,
          user_uuid: userUuid,
          token_type: payload.token_type,
        })
        .select("nonce")
        .single();

      if (nonceError || !nonceRow) {
        console.error("Failed to create nonce:", nonceError);
        return new Response(JSON.stringify({ error: "Failed to create nonce" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          nonce: nonceRow.nonce,
          page_url: `https://display.5ls.us/webexauth?nonce=${nonceRow.nonce}&serial=${serialNumber}`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // RESOLVE MODE: Browser resolves nonce to get OAuth URL
    const bodyText = await req.text();
    let body: { nonce?: string };
    try {
      body = JSON.parse(bodyText);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.nonce) {
      return new Response(JSON.stringify({ error: "Missing nonce" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up nonce
    const { data: nonceRow, error: nonceError } = await supabase
      .schema("display")
      .from("oauth_nonces")
      .select("serial_number, device_id, device_uuid, user_uuid, token_type")
      .eq("nonce", body.nonce)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (nonceError || !nonceRow) {
      return new Response(JSON.stringify({ error: "Invalid or expired nonce" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up OAuth client config
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

    // Build Webex OAuth URL with state=nonce (plain nonce string)
    const authUrl = new URL("https://webexapis.com/v1/authorize");
    authUrl.searchParams.set("client_id", clientRow.client_id as string);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", clientRow.redirect_uri as string);
    authUrl.searchParams.set("scope", "spark:people_read");
    authUrl.searchParams.set("state", body.nonce);

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
