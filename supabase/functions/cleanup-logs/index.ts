/**
 * Log Cleanup Edge Function
 *
 * Deletes device logs older than 7 days.
 * Can be invoked by:
 *   - GitHub Actions scheduled workflow (cron)
 *   - Manual admin invocation
 *   - External scheduler
 *
 * Authentication: Requires service role key or admin JWT
 */

import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

const RETENTION_DAYS = 7;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only allow POST requests
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Create Supabase client with the provided token
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use service role for elevated permissions
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify the caller has admin/service role access
    // For scheduled jobs, we use the service role key directly
    const token = authHeader.replace("Bearer ", "");
    if (token !== supabaseKey) {
      // If not service role, verify it's an admin user
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid authorization" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Check if user is in admin_users table
      const { data: adminUser, error: adminError } = await supabase
        .schema("display")
        .from("admin_users")
        .select("user_id")
        .eq("user_id", user.id)
        .single();

      if (adminError || !adminUser) {
        return new Response(
          JSON.stringify({ error: "Unauthorized - admin access required" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // Call the cleanup function via RPC
    const { data, error } = await supabase.rpc("cleanup_old_logs");

    if (error) {
      console.error("Cleanup error:", error);
      return new Response(
        JSON.stringify({ error: "Cleanup failed", details: error.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const deletedCount = data || 0;
    console.log(`Log cleanup completed: ${deletedCount} logs deleted`);

    return new Response(
      JSON.stringify({
        success: true,
        deleted_count: deletedCount,
        retention_days: RETENTION_DAYS,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
