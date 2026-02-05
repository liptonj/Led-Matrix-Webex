/**
 * Shared admin authentication helper for Edge Functions.
 *
 * Validates the caller's JWT via the anon key, then verifies membership
 * in the display.admin_users allowlist using the service role key.
 * Optional: allow service role token to bypass user/admin checks.
 */

import { createClient } from "@supabase/supabase-js";

interface AdminAuthOptions {
  corsHeaders?: Record<string, string>;
  debug?: boolean;
  requestId?: string | null;
  logPrefix?: string;
  adminSchema?: string;
  adminTable?: string;
  allowServiceRole?: boolean;
}

interface AdminAuthResult {
  response?: Response;
  requesterId?: string | null;
  serviceClient?: ReturnType<typeof createClient>;
}

function buildJsonResponse(
  payload: Record<string, unknown>,
  status: number,
  corsHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...(corsHeaders || {}), "Content-Type": "application/json" },
  });
}

export async function requireAdminUser(
  req: Request,
  options: AdminAuthOptions = {},
): Promise<AdminAuthResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const logPrefix = options.logPrefix || "admin-auth";
  const adminSchema = options.adminSchema || "display";
  const adminTable = options.adminTable || "admin_users";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  const authOptions = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  };

  if (options.allowServiceRole && token && token === serviceKey) {
    const serviceClient =
      createClient(supabaseUrl, serviceKey, authOptions) as ReturnType<
        typeof createClient
      >;
    return { requesterId: null, serviceClient };
  }

  if (!authHeader) {
    const payload = options.debug
      ? {
          error: "Unauthorized",
          debug: {
            stage: "missing_auth",
            requestId: options.requestId ?? null,
            hasAuthHeader: false,
          },
        }
      : { error: "Unauthorized" };
    return { response: buildJsonResponse(payload, 401, options.corsHeaders) };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    ...authOptions,
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError) {
    console.warn(`${logPrefix} getUser failed`, { message: userError.message });
  }
  if (userError || !userData?.user) {
    const payload = options.debug
      ? {
          error: "Unauthorized",
          debug: {
            stage: "auth_get_user",
            requestId: options.requestId ?? null,
            hasAuthHeader: Boolean(authHeader),
            userError: userError?.message || null,
          },
        }
      : { error: "Unauthorized" };
    return {
      response: buildJsonResponse(payload, 401, options.corsHeaders),
    };
  }

  const requesterId = userData.user.id;
  const serviceClient =
    createClient(supabaseUrl, serviceKey, authOptions) as ReturnType<
      typeof createClient
    >;

  const adminClient = serviceClient as unknown as {
    schema: (schema: string) => {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
          };
        };
      };
    };
  };

  const { data: adminRow, error: adminCheckError } = await adminClient
    .schema(adminSchema)
    .from(adminTable)
    .select("user_id")
    .eq("user_id", requesterId)
    .maybeSingle();

  if (adminCheckError || !adminRow) {
    console.warn(`${logPrefix} admin check failed`, {
      hasAdminRow: Boolean(adminRow),
      error: adminCheckError?.message || null,
    });
    const payload = options.debug
      ? {
          error: "Forbidden",
          debug: {
            stage: "admin_check",
            requestId: options.requestId ?? null,
            hasAdminRow: Boolean(adminRow),
            adminCheckError: adminCheckError?.message || null,
          },
        }
      : { error: "Forbidden" };
    return {
      response: buildJsonResponse(payload, 403, options.corsHeaders),
    };
  }

  return { requesterId, serviceClient };
}
