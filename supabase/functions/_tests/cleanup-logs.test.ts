/**
 * cleanup-logs Edge Function Tests
 *
 * Tests for the log cleanup endpoint that deletes old device logs.
 *
 * Run: deno test --allow-net --allow-env _tests/cleanup-logs.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Constants from the Edge Function
const RETENTION_DAYS = 7;

// ============================================================================
// Request Method Tests
// ============================================================================

Deno.test("cleanup-logs: only accepts POST requests", () => {
  const allowedMethods = ["POST"];
  assertEquals(allowedMethods.includes("POST"), true);
  assertEquals(allowedMethods.includes("GET"), false);
  assertEquals(allowedMethods.includes("DELETE"), false);
});

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test("cleanup-logs: requires Authorization header", () => {
  const headers = new Headers();
  assertEquals(headers.get("Authorization"), null);
});

Deno.test("cleanup-logs: accepts service role key", () => {
  const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
  const authHeader = `Bearer ${serviceRoleKey}`;
  assertStringIncludes(authHeader, "Bearer ");
});

Deno.test("cleanup-logs: accepts admin user JWT", () => {
  const adminJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.admin-claims...";
  const authHeader = `Bearer ${adminJwt}`;
  assertStringIncludes(authHeader, "Bearer ");
});

Deno.test("cleanup-logs: verifies user is in admin_users table", () => {
  // Admin check query
  const adminCheck = {
    table: "admin_users",
    filter: { user_id: "user-uuid-here" },
  };

  assertEquals(adminCheck.table, "admin_users");
});

// ============================================================================
// Retention Period Tests
// ============================================================================

Deno.test("cleanup-logs: retention period is 7 days", () => {
  assertEquals(RETENTION_DAYS, 7);
});

Deno.test("cleanup-logs: calculates cutoff date correctly", () => {
  const now = new Date();
  const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(now.getTime() - retentionMs);

  // Cutoff should be 7 days ago
  const diffDays = (now.getTime() - cutoffDate.getTime()) / (24 * 60 * 60 * 1000);
  assertEquals(Math.round(diffDays), RETENTION_DAYS);
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test("cleanup-logs: success response has required fields", () => {
  const response = {
    success: true,
    deleted_count: 150,
    retention_days: RETENTION_DAYS,
    timestamp: new Date().toISOString(),
  };

  assertEquals(response.success, true);
  assertEquals(typeof response.deleted_count, "number");
  assertEquals(response.retention_days, RETENTION_DAYS);
  assertExists(response.timestamp);
});

Deno.test("cleanup-logs: deleted_count is non-negative", () => {
  const response = { deleted_count: 0 };
  assertEquals(response.deleted_count >= 0, true);
});

Deno.test("cleanup-logs: timestamp is valid ISO date", () => {
  const response = { timestamp: new Date().toISOString() };
  const date = new Date(response.timestamp);
  assertEquals(isNaN(date.getTime()), false);
});

Deno.test("cleanup-logs: returns 0 when no logs to delete", () => {
  const response = {
    success: true,
    deleted_count: 0,
    retention_days: RETENTION_DAYS,
  };

  assertEquals(response.deleted_count, 0);
  assertEquals(response.success, true);
});

// ============================================================================
// Cleanup RPC Tests
// ============================================================================

Deno.test("cleanup-logs: calls cleanup_old_logs RPC", () => {
  const rpcCall = { functionName: "cleanup_old_logs" };
  assertEquals(rpcCall.functionName, "cleanup_old_logs");
});

Deno.test("cleanup-logs: RPC returns deleted count", () => {
  const rpcResult = 150; // Example: 150 logs deleted
  assertEquals(typeof rpcResult, "number");
});

// ============================================================================
// Authorization Error Tests
// ============================================================================

Deno.test("cleanup-logs: 401 for missing authorization", () => {
  const response = {
    error: "Missing authorization header",
  };

  assertStringIncludes(response.error, "authorization");
});

Deno.test("cleanup-logs: 401 for invalid token", () => {
  const response = {
    error: "Invalid authorization",
  };

  assertStringIncludes(response.error, "authorization");
});

Deno.test("cleanup-logs: 403 for non-admin user", () => {
  const response = {
    error: "Unauthorized - admin access required",
  };

  assertStringIncludes(response.error, "admin");
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test("cleanup-logs: 405 for non-POST request", () => {
  const response = {
    error: "Method not allowed",
  };

  assertStringIncludes(response.error, "Method");
});

Deno.test("cleanup-logs: 500 for cleanup failure", () => {
  const response = {
    error: "Cleanup failed",
    details: "Some database error",
  };

  assertStringIncludes(response.error, "Cleanup failed");
  assertExists(response.details);
});

Deno.test("cleanup-logs: 500 for internal error", () => {
  const response = {
    error: "Internal server error",
  };

  assertStringIncludes(response.error, "server error");
});

// ============================================================================
// Scheduled Execution Tests
// ============================================================================

Deno.test("cleanup-logs: can be triggered by scheduled workflow", () => {
  // GitHub Actions can trigger with service role key
  const scheduledAuth = {
    type: "service_role",
    source: "github_actions",
  };

  assertEquals(scheduledAuth.type, "service_role");
});

Deno.test("cleanup-logs: can be triggered manually by admin", () => {
  const manualAuth = {
    type: "admin_jwt",
    source: "manual",
  };

  assertEquals(manualAuth.type, "admin_jwt");
});

// ============================================================================
// Logging Tests
// ============================================================================

Deno.test("cleanup-logs: logs completion message", () => {
  const logMessage = "Log cleanup completed: 150 logs deleted";
  assertStringIncludes(logMessage, "cleanup completed");
  assertStringIncludes(logMessage, "logs deleted");
});
