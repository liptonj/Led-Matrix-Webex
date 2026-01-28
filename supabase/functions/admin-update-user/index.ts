/**
 * Admin Update User Edge Function
 *
 * Allows an authenticated admin to update user profile fields,
 * role, email, password, and disabled status.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface UpdateUserRequest {
  user_id: string;
  email?: string;
  password?: string;
  role?: "admin" | "user";
  first_name?: string | null;
  last_name?: string | null;
  disabled?: boolean;
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

    const body: UpdateUserRequest = await req.json();

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
      if (body.role === "user") {
        return new Response(
          JSON.stringify({ error: "Cannot remove the last admin." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (body.disabled === true) {
        return new Response(
          JSON.stringify({ error: "Cannot disable the last admin." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const authUpdates: Record<string, unknown> = {};
    if (body.email) {
      authUpdates.email = body.email;
    }
    if (body.password) {
      authUpdates.password = body.password;
    }

    if (Object.keys(authUpdates).length > 0) {
      const { error: authUpdateError } =
        await serviceClient.auth.admin.updateUserById(targetId, authUpdates);
      if (authUpdateError) {
        return new Response(JSON.stringify({ error: authUpdateError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: existingProfile } = await serviceClient
      .schema("display")
      .from("user_profiles")
      .select("email, role, first_name, last_name, disabled")
      .eq("user_id", targetId)
      .maybeSingle();

    let fallbackEmail = existingProfile?.email ?? "";
    if (!fallbackEmail) {
      const { data: targetUser } =
        await serviceClient.auth.admin.getUserById(targetId);
      fallbackEmail = targetUser?.user?.email ?? "";
    }
    if (!body.email && !fallbackEmail) {
      return new Response(JSON.stringify({ error: "Email is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profileUpdate = {
      user_id: targetId,
      email: body.email ?? fallbackEmail,
      role: body.role ?? existingProfile?.role ?? "user",
      first_name:
        body.first_name !== undefined
          ? body.first_name
          : existingProfile?.first_name ?? null,
      last_name:
        body.last_name !== undefined
          ? body.last_name
          : existingProfile?.last_name ?? null,
      disabled:
        body.disabled !== undefined
          ? body.disabled
          : existingProfile?.disabled ?? false,
    };

    const { error: profileError } = await serviceClient
      .schema("display")
      .from("user_profiles")
      .upsert(profileUpdate, { onConflict: "user_id" });

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.role === "admin") {
      const { error: adminInsertError } = await serviceClient
        .schema("display")
        .from("admin_users")
        .upsert({
          user_id: targetId,
          created_by: requesterId,
        });

      if (adminInsertError) {
        return new Response(JSON.stringify({ error: adminInsertError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (body.role === "user") {
      const { error: adminDeleteError } = await serviceClient
        .schema("display")
        .from("admin_users")
        .delete()
        .eq("user_id", targetId);

      if (adminDeleteError) {
        return new Response(JSON.stringify({ error: adminDeleteError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Admin update user error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
