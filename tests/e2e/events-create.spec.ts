import { test, expect } from "@playwright/test";

const email = process.env.E2E_TEST_USER_EMAIL ?? "";
const password = process.env.E2E_TEST_USER_PASSWORD ?? "";

async function chooseFirstVenue(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /choose host venue/i }).click();
  const options = page.getByRole("listbox").getByRole("option");
  const optionNames = await options.allTextContents();
  const venueIndex = optionNames.findIndex((name) => !/internal/i.test(name));
  await options.nth(venueIndex >= 0 ? venueIndex : 0).click();
}

test.describe("Event creation reliability", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
    await page.goto("/events");
  });

  test("golden path: create draft, edit, publish", async ({ page }) => {
    const title = `E2E Golden Path Test Event ${Date.now()}`;

    await page.goto("/events/new");

    await page.getByLabel("Event title").fill(title);
    await chooseFirstVenue(page);
    await page.locator('select[name="eventType"]').selectOption({ label: "Live Music" });
    await expect(page.locator('select[name="eventType"]')).toHaveValue("Live Music");
    await page.getByLabel("Starts").fill("2026-12-25T18:00");
    await page.getByLabel("Ends").fill("2026-12-25T23:00");
    await page.getByLabel("Spaces").fill("Main Bar");

    await page.getByRole("button", { name: /save draft/i }).click();

    const successToast = page.getByText(/draft saved/i);
    await expect(successToast).toBeVisible({ timeout: 10_000 });
    await expect(successToast).not.toContainText("(ref:");

    await expect(page).toHaveURL(/\/events\/[0-9a-f-]+/);

    await page.getByRole("button", { name: /^publish$/i }).click();

    await expect(page.getByRole("status").filter({ hasText: /event approved instantly/i })).toBeVisible({ timeout: 30_000 });
  });

  test("validation edge: missing venue preserves input", async ({ page }) => {
    await page.goto("/events/new");

    const title = `E2E Missing Venue Test ${Date.now()}`;
    await page.getByLabel("Event title").fill(title);
    await page.locator('select[name="eventType"]').selectOption({ label: "Live Music" });
    await expect(page.locator('select[name="eventType"]')).toHaveValue("Live Music");
    await page.getByLabel("Starts").fill("2026-12-25T18:00");
    await page.getByLabel("Ends").fill("2026-12-25T23:00");
    await page.getByLabel("Spaces").fill("Main Bar");

    await page.getByRole("button", { name: /save draft/i }).click();

    await expect(page.getByText(/choose a venue/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Event title")).toHaveValue(title);
  });
});
