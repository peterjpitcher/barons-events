import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the service-role DB client
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));

import { getConfirmedTicketCount, generateUniqueEventSlug } from "../bookings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Mirrors seoSlugSchema in src/lib/validation.ts. A generated slug that fails
// this blocks every later save of the event in the event form.
const SEO_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("getConfirmedTicketCount", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 0 when no bookings", async () => {
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    });
    const count = await getConfirmedTicketCount("event-1");
    expect(count).toBe(0);
  });

  it("sums ticket counts from confirmed bookings", async () => {
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({
              data: [{ ticket_count: 3 }, { ticket_count: 5 }],
              error: null,
            }),
          }),
        }),
      }),
    });
    const count = await getConfirmedTicketCount("event-1");
    expect(count).toBe(8);
  });

  it("throws on DB error", async () => {
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: { message: "DB error" } }),
          }),
        }),
      }),
    });
    await expect(getConfirmedTicketCount("event-1")).rejects.toThrow("DB error");
  });
});

describe("generateUniqueEventSlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Every candidate is unique, so the first base slug is returned as-is.
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ count: 0, error: null }),
        }),
      }),
    });
  });

  it("never returns a slug that seoSlugSchema would reject", async () => {
    // Truncating at 60 characters can land straight on a separator. Every
    // event created now gets a generated slug, so a trailing hyphen would
    // silently block the next save of that event in the form.
    const titles = [
      "Quiz Night",
      "a".repeat(47) + " bcd",
      "a".repeat(50) + " bcd",
      "a".repeat(55) + " bcd",
      "Quiz Night with Elliott at The Rose and Crown, Thorpe Village",
      "Bottomless Brunch & Paint",
    ];

    for (const title of titles) {
      const slug = await generateUniqueEventSlug(title, new Date("2026-08-15T19:00:00.000Z"));
      expect(slug, `slug for ${JSON.stringify(title)}`).toMatch(SEO_SLUG_PATTERN);
      expect(slug.length).toBeLessThanOrEqual(60);
    }
  });

  it("still produces the expected slug for an ordinary title", async () => {
    const slug = await generateUniqueEventSlug("Quiz Night", new Date("2026-08-15T19:00:00.000Z"));
    expect(slug).toBe("quiz-night-2026-08-15");
  });
});
