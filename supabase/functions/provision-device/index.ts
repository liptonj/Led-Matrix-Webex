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
 *   "existing_pairing_code": "ABC123"  // Optional: preserve existing code
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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isCodeExpired } from "../_shared/pairing_code.ts";

interface ProvisionRequest {
  serial_number: string;
  key_hash: string;
  firmware_version?: string;
  ip_address?: string;
  existing_pairing_code?: string; // For migration: preserve pairing code from old firmware
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

    // Check if device already exists
    const { data: existingDevice, error: _lookupError } = await supabase
      .schema("display")
      .from("devices")
      .select("device_id, pairing_code, is_provisioned, user_approved_by, created_at")
      .eq("serial_number", serial_number.toUpperCase())
      .single();

    if (existingDevice) {
      // CHECK: Device must be approved
      if (!existingDevice.user_approved_by) {
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
      // Update firmware version if provided
      if (firmware_version) {
        await supabase
          .schema("display")
          .from("devices")
          .update({
            firmware_version,
            last_seen: new Date().toISOString(),
            ip_address: ip_address || null,
          })
          .eq("serial_number", serial_number.toUpperCase());
      }

      return new Response(
        JSON.stringify({
          success: true,
          device_id: existingDevice.device_id,
          pairing_code: existingDevice.pairing_code,
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

    // Check if device is pre-approved (shouldn't happen for new devices, but check anyway)
    // For new devices, create with user_approved_by: null
    const { error: insertError } = await supabase
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
        user_approved_by: null, // Not approved yet
      });

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
