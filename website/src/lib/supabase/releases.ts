import {
  SUPABASE_REQUEST_TIMEOUT_MS,
  getSupabase,
  withTimeout,
} from "./core";
import type { Release } from "./types";

// Explicit column list for releases
const RELEASE_COLUMNS = `
  id,
  version,
  tag,
  name,
  notes,
  firmware_url,
  firmware_merged_url,
  firmware_size,
  build_id,
  build_date,
  is_latest,
  is_prerelease,
  rollout_percentage,
  created_at,
  created_by
`;

// Helper to get releases
export async function getReleases(): Promise<Release[]> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("releases")
      .select(RELEASE_COLUMNS)
      .order("created_at", { ascending: false }),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading releases.",
  );

  if (error) throw error;
  return data || [];
}

// Helper to update release rollout percentage
export async function setReleaseRollout(
  version: string,
  percentage: number,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("releases")
    .update({ rollout_percentage: percentage })
    .eq("version", version);

  if (error) throw error;
}

// Helper to set latest release (uses atomic RPC function to avoid race conditions)
export async function setLatestRelease(version: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("set_latest_release", {
    target_version: version,
  });

  if (error) throw error;
}
