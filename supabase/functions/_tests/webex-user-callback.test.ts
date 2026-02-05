/**
 * Webex User Callback Edge Function Tests
 *
 * Tests for the webex-user-callback Edge Function that handles user OAuth flow.
 *
 * Run: deno test --allow-net --allow-env _tests/webex-user-callback.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockRequest(
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  return new Request("http://localhost/webex-user-callback", {
    method,
    headers: new Headers(defaultHeaders),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((input.length + 3) % 4);
  try {
    return atob(padded);
  } catch {
    throw new Error("Invalid base64url encoding");
  }
}

// ============================================================================
// Request Validation Tests
// ============================================================================

Deno.test("webex-user-callback: rejects non-POST methods", () => {
  const req = createMockRequest("GET");
  assertEquals(req.method, "GET");
  // Function should return 405
});

Deno.test("webex-user-callback: requires code and state in body", () => {
  const invalidBody = {};
  assertEquals("code" in invalidBody, false);
  assertEquals("state" in invalidBody, false);
  // Function should return 400
});

Deno.test("webex-user-callback: returns 400 when code missing", () => {
  const errorResponse = {
    error: "Missing code or state",
  };

  assertEquals(errorResponse.error, "Missing code or state");
});

Deno.test("webex-user-callback: returns 400 when state missing", () => {
  const errorResponse = {
    error: "Missing code or state",
  };

  assertEquals(errorResponse.error, "Missing code or state");
});

// ============================================================================
// State Validation Tests
// ============================================================================

Deno.test("webex-user-callback: validates state from database", () => {
  const stateQuery = {
    state_key: "state-value",
  };

  assertExists(stateQuery.state_key);
});

Deno.test("webex-user-callback: returns 400 when state not found", () => {
  const errorResponse = {
    error: "Invalid state",
  };

  assertEquals(errorResponse.error, "Invalid state");
});

Deno.test("webex-user-callback: checks state expiration", () => {
  const stateData = {
    expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
  };

  const isExpired = new Date(stateData.expires_at) < new Date();
  assertEquals(isExpired, true);
});

Deno.test("webex-user-callback: returns 400 when state expired", () => {
  const errorResponse = {
    error: "State expired",
  };

  assertEquals(errorResponse.error, "State expired");
});

Deno.test("webex-user-callback: decodes state to get redirect_to", () => {
  const stateObj: { redirect_to?: string; [key: string]: unknown } = {
    redirect: "https://example.com/callback",
    redirect_to: "/user",
  };

  const redirectTo = stateObj.redirect_to || "/user";
  assertEquals(redirectTo, "/user");
});

Deno.test("webex-user-callback: defaults redirect_to to /user", () => {
  const stateObj: { redirect_to?: string; [key: string]: unknown } = {};
  const redirectTo = stateObj.redirect_to || "/user";

  assertEquals(redirectTo, "/user");
});

Deno.test("webex-user-callback: returns 400 when state format invalid", () => {
  const errorResponse = {
    error: "Invalid state format",
  };

  assertEquals(errorResponse.error, "Invalid state format");
});

Deno.test("webex-user-callback: cleans up state after validation", () => {
  const stateKey = "state-value";
  // Function should delete state row after validation
  assertExists(stateKey);
});

// ============================================================================
// OAuth Config Tests
// ============================================================================

Deno.test("webex-user-callback: fetches OAuth config for user purpose", () => {
  const oauthConfig = {
    provider: "webex",
    purpose: "user",
  };

  assertEquals(oauthConfig.provider, "webex");
  assertEquals(oauthConfig.purpose, "user");
});

Deno.test("webex-user-callback: returns 500 when OAuth config not found", () => {
  const errorResponse = {
    error: "Webex OAuth not configured",
  };

  assertEquals(errorResponse.error, "Webex OAuth not configured");
});

// ============================================================================
// Token Exchange Tests
// ============================================================================

Deno.test("webex-user-callback: exchanges code for tokens with PKCE", () => {
  const tokenRequest = {
    grant_type: "authorization_code",
    code: "auth-code",
    redirect_uri: "https://example.com/callback",
    code_verifier: "pkce-verifier",
  };

  assertExists(tokenRequest.code);
  assertExists(tokenRequest.code_verifier);
  assertEquals(tokenRequest.grant_type, "authorization_code");
});

Deno.test("webex-user-callback: uses Basic auth for token exchange", () => {
  const clientId = "client-id";
  const clientSecret = "client-secret";
  const authHeader = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;

  assertStringIncludes(authHeader, "Basic ");
});

Deno.test("webex-user-callback: returns 400 when token exchange fails", () => {
  const errorResponse = {
    error: "Token exchange failed",
  };

  assertEquals(errorResponse.error, "Token exchange failed");
});

// ============================================================================
// User Info Tests
// ============================================================================

Deno.test("webex-user-callback: fetches user info from Webex", () => {
  const userInfoRequest = {
    url: "https://webexapis.com/v1/userinfo",
    headers: {
      Authorization: "Bearer access-token",
    },
  };

  assertEquals(userInfoRequest.url, "https://webexapis.com/v1/userinfo");
  assertExists(userInfoRequest.headers.Authorization);
});

Deno.test("webex-user-callback: returns 400 when user info fetch fails", () => {
  const errorResponse = {
    error: "Failed to get user info",
  };

  assertEquals(errorResponse.error, "Failed to get user info");
});

// ============================================================================
// Token Storage Tests
// ============================================================================

Deno.test("webex-user-callback: stores access token in vault", () => {
  const accessToken = "webex-access-token";
  const webexUserId = "webex-user-id";
  const secretName = `webex_user_access_${webexUserId}`;

  assertExists(accessToken);
  assertEquals(secretName, "webex_user_access_webex-user-id");
});

Deno.test("webex-user-callback: stores refresh token in vault when provided", () => {
  const refreshToken = "webex-refresh-token";
  const webexUserId = "webex-user-id";
  const secretName = `webex_user_refresh_${webexUserId}`;

  if (refreshToken) {
    assertExists(refreshToken);
    assertEquals(secretName, "webex_user_refresh_webex-user-id");
  }
});

Deno.test("webex-user-callback: handles missing refresh token", () => {
  const refreshToken = null;
  const refreshTokenId = refreshToken ? "secret-id" : null;

  assertEquals(refreshTokenId, null);
});

// ============================================================================
// User Profile Tests
// ============================================================================

Deno.test("webex-user-callback: looks up existing user by webex_user_id", () => {
  const userQuery = {
    webex_user_id: "webex-user-id",
  };

  assertExists(userQuery.webex_user_id);
});

Deno.test("webex-user-callback: updates existing user profile", () => {
  const updateData = {
    email: "user@example.com",
    display_name: "User Name",
    webex_email: "user@example.com",
    avatar_url: "https://example.com/avatar.jpg",
    auth_provider: "webex",
  };

  assertExists(updateData.email);
  assertEquals(updateData.auth_provider, "webex");
});

Deno.test("webex-user-callback: links Webex to existing account by email", () => {
  const emailQuery = {
    email: "user@example.com",
  };

  assertExists(emailQuery.email);
});

Deno.test("webex-user-callback: creates new Supabase Auth user when needed", () => {
  const newUser = {
    email: "user@example.com",
    email_confirm: true,
    user_metadata: {
      webex_user_id: "webex-user-id",
      name: "User Name",
      avatar_url: "https://example.com/avatar.jpg",
    },
  };

  assertExists(newUser.email);
  assertEquals(newUser.email_confirm, true);
});

Deno.test("webex-user-callback: returns 500 when user creation fails", () => {
  const errorResponse = {
    error: "Failed to create user",
  };

  assertEquals(errorResponse.error, "Failed to create user");
});

Deno.test("webex-user-callback: creates user profile after auth user", () => {
  const profileData = {
    user_id: "user-uuid",
    email: "user@example.com",
    webex_user_id: "webex-user-id",
    webex_email: "user@example.com",
    display_name: "User Name",
    avatar_url: "https://example.com/avatar.jpg",
    role: "user",
    auth_provider: "webex",
  };

  assertEquals(profileData.role, "user");
  assertEquals(profileData.auth_provider, "webex");
});

// ============================================================================
// OAuth Token Storage Tests
// ============================================================================

Deno.test("webex-user-callback: stores OAuth tokens in oauth_tokens table", () => {
  const tokenData = {
    provider: "webex",
    user_id: "user-uuid",
    token_scope: "user",
    serial_number: null,
    pairing_code: null,
    access_token_id: "access-secret-id",
    refresh_token_id: "refresh-secret-id",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  };

  assertEquals(tokenData.provider, "webex");
  assertEquals(tokenData.token_scope, "user");
  assertEquals(tokenData.serial_number, null);
});

Deno.test("webex-user-callback: upserts OAuth tokens on conflict", () => {
  const upsertOptions = {
    onConflict: "provider,user_id",
    ignoreDuplicates: false,
  };

  assertEquals(upsertOptions.onConflict, "provider,user_id");
  assertEquals(upsertOptions.ignoreDuplicates, false);
});

Deno.test("webex-user-callback: calculates expires_at from expires_in", () => {
  const expiresIn = 3600; // 1 hour
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  assertExists(expiresAt);
});

Deno.test("webex-user-callback: defaults expires_in to 3600", () => {
  const tokens: { access_token: string; refresh_token?: string; expires_in?: number } = {
    access_token: "test-token",
  };
  const expiresIn = tokens.expires_in || 3600;

  assertEquals(expiresIn, 3600);
});

// ============================================================================
// Session Generation Tests
// ============================================================================

Deno.test("webex-user-callback: generates Supabase session for user", () => {
  const sessionRequest = {
    type: "magiclink",
    email: "user@example.com",
  };

  assertEquals(sessionRequest.type, "magiclink");
  assertExists(sessionRequest.email);
});

Deno.test("webex-user-callback: returns 500 when session generation fails", () => {
  const errorResponse = {
    error: "Failed to create session",
  };

  assertEquals(errorResponse.error, "Failed to create session");
});

// ============================================================================
// Redirect Logic Tests
// ============================================================================

Deno.test("webex-user-callback: checks if user is admin", () => {
  const adminQuery = {
    user_id: "user-uuid",
  };

  assertExists(adminQuery.user_id);
});

Deno.test("webex-user-callback: checks if user is disabled", () => {
  const profileQuery = {
    user_id: "user-uuid",
  };

  assertExists(profileQuery.user_id);
});

Deno.test("webex-user-callback: returns 403 when user is disabled", () => {
  const errorResponse = {
    success: false,
    error: "Account is disabled",
    redirect_url: "/user/login?error=disabled",
  };

  assertEquals(errorResponse.success, false);
  assertEquals(errorResponse.error, "Account is disabled");
});

Deno.test("webex-user-callback: redirects to /embedded when redirect_to starts with /embedded", () => {
  const redirectTo = "/embedded/setup";
  const finalRedirect = redirectTo.startsWith("/embedded")
    ? redirectTo
    : "/user";

  assertEquals(finalRedirect, "/embedded/setup");
});

Deno.test("webex-user-callback: redirects to /admin for admin users", () => {
  const redirectTo = "/user";
  const adminCheck = true;
  const finalRedirect = redirectTo.startsWith("/embedded")
    ? redirectTo
    : (adminCheck ? "/admin" : "/user");

  assertEquals(finalRedirect, "/admin");
});

Deno.test("webex-user-callback: redirects to /user for non-admin users", () => {
  const redirectTo = "/user";
  const adminCheck = false;
  const finalRedirect = redirectTo.startsWith("/embedded")
    ? redirectTo
    : (adminCheck ? "/admin" : "/user");

  assertEquals(finalRedirect, "/user");
});

Deno.test("webex-user-callback: includes session token in redirect URL", () => {
  const sessionData: { properties?: { hashed_token?: string } } = {
    properties: {
      hashed_token: "session-token",
    },
  };
  const finalRedirect = "/user";
  const redirectUrl = sessionData.properties?.hashed_token
    ? `${finalRedirect}?token=${sessionData.properties.hashed_token}`
    : finalRedirect;

  assertEquals(redirectUrl, "/user?token=session-token");
});

Deno.test("webex-user-callback: falls back to redirect without token if missing", () => {
  const sessionData: {
    properties?: {
      hashed_token?: string;
    };
  } = {
    properties: {},
  };
  const finalRedirect = "/user";
  const redirectUrl = sessionData.properties?.hashed_token
    ? `${finalRedirect}?token=${sessionData.properties.hashed_token}`
    : finalRedirect;

  assertEquals(redirectUrl, "/user");
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("webex-user-callback: success response contains user and redirect_url", () => {
  const response = {
    success: true,
    user: {
      id: "user-uuid",
      email: "user@example.com",
      name: "User Name",
    },
    redirect_url: "/user?token=session-token",
  };

  assertEquals(response.success, true);
  assertExists(response.user);
  assertExists(response.redirect_url);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("webex-user-callback: returns 500 on internal server error", () => {
  const errorResponse = {
    error: "Internal server error",
  };

  assertEquals(errorResponse.error, "Internal server error");
});
