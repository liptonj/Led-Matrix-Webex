/**
 * Webex API Utilities
 *
 * Shared utilities for interacting with Webex API, including token refresh
 * and status polling. Used across Edge Functions for consistent Webex integration.
 */

/**
 * Canonical status values supported by the system
 */
export const CANONICAL_STATUSES = [
  "active",
  "away",
  "dnd",
  "busy",
  "meeting",
  "call",
  "presenting",
  "ooo",
  "pending",
  "unknown",
  "offline",
];

/**
 * Mapping of Webex status values to canonical statuses
 */
export const STATUS_ALIASES: Record<string, string> = {
  available: "active",
  inactive: "away",
  brb: "away",
  donotdisturb: "dnd",
  outofoffice: "ooo",
};

/**
 * Normalizes Webex status string to canonical value
 *
 * @param value - Raw status value from Webex API
 * @returns Canonical status string
 */
export function normalizeWebexStatus(value: string | null | undefined): string {
  if (!value) return "unknown";
  const key = value.trim().toLowerCase();
  const normalized = STATUS_ALIASES[key] ?? key;
  return CANONICAL_STATUSES.includes(normalized) ? normalized : "unknown";
}

/**
 * Response type from Webex token refresh endpoint
 */
export interface WebexTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Refreshes a Webex OAuth access token using a refresh token
 *
 * @param args - OAuth client credentials and refresh token
 * @returns New access token and optionally new refresh token
 * @throws Error if refresh fails
 */
export async function refreshWebexToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<WebexTokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", args.refreshToken);
  body.set("client_id", args.clientId);
  body.set("client_secret", args.clientSecret);

  const response = await fetch("https://webexapis.com/v1/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error_description || data?.error || "Failed to refresh token";
    throw new Error(message);
  }

  return data as WebexTokenResponse;
}

/**
 * Fetches current user presence status from Webex API
 *
 * @param accessToken - Valid Webex OAuth access token
 * @returns Normalized status string
 * @throws Error if API call fails
 */
export async function fetchWebexStatus(accessToken: string): Promise<string> {
  const response = await fetch("https://webexapis.com/v1/people/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.message || data?.error || "Webex API error";
    throw new Error(message);
  }

  const status = data?.status || data?.presence || data?.availability || data?.state || data?.activity;
  return normalizeWebexStatus(status);
}
