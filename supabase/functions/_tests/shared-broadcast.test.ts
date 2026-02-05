/**
 * Broadcast Utility Tests
 *
 * Tests for the broadcast.ts shared module that handles Supabase Realtime broadcasts.
 *
 * Run: deno test --allow-net --allow-env _tests/shared-broadcast.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
} from "jsr:@std/assert";
import { sendBroadcast } from "../_shared/broadcast.ts";

// ============================================================================
// sendBroadcast Tests
// ============================================================================

Deno.test("sendBroadcast: calls realtime API with correct payload", async () => {
  let capturedRequest: Request | null = null;
  const originalFetch = globalThis.fetch;

  // Set environment variables
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

  // Mock fetch to capture request
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedRequest = input instanceof Request
      ? input
      : new Request(input, init);
    return new Response(null, { status: 200 });
  };

  try {
    await sendBroadcast("device:test-uuid", "user_assigned", {
      userId: "user-123",
      deviceId: "device-456",
    });

    assertExists(capturedRequest);
    const request = capturedRequest as Request;

    // Verify URL
    assertEquals(
      request.url,
      "https://test.supabase.co/realtime/v1/api/broadcast",
    );

    // Verify method
    assertEquals(request.method, "POST");

    // Verify headers
    assertEquals(request.headers.get("apikey"), "test-service-role-key");
    assertEquals(
      request.headers.get("Authorization"),
      "Bearer test-service-role-key",
    );
    assertEquals(
      request.headers.get("Content-Type"),
      "application/json",
    );

    // Verify body format
    const body = await request.json();
    assertEquals(body.messages.length, 1);
    assertEquals(body.messages[0].topic, "device:test-uuid");
    assertEquals(body.messages[0].event, "user_assigned");
    assertEquals(body.messages[0].payload.userId, "user-123");
    assertEquals(body.messages[0].payload.deviceId, "device-456");
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("sendBroadcast: throws on non-200 response", async () => {
  const originalFetch = globalThis.fetch;

  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

  globalThis.fetch = async () => {
    return new Response("Unauthorized", { status: 401 });
  };

  try {
    await assertRejects(
      async () => {
        await sendBroadcast("device:test-uuid", "user_assigned", {});
      },
      Error,
      "Broadcast failed: HTTP 401 - Unauthorized",
    );
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("sendBroadcast: uses service role key in Authorization header", async () => {
  let capturedRequest: Request | null = null;
  const originalFetch = globalThis.fetch;

  const testKey = "my-special-service-role-key-12345";

  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", testKey);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedRequest = input instanceof Request
      ? input
      : new Request(input, init);
    return new Response(null, { status: 200 });
  };

  try {
    await sendBroadcast("user:test-uuid", "webex_status", {
      status: "active",
    });

    assertExists(capturedRequest);
    const request = capturedRequest as Request;

    // Verify Authorization header format
    assertEquals(
      request.headers.get("Authorization"),
      `Bearer ${testKey}`,
    );
    assertEquals(request.headers.get("apikey"), testKey);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("sendBroadcast: constructs correct realtime URL", async () => {
  let capturedRequest: Request | null = null;
  const originalFetch = globalThis.fetch;

  const testCases = [
    {
      url: "https://test.supabase.co",
      expected: "https://test.supabase.co/realtime/v1/api/broadcast",
    },
    {
      url: "https://test.supabase.co/",
      expected: "https://test.supabase.co/realtime/v1/api/broadcast",
    },
    {
      url: "https://abc123.supabase.co",
      expected: "https://abc123.supabase.co/realtime/v1/api/broadcast",
    },
  ];

  for (const testCase of testCases) {
    Deno.env.set("SUPABASE_URL", testCase.url);
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      capturedRequest = input instanceof Request
        ? input
        : new Request(input, init);
      return new Response(null, { status: 200 });
    };

    try {
      await sendBroadcast("device:test", "test_event", {});

      assertExists(capturedRequest);
      const request = capturedRequest as Request;
      assertEquals(request.url, testCase.expected);
    } finally {
      // Continue to next test case
    }
  }

  globalThis.fetch = originalFetch;
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
});

Deno.test("sendBroadcast: throws error when SUPABASE_URL is missing", async () => {
  // Ensure environment variables are not set
  Deno.env.delete("SUPABASE_URL");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

  try {
    await assertRejects(
      async () => {
        await sendBroadcast("device:test", "test_event", {});
      },
      Error,
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  } finally {
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("sendBroadcast: throws error when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");

  try {
    await assertRejects(
      async () => {
        await sendBroadcast("device:test", "test_event", {});
      },
      Error,
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  } finally {
    Deno.env.delete("SUPABASE_URL");
  }
});
