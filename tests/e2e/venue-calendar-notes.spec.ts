import { test, expect } from "@playwright/test";

const email = process.env.E2E_TEST_USER_EMAIL ?? "";
const password = process.env.E2E_TEST_USER_PASSWORD ?? "";

/**
 * The note lives on the 15th of next month: always in the future, always
 * inside the dashboard's 90-day clash window, and always exactly one
 * "Next" click away from the planning calendar's default month.
 */
function futureNoteDate(): { noteDate: string; monthParam: string } {
  const target = new Date();
  target.setDate(1);
  target.setMonth(target.getMonth() + 1);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  return { noteDate: `${year}-${month}-15`, monthParam: `${year}-${month}` };
}

async function openPlanningCalendarNextMonth(page: import("@playwright/test").Page) {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

test.describe("Venue calendar notes journey", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    test.skip(!email || !password, "E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD are required");
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
  });

  test("create, surface, clash, edit and delete a venue note", async ({ page }) => {
    const stamp = Date.now();
    const noteTitle = `E2E note ${stamp}`;
    const updatedTitle = `E2E note edited ${stamp}`;
    const eventTitle = `E2E note clash event ${stamp}`;
    const { noteDate, monthParam } = futureNoteDate();

    // 1. Planning calendar: add a note at a venue for a future date.
    await page.goto("/planning");
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();

    const createDialog = page.getByRole("dialog").filter({ hasText: "Add calendar note" });
    await expect(createDialog).toBeVisible();

    // Pick the first non-internal venue and remember its name so the
    // clashing event can be created at the same venue later.
    const venueSelect = createDialog.getByLabel("Venue");
    const optionNames = await venueSelect.locator("option").allTextContents();
    const venueName = optionNames.find((name) => !/internal/i.test(name)) ?? optionNames[0];
    await venueSelect.selectOption({ label: venueName });

    await createDialog.getByLabel("Title").fill(noteTitle);
    await createDialog.getByLabel("Start date").fill(noteDate);
    await createDialog.getByLabel("Detail (optional)").fill("Created by the venue calendar notes e2e journey.");
    await createDialog.getByRole("button", { name: "Save note" }).click();
    await expect(createDialog).toBeHidden({ timeout: 10_000 });

    // 2. The note pill appears on the planning calendar (next month).
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("button", { name: noteTitle })).toBeVisible({ timeout: 10_000 });

    // 3. The note pill appears on the events month calendar for that month.
    await page.goto(`/events?month=${monthParam}`);
    await expect(page.getByRole("button", { name: noteTitle })).toBeVisible({ timeout: 10_000 });

    // 4. Creating an event at that venue and date shows the advisory
    //    warning, and the event still saves (notes advise, never block).
    await page.goto("/events/new");
    await page.getByLabel("Event title").fill(eventTitle);
    await page.getByRole("button", { name: /choose host venue/i }).click();
    await page.getByRole("listbox").getByRole("option", { name: venueName }).first().click();
    await page.locator('select[name="eventType"]').selectOption({ label: "Live Music" });
    await page.getByLabel("Starts").fill(`${noteDate}T18:00`);
    await page.getByLabel("Ends").fill(`${noteDate}T21:00`);
    await page.getByLabel("Spaces").fill("Main Bar");

    await expect(page.getByText(/heads up:/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /save draft/i }).click();
    await expect(page.getByText(/draft saved/i)).toBeVisible({ timeout: 10_000 });

    // 5. Dashboard: the note clash row surfaces the clash.
    await page.goto("/");
    await expect(page.getByText(/clashes with note/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(noteTitle).first()).toBeVisible();

    // 6. Edit the note title via its pill on the planning calendar.
    await openPlanningCalendarNextMonth(page);
    await page.getByRole("button", { name: noteTitle }).click();

    const editDialog = page.getByRole("dialog").filter({ hasText: "Edit calendar note" });
    await expect(editDialog).toBeVisible();
    await editDialog.getByLabel("Title").fill(updatedTitle);
    await editDialog.getByRole("button", { name: "Save note" }).click();
    await expect(editDialog).toBeHidden({ timeout: 10_000 });

    await expect(page.getByRole("button", { name: updatedTitle })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: noteTitle })).toHaveCount(0);

    // 7. Delete the note (two-step confirm) and check it is gone.
    await page.getByRole("button", { name: updatedTitle }).click();
    const deleteDialog = page.getByRole("dialog").filter({ hasText: "Edit calendar note" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete note", exact: true }).click();

    await expect(page.getByRole("button", { name: updatedTitle })).toHaveCount(0, { timeout: 10_000 });
  });
});
