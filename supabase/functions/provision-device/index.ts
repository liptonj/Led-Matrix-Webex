/**
 * Provision Device Edge Function
 *
 * Called by ESP32 on first boot to register the device with Supabase.
 * The device sends its serial number and a hash of its secret (key_hash).
 * Returns a persistent pairing code that never changes.
 *
 * For migration from pre-HMAC firmware: the device can send its existing
 * pairing code, which will be preserved if valid. This ensures users don't
 * need to re-pair their embedded app after firmware updates.
 *
 * Request body:
 * {
 *   "serial_number": "A1B2C3D4",       // CRC32 of eFuse MAC (8 hex chars)
 *   "key_hash": "sha256-hex-string",   // SHA256 hash of device secret
 *   "firmware_version": "1.4.4",       // Current firmware version
 *   "existing_pairing_code": "ABC123", // Optional: preserve existing code
 *   "provision_token": "token-string" // Optional: token for auto-approval
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "device_id": "webex-display-1234",
 *   "pairing_code": "ABC123"
 * }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isCodeExpired } from "../_shared/pairing_code.ts";

interface ProvisionRequest {
  serial_number: string;
  key_hash: string;
  firmware_version?: string;
  ip_address?: string;
  existing_pairing_code?: string; // For migration: preserve pairing code from old firmware
  provision_token?: string; // Optional: token for auto-approval
}

function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude confusing characters (I, O, 0, 1)
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function isValidPairingCode(code: string): boolean {
  // Pairing codes must be exactly 6 characters from the valid charset
  const validChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  if (!code || code.length !== 6) {
    return false;
  }
  const upperCode = code.toUpperCase();
  for (const char of upperCode) {
    if (!validChars.includes(char)) {
      return false;
    }
  }
  return true;
}

function generateDeviceId(serial: string): string {
  // Take last 4 chars of serial for device ID suffix
  const suffix = serial.slice(-4).toUpperCase();
  return `webex-display-${suffix}`;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    const body: ProvisionRequest = await req.json();
    const {
      serial_number,
      key_hash,
      firmware_version,
      ip_address,
      existing_pairing_code,
      provision_token,
    } = body;

    if (!serial_number || !key_hash) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: serial_number, key_hash",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate serial number format (8 hex characters)
    if (!/^[A-Fa-f0-9]{8}$/.test(serial_number)) {
      return new Response(
        JSON.stringify({
          error: "Invalid serial_number format. Expected 8 hex characters.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate provision token if provided
    let autoApproveUserId: string | null = null;
    if (provision_token) {
      const tokenResult = await supabase
        .schema("display")
        .from("provision_tokens")
        .select("id, user_id, expires_at")
        .eq("token", provision_token)
        .single();

      if (tokenResult.data && new Date(tokenResult.data.expires_at) > new Date()) {
        autoApproveUserId = tokenResult.data.user_id;

        // Delete token immediately (single-use)
        await supabase
          .schema("display")
          .from("provision_tokens")
          .delete()
          .eq("id", tokenResult.data.id);

        console.log(
          `[PROVISION] Token validated, auto-approving for user ${autoApproveUserId}`,
        );
      } else {
        console.log(
          "[PROVISION] Invalid or expired token, continuing with pairing code flow",
        );
      }
    }

    // Check if device already exists
    const { data: existingDevice, error: _lookupError } = await supabase
      .schema("display")
      .from("devices")
      .select("id, device_id, pairing_code, is_provisioned, user_approved_by, created_at")
      .eq("serial_number", serial_number.toUpperCase())
      .single();

    if (existingDevice) {
      // CHECK: Device must be approved (unless auto-approved via token)
      if (!existingDevice.user_approved_by) {
        // If we have a valid provision token, auto-approve the device
        if (autoApproveUserId) {
          const now = new Date().toISOString();
          await supabase
            .schema("display")
            .from("devices")
            .update({
              user_approved_by: autoApproveUserId,
              approved_at: now,
              key_hash, // Update key_hash for re-provisioning support
              last_seen: now,
              ...(firmware_version && { firmware_version }),
              ...(ip_address && { ip_address }),
            })
            .eq("serial_number", serial_number.toUpperCase());

          // Create user_devices entry
          const { error: upsertError } = await (supabase as any)
            .schema("display")
            .from("user_devices")
            .upsert(
              {
                user_id: autoApproveUserId,
                serial_number: serial_number.toUpperCase(),
                device_uuid: existingDevice.id,
                created_by: autoApproveUserId,
                provisioning_method: "provision_token",
                provisioned_at: now,
              },
              {
                onConflict: "user_id,serial_number",
                ignoreDuplicates: false,
              },
            );

          if (upsertError) {
            console.error("Failed to create user_devices entry:", upsertError);
            // Don't fail the request - device is already approved
          }

          // Update pairings.user_uuid to keep tables in sync
          await supabase
            .schema("display")
            .from("pairings")
            .upsert({
              pairing_code: existingDevice.pairing_code,
              serial_number: serial_number.toUpperCase(),
              device_uuid: existingDevice.id,
              user_uuid: autoApproveUserId
            }, { onConflict: "pairing_code" });

          return new Response(
            JSON.stringify({
              success: true,
              device_id: existingDevice.device_id,
              pairing_code: existingDevice.pairing_code,
              device_uuid: existingDevice.id,
              user_uuid: autoApproveUserId,
              already_provisioned: existingDevice.is_provisioned,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // Check if pairing code has expired (more than 4 minutes old)
        if (existingDevice.created_at && isCodeExpired(existingDevice.created_at)) {
          // Generate a new pairing code and update the device
          const newPairingCode = generatePairingCode();
          await supabase
            .schema("display")
            .from("devices")
            .update({
              pairing_code: newPairingCode,
              created_at: new Date().toISOString(),
            })
            .eq("serial_number", serial_number.toUpperCase());

          return new Response(
            JSON.stringify({
              error: "Device not approved yet. Ask device owner to approve it on the website.",
              serial_number: serial_number.toUpperCase(),
              pairing_code: newPairingCode,
              awaiting_approval: true,
            }),
            {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // Device exists but not approved, and code hasn't expired yet
        return new Response(
          JSON.stringify({
            error: "Device not approved yet. Ask device owner to approve it on the website.",
            serial_number: serial_number.toUpperCase(),
            pairing_code: existingDevice.pairing_code,
            awaiting_approval: true,
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Device already registered - return existing pairing code
      // CRITICAL: Always update key_hash to support re-provisioning after factory reset
      console.log(`Updating key_hash for existing device ${serial_number.toUpperCase()}`);
      await supabase
        .schema("display")
        .from("devices")
        .update({
          key_hash,  // Always update - fixes auth after NVS wipe/factory reset
          last_seen: new Date().toISOString(),
          ...(firmware_version && { firmware_version }),
          ...(ip_address && { ip_address }),
        })
        .eq("serial_number", serial_number.toUpperCase());

      return new Response(
        JSON.stringify({
          success: true,
          device_id: existingDevice.device_id,
          pairing_code: existingDevice.pairing_code,
          device_uuid: existingDevice.id,
          user_uuid: existingDevice.user_approved_by || null,
          already_provisioned: existingDevice.is_provisioned,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // New device - create registration
    const deviceId = generateDeviceId(serial_number);
    // Use existing pairing code from device if valid (preserves user's pairing during migration)
    // Otherwise generate a new one
    const pairingCode =
      existing_pairing_code && isValidPairingCode(existing_pairing_code)
        ? existing_pairing_code.toUpperCase()
        : generatePairingCode();

    const now = new Date().toISOString();
    const { data: newDevice, error: insertError } = await supabase
      .schema("display")
      .from("devices")
      .insert({
        serial_number: serial_number.toUpperCase(),
        device_id: deviceId,
        pairing_code: pairingCode,
        key_hash: key_hash,
        firmware_version: firmware_version || null,
        ip_address: ip_address || null,
        is_provisioned: false,
        user_approved_by: autoApproveUserId || null,
        approved_at: autoApproveUserId ? now : null,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Failed to insert device:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to register device" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // If auto-approved via token, create user_devices entry
    if (autoApproveUserId && newDevice) {
      const { error: upsertError } = await (supabase as any)
        .schema("display")
        .from("user_devices")
        .upsert(
          {
            user_id: autoApproveUserId,
            serial_number: serial_number.toUpperCase(),
            device_uuid: newDevice.id,
            created_by: autoApproveUserId,
            provisioning_method: "provision_token",
            provisioned_at: now,
          },
          {
            onConflict: "user_id,serial_number",
            ignoreDuplicates: false,
          },
        );

      if (upsertError) {
        console.error("Failed to create user_devices entry:", upsertError);
        // Don't fail the request - device is already created
      }

      // Update pairings.user_uuid to keep tables in sync
      await supabase
        .schema("display")
        .from("pairings")
        .upsert({
          pairing_code: pairingCode,
          serial_number: serial_number.toUpperCase(),
          device_uuid: newDevice.id,
          user_uuid: autoApproveUserId
        }, { onConflict: "pairing_code" });

      return new Response(
        JSON.stringify({
          success: true,
          device_id: deviceId,
          pairing_code: pairingCode,
          device_uuid: newDevice.id,
          user_uuid: autoApproveUserId,
          already_provisioned: false,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // New device created but not approved - return 403
    return new Response(
      JSON.stringify({
        error: "Device registered but not approved yet. Ask device owner to approve it on the website.",
        serial_number: serial_number.toUpperCase(),
        device_id: deviceId,
        pairing_code: pairingCode,
        awaiting_approval: true,
      }),
      {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Provision device error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
