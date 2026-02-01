/**
 * Firmware Manifest URL Generation
 *
 * Centralized utility for generating firmware manifest URLs.
 * Ensures consistent URL generation across the application.
 */

/**
 * Generate the base firmware manifest URL.
 * Returns null if Supabase is not configured.
 *
 * @returns Manifest URL or null if not configured
 */
export function getManifestUrl(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return null;
  }
  return `${supabaseUrl}/functions/v1/get-manifest`;
}

/**
 * Generate the ESP Web Tools format manifest URL.
 * Returns null if Supabase is not configured.
 *
 * This format is specifically for the ESP Web Tools flashing interface.
 *
 * @returns ESP Web Tools manifest URL or null if not configured
 */
export function getEspWebToolsManifestUrl(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return null;
  }
  return `${supabaseUrl}/functions/v1/get-manifest?format=esp-web-tools`;
}

/**
 * Check if Supabase is configured for manifest access.
 *
 * @returns true if Supabase URL is configured
 */
export function isManifestConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL;
}
