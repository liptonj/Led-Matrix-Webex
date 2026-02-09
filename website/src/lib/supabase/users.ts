import {
  SUPABASE_REQUEST_TIMEOUT_MS,
  getSupabase,
  getCachedSessionFromStorage,
  isAbortError,
  supabaseUrl,
  withTimeout,
} from "./core";
import { getSession, getUser } from "./auth";
import type { UserDeviceAssignment, UserProfile } from "./types";

export async function getUserProfiles(): Promise<UserProfile[]> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("user_profiles")
      .select(
        "user_id, email, role, first_name, last_name, disabled, created_at, created_by",
      )
      .order("email", { ascending: true }),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading user profiles.",
  );

  if (error) throw error;
  return data || [];
}

export async function getUserDeviceAssignments(): Promise<UserDeviceAssignment[]> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase
      .schema("display")
      .from("user_devices")
      .select("id, user_id, device_uuid, serial_number, created_at, created_by")
      .order("created_at", { ascending: false }),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading device assignments.",
  );

  if (error) throw error;
  return data || [];
}

export async function assignDeviceToUser(
  userId: string,
  serialNumber: string,
): Promise<void> {
  const supabase = await getSupabase();
  const user = await getUser();
  
  // Look up device UUID from serial_number
  const { data: device, error: deviceError } = await supabase
    .schema("display")
    .from("devices")
    .select("id")
    .eq("serial_number", serialNumber)
    .maybeSingle();
  
  if (deviceError) throw deviceError;
  if (!device) throw new Error(`Device not found: ${serialNumber}`);
  
  const { error } = await supabase
    .schema("display")
    .from("user_devices")
    .insert({
      user_id: userId,
      device_uuid: device.id,
      serial_number: serialNumber,
      created_by: user?.id ?? null,
    });

  if (error) throw error;
}

export async function removeUserDeviceAssignment(assignmentId: string) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .schema("display")
    .from("user_devices")
    .delete()
    .eq("id", assignmentId);

  if (error) throw error;
}

// Remove current user's device assignment by serial number
// This is for users removing their own devices (not admins)
export async function removeMyDeviceAssignment(serialNumber: string): Promise<void> {
  const supabase = await getSupabase();
  const user = await getUser();
  
  if (!user) {
    throw new Error("Not authenticated");
  }
  
  const { error } = await supabase
    .schema("display")
    .from("user_devices")
    .delete()
    .eq("serial_number", serialNumber)
    .eq("user_id", user.id);
  
  if (error) throw error;
}

export async function createUserWithRole(
  email: string,
  password: string,
  role: "admin" | "user",
): Promise<{ userId: string; existing: boolean }> {
  if (!supabaseUrl) {
    throw new Error("Supabase URL is not configured.");
  }

  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-create-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email,
      password,
      role,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Failed to create user.");
  }

  return { userId: body.user_id, existing: Boolean(body.existing) };
}

export async function getCurrentUserProfile(
  signal?: AbortSignal,
  options?: { skipRemote?: boolean },
): Promise<UserProfile | null> {
  // Check if signal is already aborted
  if (signal?.aborted) {
    return null;
  }

  try {
    // Get user from session instead of making a network request
    const cachedSession = getCachedSessionFromStorage();
    const cachedUser = cachedSession?.user;
    const sessionResult = cachedUser ? null : await getSession(signal);
    const user = cachedUser ?? sessionResult?.data?.session?.user;

    if (!user) {
      return null;
    }

    // Quick check for disabled status from JWT claims (instant)
    if (user.app_metadata?.disabled === true) {
      return null;
    }

    if (options?.skipRemote) {
      return null;
    }
    const supabase = await getSupabase();
    const { data, error } = await withTimeout(
      supabase
        .schema("display")
        .from("user_profiles")
        .select(
          "user_id, email, role, first_name, last_name, disabled, created_at, created_by",
        )
        .eq("user_id", user.id)
        .single(),
      SUPABASE_REQUEST_TIMEOUT_MS,
      "Timed out while loading your profile.",
      signal,
    );

    if (error && error.code !== "PGRST116") {
      throw error;
    }
    return data || null;
  } catch (err) {
    // Handle AbortError gracefully (can happen in React Strict Mode or component unmount)
    if (isAbortError(err)) {
      return null;
    }
    if (err instanceof Error && err.message.includes("Timed out")) {
      return null;
    }
    throw err;
  }
}

export async function updateAdminUser(params: {
  userId: string;
  email?: string;
  password?: string;
  role?: "admin" | "user";
  firstName?: string | null;
  lastName?: string | null;
  disabled?: boolean;
}): Promise<void> {
  if (!supabaseUrl) {
    throw new Error("Supabase URL is not configured.");
  }

  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-update-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      user_id: params.userId,
      email: params.email,
      password: params.password,
      role: params.role,
      first_name: params.firstName,
      last_name: params.lastName,
      disabled: params.disabled,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Failed to update user.");
  }
}

export async function deleteAdminUser(userId: string): Promise<void> {
  if (!supabaseUrl) {
    throw new Error("Supabase URL is not configured.");
  }

  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-delete-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ user_id: userId }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Failed to delete user.");
  }
}
