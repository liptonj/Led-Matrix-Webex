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
  release_channel,
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

// Get releases filtered by channel
export async function getReleasesByChannel(
  channel: 'beta' | 'production' | 'all'
): Promise<Release[]> {
  const supabase = await getSupabase();
  let query = supabase
    .schema("display")
    .from("releases")
    .select(RELEASE_COLUMNS)
    .order("created_at", { ascending: false });
  
  if (channel !== 'all') {
    query = query.eq("release_channel", channel);
  }
  
  const { data, error } = await withTimeout(
    query,
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
  channel?: 'beta' | 'production',
): Promise<void> {
  const supabase = await getSupabase();
  let query = supabase
    .schema("display")
    .from("releases")
    .update({ rollout_percentage: percentage })
    .eq("version", version);
  
  if (channel) {
    query = query.eq("release_channel", channel);
  }
  
  const { error } = await query;
  if (error) throw error;
}

// Helper to set latest release (uses atomic RPC function to avoid race conditions)
export async function setLatestRelease(
  version: string,
  channel: 'beta' | 'production' = 'production',
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("set_latest_release", {
    target_version: version,
    target_channel: channel,
  });

  if (error) throw error;
}

// Delete a release (cannot delete latest release)
export async function deleteRelease(
  version: string, 
  channel: 'beta' | 'production',
): Promise<void> {
  const supabase = await getSupabase();
  
  // Check if this is the latest release for this channel
  const { data: release } = await supabase
    .schema("display")
    .from("releases")
    .select("is_latest")
    .eq("version", version)
    .eq("release_channel", channel)
    .single();
  
  if (release?.is_latest) {
    throw new Error(`Cannot delete the latest ${channel} release. Set another release as latest first.`);
  }
  
  // Check if another channel uses these storage files
  const { data: otherChannel } = await supabase
    .schema("display")
    .from("releases")
    .select("id")
    .eq("version", version)
    .neq("release_channel", channel)
    .maybeSingle();
  
  // Only delete storage files if no other channel uses them
  if (!otherChannel) {
    await supabase.storage
      .from("firmware")
      .remove([`${version}/firmware.bin`, `${version}/firmware-merged.bin`]);
  }
  
  // Delete database record
  const { error } = await supabase
    .schema("display")
    .from("releases")
    .delete()
    .eq("version", version)
    .eq("release_channel", channel);
  
  if (error) throw error;
}
