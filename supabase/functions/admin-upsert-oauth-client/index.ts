/**
 * Admin Upsert OAuth Client Edge Function
 *
 * Creates or updates OAuth client metadata and stores client secret in Vault.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAdminUser } from "../_shared/admin_auth.ts";

interface UpsertOAuthClientRequest {
  provider: string;
  client_id: string;
  client_secret?: string;
  redirect_uri?: string;
  active?: boolean;
}

serve(async (req: Request) => {
  const runtimeEnv =
    Deno.env.get("SUPABASE_ENV") ||
    Deno.env.get("ENVIRONMENT") ||
    Deno.env.get("NODE_ENV") ||
    "development";
  const authHeader = req.headers.get("Authorization") || "";
  const debugEnabled =
    Deno.env.get("ADMIN_UPSERT_OAUTH_DEBUG") === "1" ||
    req.headers.get("x-debug-auth") === "1";
  const redactHeader = (name: string, value: string) => {
    const key = name.toLowerCase();
    if (key === "authorization" || key === "apikey" || key === "cookie") {
      return "[redacted]";
    }
    return value;
  };
  const safeHeaders: Record<string, string> = {};
  for (const [name, value] of req.headers.entries()) {
    safeHeaders[name] = redactHeader(name, value);
  }

  console.log("admin-upsert-oauth-client request start", {
    method: req.method,
    url: req.url,
    env: runtimeEnv,
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    userAgent: req.headers.get("user-agent"),
    host: req.headers.get("host"),
    contentType: req.headers.get("content-type"),
    contentLength: req.headers.get("content-length"),
    cfRay: req.headers.get("cf-ray"),
    cfConnectingIp: req.headers.get("cf-connecting-ip"),
    xForwardedFor: req.headers.get("x-forwarded-for"),
    xRealIp: req.headers.get("x-real-ip"),
    hasAuthHeader: Boolean(authHeader),
  });
  if (debugEnabled) {
    console.log("admin-upsert-oauth-client request headers", safeHeaders);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify(
        debugEnabled
          ? { error: "Method not allowed", debug: { stage: "method_not_allowed" } }
          : { error: "Method not allowed" },
      ),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (debugEnabled) {
      console.log("admin-upsert-oauth-client auth header", {
        hasAuthHeader: Boolean(authHeader),
      });
    }

    const auth = await requireAdminUser(req, {
      corsHeaders,
      debug: debugEnabled,
      requestId: req.headers.get("sb-request-id"),
      logPrefix: "admin-upsert-oauth-client",
      allowServiceRole: true,
    });
    if (auth.response) return auth.response;

    const serviceClient = auth.serviceClient ?? createClient(supabaseUrl, serviceKey);

    const body: UpsertOAuthClientRequest = await req.json();
    const provider = body.provider?.trim().toLowerCase();
    const clientId = body.client_id?.trim();
    const clientSecret = body.client_secret?.trim();
    const redirectUri = body.redirect_uri?.trim() || "https://display.5ls.us/callback";
    const active = body.active !== false;

    if (!provider || !clientId) {
      console.warn("admin-upsert-oauth-client missing fields", {
        provider: provider || null,
        clientIdLength: clientId?.length || 0,
      });
      const payload = debugEnabled
        ? {
            error: "Missing required fields: provider, client_id",
            debug: {
              stage: "missing_fields",
              requestId: req.headers.get("sb-request-id"),
              provider: provider || null,
              clientIdLength: clientId?.length || 0,
            },
          }
        : { error: "Missing required fields: provider, client_id" };
      return new Response(JSON.stringify(payload), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existing, error: lookupError } = await serviceClient
      .schema("display")
      .from("oauth_clients")
      .select("id, client_secret_id")
      .eq("provider", provider)
      .eq("client_id", clientId)
      .maybeSingle();

    if (lookupError) {
      console.warn("admin-upsert-oauth-client lookup failed", {
        error: lookupError.message,
      });
      const payload = debugEnabled
        ? {
            error: lookupError.message,
            debug: {
              stage: "lookup",
              requestId: req.headers.get("sb-request-id"),
            },
          }
        : { error: lookupError.message };
      return new Response(JSON.stringify(payload), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let clientSecretId = existing?.client_secret_id ?? null;

    if (clientSecret) {
      const secretName = `${provider}_client_secret_${clientId}`;

      if (clientSecretId) {
        const { error: secretError } = await serviceClient.schema("display").rpc("vault_update_secret", {
          p_secret_id: clientSecretId,
          p_secret: clientSecret,
          p_name: secretName,
          p_description: null,
          p_key_id: null,
        });

        if (secretError) {
          console.warn("admin-upsert-oauth-client secret update failed", {
            error: secretError?.message || null,
            secretName,
          });
          const payload = debugEnabled
            ? {
                error: secretError?.message || "Failed to update secret",
                debug: {
                  stage: "secret_update",
                  requestId: req.headers.get("sb-request-id"),
                },
              }
            : { error: secretError?.message || "Failed to update secret" };
          return new Response(JSON.stringify(payload), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        const { data: secretData, error: secretError } = await serviceClient
          .schema("display")
          .rpc("vault_create_secret", {
            p_name: secretName,
            p_secret: clientSecret,
          });

        if (secretError || !secretData) {
          console.warn("admin-upsert-oauth-client secret store failed", {
            error: secretError?.message || null,
            hasSecretData: Boolean(secretData),
            secretName,
          });
          const payload = debugEnabled
            ? {
                error: secretError?.message || "Failed to store secret",
                debug: {
                  stage: "secret_store",
                  requestId: req.headers.get("sb-request-id"),
                  hasSecretData: Boolean(secretData),
                },
              }
            : { error: secretError?.message || "Failed to store secret" };
          return new Response(JSON.stringify(payload), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        clientSecretId = secretData as string;
      }
    }

    if (!clientSecretId) {
      console.warn("admin-upsert-oauth-client missing client secret id", {
        provider,
        clientIdLength: clientId.length,
      });
      const payload = debugEnabled
        ? {
            error: "Client secret required for new provider",
            debug: {
              stage: "missing_secret_id",
              requestId: req.headers.get("sb-request-id"),
              provider,
              clientIdLength: clientId.length,
            },
          }
        : { error: "Client secret required for new provider" };
      return new Response(JSON.stringify(payload), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: saved, error: upsertError } = await serviceClient
      .schema("display")
      .from("oauth_clients")
      .upsert(
        {
          provider,
          client_id: clientId,
          client_secret_id: clientSecretId,
          redirect_uri: redirectUri,
          active,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider,client_id" },
      )
      .select("id, provider, client_id, redirect_uri, active")
      .single();

    if (upsertError) {
      console.warn("admin-upsert-oauth-client upsert failed", {
        error: upsertError.message,
      });
      const payload = debugEnabled
        ? {
            error: upsertError.message,
            debug: {
              stage: "upsert",
              requestId: req.headers.get("sb-request-id"),
            },
          }
        : { error: upsertError.message };
      return new Response(JSON.stringify(payload), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, client: saved }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Admin upsert oauth client error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
