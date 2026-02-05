/**
 * Admin Create User Edge Function
 *
 * Allows an authenticated admin to create users (admin or regular) and
 * initialize their profile + admin allowlist entry.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAdminUser } from "../_shared/admin_auth.ts";

interface CreateUserRequest {
  email: string;
  password: string;
  role?: "admin" | "user";
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
    const auth = await requireAdminUser(req, {
      corsHeaders,
      logPrefix: "admin-create-user",
      allowServiceRole: true,
    });
    if (auth.response) return auth.response;

    const requesterId = auth.requesterId ?? null;
    const serviceClient = auth.serviceClient ?? createClient(supabaseUrl, serviceKey);

    const body: CreateUserRequest = await req.json();
    const email = body.email?.trim().toLowerCase();
    const password = body.password?.trim();
    const role = body.role === "admin" ? "admin" : "user";

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email, password" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let userId: string | null = null;
    let existing = false;

    const { data: created, error: createError } =
      await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (createError) {
      const { data: existingUser, error: lookupError } =
        await (serviceClient.auth.admin as any).getUserByEmail(email);

      if (lookupError || !existingUser?.user) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      userId = existingUser.user.id;
      existing = true;
    } else {
      userId = created?.user?.id ?? null;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Failed to create user" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: profileError } = await (serviceClient as any)
      .schema("display")
      .from("user_profiles")
      .upsert(
        {
          user_id: userId,
          email,
          role,
          created_by: requesterId,
        },
        { onConflict: "user_id" },
      );

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (role === "admin") {
      const { error: adminInsertError } = await (serviceClient as any)
        .schema("display")
        .from("admin_users")
        .upsert(
          {
            user_id: userId,
            created_by: requesterId,
          },
          { onConflict: "user_id" },
        );

      if (adminInsertError) {
        return new Response(JSON.stringify({ error: adminInsertError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, user_id: userId, existing }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Admin create user error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
