/**
 * Admin Create User Edge Function
 *
 * Allows an authenticated admin to create users (admin or regular) and
 * initialize their profile + admin allowlist entry.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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

    const { data: adminRow, error: adminCheckError } = await serviceClient
      .schema("display")
      .from("admin_users")
      .select("user_id")
      .eq("user_id", requesterId)
      .maybeSingle();

    if (adminCheckError || !adminRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        await serviceClient.auth.admin.getUserByEmail(email);

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

    const { error: profileError } = await serviceClient
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
      const { error: adminInsertError } = await serviceClient
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
