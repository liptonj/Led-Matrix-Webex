/**
 * Shared Broadcast Utility
 *
 * Provides a reusable function for sending broadcasts via Supabase Realtime API.
 * Used by Edge Functions to send events to device and user channels.
 */

export interface BroadcastMessage {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
}

/**
 * Send a broadcast message to a Supabase Realtime channel
 *
 * @param topic - Channel topic (e.g., "device:{deviceUuid}" or "user:{userUuid}")
 * @param event - Event name (e.g., "user_assigned", "webex_status")
 * @param payload - Event payload data
 * @param isPrivate - Whether the broadcast is private (default: true)
 * @returns Promise that resolves if broadcast succeeds, rejects on error
 */
export async function sendBroadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
  isPrivate: boolean = true,
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const realtimeUrl = `${supabaseUrl.replace(/\/$/, "")}/realtime/v1/api/broadcast`;
  const broadcastBody = {
    messages: [
      {
        topic,
        event,
        payload,
        private: isPrivate,
      },
    ],
  };

  const response = await fetch(realtimeUrl, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(broadcastBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Broadcast failed: HTTP ${response.status} - ${errorText}`,
    );
  }
}
