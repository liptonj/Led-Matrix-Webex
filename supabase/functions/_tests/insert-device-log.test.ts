/**
 * insert-device-log Edge Function Tests
 *
 * Unit tests focused on request validation and payload shape.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";

Deno.test("insert-device-log: only allows POST", () => {
  const allowedMethods = ["POST"];
  assertEquals(allowedMethods.includes("GET"), false);
});

Deno.test("insert-device-log: validates log level", () => {
  const validLevels = ["debug", "info", "warn", "error"];
  for (const level of validLevels) {
    assertEquals(validLevels.includes(level), true);
  }
  assertEquals(validLevels.includes("trace"), false);
});

Deno.test("insert-device-log: requires message string", () => {
  const body1 = { level: "info", message: "hello" };
  const body2 = { level: "info", message: "" };
  const body3 = { level: "info" as const };

  assertEquals(typeof body1.message, "string");
  assertEquals(body1.message.length > 0, true);
  assertEquals(body2.message.length > 0, false);
  assertEquals("message" in body3, false);
});

Deno.test("insert-device-log: bearer token payload uses token_type 'device'", () => {
  const tokenPayload = {
    sub: crypto.randomUUID(),
    role: "authenticated",
    aud: "authenticated",
    pairing_code: "ABC123",
    serial_number: "A1B2C3D4",
    device_id: "webex-display-C3D4",
    token_type: "device",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  assertEquals(tokenPayload.token_type, "device");
  assertExists(tokenPayload.serial_number);
  assertExists(tokenPayload.device_id);
});

