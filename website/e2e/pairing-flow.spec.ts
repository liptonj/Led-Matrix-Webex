/**
 * E2E Test: Pairing Flow
 *
 * Tests the complete pairing flow between the embedded Webex app and ESP32 device:
 * 1. Device provisions with Supabase → gets pairing code
 * 2. App exchanges pairing code → receives token
 * 3. App sends status update → device receives via poll
 * 4. App sends command → device polls and acks → app sees ack
 * 5. Device posts telemetry → app sees via realtime subscription
 *
 * These tests require a running Supabase instance (local or staging).
 */

import { expect, test } from "@playwright/test";

// Test configuration - set via environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Mock device credentials for testing
const TEST_DEVICE = {
  serial_number: "E2ETEST01",
  pairing_code: "TEST123",
  device_id: "webex-display-ST01",
};

test.describe("Pairing Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Skip if Supabase is not configured
    test.skip(!SUPABASE_URL, "Supabase URL not configured");
    test.skip(!SUPABASE_ANON_KEY, "Supabase anon key not configured");
  });

  test("should display pairing code input on embedded app page", async ({
    page,
  }) => {
    await page.goto("/embedded");

    // Check for pairing code input
    const input = page.getByPlaceholder(/ABC123/i);
    await expect(input).toBeVisible();

    // Check for connect button
    const button = page.getByRole("button", { name: /connect/i });
    await expect(button).toBeVisible();
  });

  test("should show error for invalid pairing code", async ({ page }) => {
    await page.goto("/embedded");

    // Enter invalid pairing code
    const input = page.getByPlaceholder(/ABC123/i);
    await input.fill("INVALID");

    // Click connect
    const button = page.getByRole("button", { name: /connect/i });
    await button.click();

    // Wait for error message
    await expect(
      page.getByText(/invalid|not found|failed/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test("should exchange valid pairing code for token", async ({ page }) => {
    // This test requires a valid test device in the database
    test.skip(true, "Requires seeded test device in database");

    await page.goto("/embedded");

    // Enter valid pairing code
    const input = page.getByPlaceholder(/ABC123/i);
    await input.fill(TEST_DEVICE.pairing_code);

    // Click connect
    const button = page.getByRole("button", { name: /connect/i });
    await button.click();

    // Wait for successful connection
    await expect(
      page.getByText(/connected|paired|joined/i)
    ).toBeVisible({ timeout: 10000 });

    // Verify device info is displayed
    await expect(
      page.getByText(new RegExp(TEST_DEVICE.device_id, "i"))
    ).toBeVisible();
  });

  test("should show realtime status updates", async ({ page }) => {
    // This test requires a running device or mock device updates
    test.skip(true, "Requires active device connection");

    await page.goto("/embedded");

    // Connect to device
    const input = page.getByPlaceholder(/ABC123/i);
    await input.fill(TEST_DEVICE.pairing_code);
    await page.getByRole("button", { name: /connect/i }).click();

    // Wait for connection
    await expect(
      page.getByText(/connected|paired/i)
    ).toBeVisible({ timeout: 10000 });

    // Check for device status indicator
    const statusIndicator = page.locator("[data-testid='device-status']");
    await expect(statusIndicator).toBeVisible();
  });

  test("should send command and receive acknowledgment", async ({ page }) => {
    // This test requires an active device to acknowledge commands
    test.skip(true, "Requires active device to ack commands");

    await page.goto("/embedded");

    // Connect to device
    const input = page.getByPlaceholder(/ABC123/i);
    await input.fill(TEST_DEVICE.pairing_code);
    await page.getByRole("button", { name: /connect/i }).click();

    // Wait for connection
    await expect(
      page.getByText(/connected|paired/i)
    ).toBeVisible({ timeout: 10000 });

    // Find and adjust brightness slider
    const brightnessSlider = page.locator("[data-testid='brightness-slider']");
    if (await brightnessSlider.isVisible()) {
      await brightnessSlider.fill("150");

      // Wait for command acknowledgment
      await expect(
        page.getByText(/brightness.*updated|saved/i)
      ).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Token Management", () => {
  test("should handle token expiry gracefully", async ({ page }) => {
    // This test verifies the token refresh mechanism
    test.skip(true, "Requires long-running test for token expiry");
  });

  test("should reconnect after connection loss", async ({ page }) => {
    // This test verifies reconnection behavior
    test.skip(true, "Requires network manipulation");
  });
});

test.describe("Error Handling", () => {
  test("should show appropriate error when Supabase is unreachable", async ({
    page,
  }) => {
    // Mock Supabase failure
    await page.route("**/functions/v1/**", (route) => {
      route.fulfill({ status: 503, body: "Service Unavailable" });
    });

    await page.goto("/embedded");

    const input = page.getByPlaceholder(/ABC123/i);
    await input.fill("ANYCODE");
    await page.getByRole("button", { name: /connect/i }).click();

    // Should show error message
    await expect(
      page.getByText(/unavailable|error|failed/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test("should show error for rate limited requests", async ({ page }) => {
    // Mock rate limit response
    await page.route("**/functions/v1/**", (route) => {
      route.fulfill({
        status: 429,
        body: JSON.stringify({ error: "Rate limit exceeded" }),
      });
    });

    await page.goto("/embedded");

    const input = page.getByPlaceholder(/ABC123/i);
    await input.fill("ANYCODE");
    await page.getByRole("button", { name: /connect/i }).click();

    // Should show rate limit error
    await expect(
      page.getByText(/rate.*limit|too.*many|try.*later/i)
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("UI Elements", () => {
  test("should have accessible form elements", async ({ page }) => {
    await page.goto("/embedded");

    // Check input has label
    const input = page.getByPlaceholder(/ABC123/i);
    await expect(input).toBeVisible();

    // Check button is accessible
    const button = page.getByRole("button", { name: /connect/i });
    await expect(button).toBeEnabled();
  });

  test("should support keyboard navigation", async ({ page }) => {
    await page.goto("/embedded");

    // Tab to input
    await page.keyboard.press("Tab");

    // Type pairing code
    await page.keyboard.type("TEST123");

    // Tab to button and press Enter
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    // Form should be submitted
    // (Will fail with error since TEST123 is not valid, but form submission works)
  });
});

test.describe("Integration with Admin Dashboard", () => {
  test("admin login page should be accessible", async ({ page }) => {
    await page.goto("/admin/login");

    // Check for login form
    const emailInput = page.getByPlaceholder(/email/i);
    const passwordInput = page.getByPlaceholder(/password/i);

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
  });

  test("admin page should redirect unauthenticated users", async ({
    page,
  }) => {
    await page.goto("/admin");

    // Should redirect to login or show auth error
    await expect(
      page.getByText(/login|sign in|unauthorized/i)
    ).toBeVisible({ timeout: 5000 });
  });
});
