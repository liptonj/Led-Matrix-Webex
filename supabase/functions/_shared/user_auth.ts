/**
 * Shared user authentication helper for Edge Functions.
 * Extracts Bearer token from Authorization header, validates it,
 * and returns the authenticated user and Supabase client.
 */

import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

interface AuthResult {
  user?: User;
  error?: Response;
  userClient?: ReturnType<typeof createClient>;
}

export async function getUserFromRequest(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      error: new Response(JSON.stringify({ error: "Missing Bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  const token = authHeader.slice(7);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return {
      error: new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  return { user, userClient };
}
