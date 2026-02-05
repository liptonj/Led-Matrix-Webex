/**
 * Webex API Utilities Tests
 *
 * Tests for the webex.ts shared module that handles Webex API interactions.
 *
 * Run: deno test --allow-net --allow-env _tests/shared-webex.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  normalizeWebexStatus,
  refreshWebexToken,
  fetchWebexStatus,
  CANONICAL_STATUSES,
  STATUS_ALIASES,
} from "../_shared/webex.ts";

// ============================================================================
// normalizeWebexStatus Tests
// ============================================================================

Deno.test("webex: normalizeWebexStatus returns canonical status for valid status", () => {
  assertEquals(normalizeWebexStatus("active"), "active");
  assertEquals(normalizeWebexStatus("away"), "away");
  assertEquals(normalizeWebexStatus("dnd"), "dnd");
  assertEquals(normalizeWebexStatus("busy"), "busy");
  assertEquals(normalizeWebexStatus("meeting"), "meeting");
  assertEquals(normalizeWebexStatus("call"), "call");
  assertEquals(normalizeWebexStatus("presenting"), "presenting");
  assertEquals(normalizeWebexStatus("ooo"), "ooo");
  assertEquals(normalizeWebexStatus("pending"), "pending");
  assertEquals(normalizeWebexStatus("unknown"), "unknown");
  assertEquals(normalizeWebexStatus("offline"), "offline");
});

Deno.test("webex: normalizeWebexStatus normalizes aliases to canonical values", () => {
  assertEquals(normalizeWebexStatus("available"), "active");
  assertEquals(normalizeWebexStatus("inactive"), "away");
  assertEquals(normalizeWebexStatus("brb"), "away");
  assertEquals(normalizeWebexStatus("donotdisturb"), "dnd");
  assertEquals(normalizeWebexStatus("outofoffice"), "ooo");
});

Deno.test("webex: normalizeWebexStatus handles case insensitivity", () => {
  assertEquals(normalizeWebexStatus("ACTIVE"), "active");
  assertEquals(normalizeWebexStatus("Available"), "active");
  assertEquals(normalizeWebexStatus("DND"), "dnd");
  assertEquals(normalizeWebexStatus("BrB"), "away");
});

Deno.test("webex: normalizeWebexStatus trims whitespace", () => {
  assertEquals(normalizeWebexStatus("  active  "), "active");
  assertEquals(normalizeWebexStatus("\taway\n"), "away");
});

Deno.test("webex: normalizeWebexStatus returns 'unknown' for invalid status", () => {
  assertEquals(normalizeWebexStatus("invalid-status"), "unknown");
  assertEquals(normalizeWebexStatus("xyz"), "unknown");
  assertEquals(normalizeWebexStatus(""), "unknown");
});

Deno.test("webex: normalizeWebexStatus returns 'unknown' for null/undefined", () => {
  assertEquals(normalizeWebexStatus(null), "unknown");
  assertEquals(normalizeWebexStatus(undefined), "unknown");
});

// ============================================================================
// refreshWebexToken Tests
// ============================================================================

Deno.test("webex: refreshWebexToken successfully refreshes token", async () => {
  // Mock fetch to return successful token response
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      }),
      { status: 200 },
    );
  };

  try {
    const result = await refreshWebexToken({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      refreshToken: "old-refresh-token",
    });

    assertEquals(result.access_token, "new-access-token");
    assertEquals(result.refresh_token, "new-refresh-token");
    assertEquals(result.expires_in, 3600);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("webex: refreshWebexToken handles response without refresh_token", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        access_token: "new-access-token",
        expires_in: 3600,
      }),
      { status: 200 },
    );
  };

  try {
    const result = await refreshWebexToken({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      refreshToken: "old-refresh-token",
    });

    assertEquals(result.access_token, "new-access-token");
    assertEquals(result.refresh_token, undefined);
    assertEquals(result.expires_in, 3600);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("webex: refreshWebexToken throws error on API failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        error: "invalid_grant",
        error_description: "Refresh token expired",
      }),
      { status: 400 },
    );
  };

  try {
    await assertRejects(
      async () => {
        await refreshWebexToken({
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          refreshToken: "expired-refresh-token",
        });
      },
      Error,
      "Refresh token expired",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("webex: refreshWebexToken uses correct request format", async () => {
  let capturedRequest: Request | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedRequest = input instanceof Request ? input : new Request(input, init);
    return new Response(
      JSON.stringify({
        access_token: "token",
        expires_in: 3600,
      }),
      { status: 200 },
    );
  };

  try {
    await refreshWebexToken({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      refreshToken: "refresh-token",
    });

    assertExists(capturedRequest);
    const request = capturedRequest as Request;
    assertEquals(request.method, "POST");
    assertEquals(request.url, "https://webexapis.com/v1/access_token");
    assertEquals(
      request.headers.get("Content-Type"),
      "application/x-www-form-urlencoded",
    );

    const body = await request.text();
    assertEquals(body.includes("grant_type=refresh_token"), true);
    assertEquals(body.includes("refresh_token=refresh-token"), true);
    assertEquals(body.includes("client_id=test-client-id"), true);
    assertEquals(body.includes("client_secret=test-client-secret"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// fetchWebexStatus Tests
// ============================================================================

Deno.test("webex: fetchWebexStatus successfully fetches status", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        status: "active",
        id: "user-id",
        emails: ["user@example.com"],
      }),
      { status: 200 },
    );
  };

  try {
    const status = await fetchWebexStatus("valid-access-token");
    assertEquals(status, "active");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("webex: fetchWebexStatus handles different status field names", async () => {
  const testCases = [
    { response: { status: "away" }, expected: "away" },
    { response: { presence: "busy" }, expected: "busy" },
    { response: { availability: "dnd" }, expected: "dnd" },
    { response: { state: "meeting" }, expected: "meeting" },
    { response: { activity: "call" }, expected: "call" },
  ];

  const originalFetch = globalThis.fetch;

  for (const testCase of testCases) {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify(testCase.response), { status: 200 });
    };

    try {
      const status = await fetchWebexStatus("token");
      assertEquals(status, testCase.expected);
    } finally {
      // Restore for next iteration
    }
  }

  globalThis.fetch = originalFetch;
});

Deno.test("webex: fetchWebexStatus normalizes status value", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        status: "available", // Should normalize to "active"
      }),
      { status: 200 },
    );
  };

  try {
    const status = await fetchWebexStatus("token");
    assertEquals(status, "active");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("webex: fetchWebexStatus throws error on API failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        message: "Invalid access token",
      }),
      { status: 401 },
    );
  };

  try {
    await assertRejects(
      async () => {
        await fetchWebexStatus("invalid-token");
      },
      Error,
      "Invalid access token",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("webex: fetchWebexStatus uses correct Authorization header", async () => {
  let capturedRequest: Request | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedRequest = input instanceof Request ? input : new Request(input, init);
    return new Response(
      JSON.stringify({
        status: "active",
      }),
      { status: 200 },
    );
  };

  try {
    await fetchWebexStatus("test-access-token");

    assertExists(capturedRequest);
    const request = capturedRequest as Request;
    assertEquals(request.url, "https://webexapis.com/v1/people/me");
    assertEquals(
      request.headers.get("Authorization"),
      "Bearer test-access-token",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// Constants Tests
// ============================================================================

Deno.test("webex: CANONICAL_STATUSES contains all expected values", () => {
  const expected = [
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

  assertEquals(CANONICAL_STATUSES.length, expected.length);
  for (const status of expected) {
    assertEquals(CANONICAL_STATUSES.includes(status), true);
  }
});

Deno.test("webex: STATUS_ALIASES maps correctly", () => {
  assertEquals(STATUS_ALIASES.available, "active");
  assertEquals(STATUS_ALIASES.inactive, "away");
  assertEquals(STATUS_ALIASES.brb, "away");
  assertEquals(STATUS_ALIASES.donotdisturb, "dnd");
  assertEquals(STATUS_ALIASES.outofoffice, "ooo");
});
