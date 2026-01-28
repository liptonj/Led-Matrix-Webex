/**
 * Admin Delete User Edge Function
 *
 * Allows an authenticated admin to delete users while protecting the last admin.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface DeleteUserRequest {
  user_id: string;
}

async function isRequesterAdmin(
  serviceClient: ReturnType<typeof createClient>,
  requesterId: string,
): Promise<boolean> {
  const { data, error } = await serviceClient
    .schema("display")
    .from("admin_users")
    .select("user_id")
    .eq("user_id", requesterId)
    .maybeSingle();

  return !error && !!data;
}

async function isTargetAdmin(
  serviceClient: ReturnType<typeof createClient>,
  targetId: string,
): Promise<boolean> {
  const { data, error } = await serviceClient
    .schema("display")
    .from("admin_users")
    .select("user_id")
    .eq("user_id", targetId)
    .maybeSingle();

  return !error && !!data;
}

async function adminCount(
  serviceClient: ReturnType<typeof createClient>,
): Promise<number> {
  const { count, error } = await serviceClient
    .schema("display")
    .from("admin_users")
    .select("user_id", { count: "exact", head: true });

  if (error) return 0;
  return count || 0;
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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requesterId = userData.user.id;
    const serviceClient = createClient(supabaseUrl, serviceKey);

    if (!(await isRequesterAdmin(serviceClient, requesterId))) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: DeleteUserRequest = await req.json();

    if (!body.user_id) {
      return new Response(JSON.stringify({ error: "Missing user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetId = body.user_id;
    const targetIsAdmin = await isTargetAdmin(serviceClient, targetId);
    const totalAdmins = await adminCount(serviceClient);

    if (targetIsAdmin && totalAdmins <= 1) {
      return new Response(
        JSON.stringify({ error: "Cannot delete the last admin." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { error: deleteError } =
      await serviceClient.auth.admin.deleteUser(targetId);

    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Admin delete user error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
