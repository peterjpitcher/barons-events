import { test, expect } from "@playwright/test";

const email = process.env.E2E_TEST_USER_EMAIL ?? "";
const password = process.env.E2E_TEST_USER_PASSWORD ?? "";

test.describe("Event creation reliability", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/events**");
  });

  test("golden path: create draft, edit, submit", async ({ page }) => {
    await page.goto("/events/new");

    await page.getByLabel("Event title").fill("E2E Golden Path Test Event");
    await page.getByLabel("Venue").selectOption({ index: 1 });
    await page.getByLabel("Event type").selectOption({ index: 1 });
    await page.getByLabel("Start").fill("2026-12-25T18:00");
    await page.getByLabel("End").fill("2026-12-25T23:00");

    await page.getByRole("button", { name: /save draft/i }).click();

    const successToast = page.getByText(/draft saved/i);
    await expect(successToast).toBeVisible({ timeout: 10_000 });
    await expect(successToast).not.toContainText("(ref:");

    await expect(page).toHaveURL(/\/events\/[0-9a-f-]+/);

    await page.getByRole("button", { name: /submit for review/i }).click();

    const submitToast = page.getByText(/submitted/i);
    await expect(submitToast).toBeVisible({ timeout: 10_000 });
    await expect(submitToast).not.toContainText("(ref:");
  });

  test("venue failure edge: form preserves input, error toast shows ref", async ({ page }) => {
    await page.route("**/rest/v1/rpc/save_event_draft", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          event_id: null,
          failed: [{ kind: "venue", id: "00000000-0000-0000-0000-000000000001", reason: "RLS denied" }],
          operation_id: "e2e-op-00000000-0000-0000-0000-aabbccddee00",
          warnings: [],
        }),
      });
    });

    await page.goto("/events/new");

    const title = "E2E Venue Failure Test";
    await page.getByLabel("Event title").fill(title);
    await page.getByLabel("Venue").selectOption({ index: 1 });
    await page.getByLabel("Event type").selectOption({ index: 1 });
    await page.getByLabel("Start").fill("2026-12-25T18:00");
    await page.getByLabel("End").fill("2026-12-25T23:00");

    await page.getByRole("button", { name: /save draft/i }).click();

    const errorToast = page.getByText(/ref:/i);
    await expect(errorToast).toBeVisible({ timeout: 10_000 });
    await expect(errorToast).toContainText("(ref:");

    await expect(page.getByLabel("Event title")).toHaveValue(title);
  });
});
