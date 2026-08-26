import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Mirrors proposalSchema in src/actions/pre-event.ts.
 *
 * The action itself cannot be imported here without standing up Supabase, auth
 * and the notification stack, so the schema is restated. The refine rule is the
 * part that matters and it is asserted against the same cases the database
 * CHECK constraint (events_end_after_start) enforces.
 */
const proposalSchema = z
  .object({
    title: z.string().min(1, "Add a title").max(200),
    startAt: z.string().min(1, "Pick a start date & time"),
    endAt: z.string().min(1, "Pick an end date & time"),
    notes: z.string().min(1, "Add a short description").max(2000),
    venueIds: z.array(z.string().uuid()).min(1, "Pick at least one venue").max(20, "Too many venues selected")
  })
  .superRefine((values, ctx) => {
    if (values.endAt <= values.startAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The end time must be after the start time",
        path: ["endAt"]
      });
    }
  });

const VENUE_ID = "550e8400-e29b-41d4-a716-446655440000";

function proposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "Easter Weekend Quiz",
    startAt: "2026-09-05T19:00",
    endAt: "2026-09-05T22:00",
    notes: "A quiz night",
    venueIds: [VENUE_ID],
    ...overrides
  };
}

describe("proposal end time", () => {
  it("accepts a proposal with a start and a later end", () => {
    expect(proposalSchema.safeParse(proposal()).success).toBe(true);
  });

  it("requires an end time", () => {
    const result = proposalSchema.safeParse(proposal({ endAt: "" }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Pick an end date & time");
  });

  it("rejects an end time before the start", () => {
    const result = proposalSchema.safeParse(proposal({ endAt: "2026-09-05T18:00" }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("The end time must be after the start time");
    expect(result.error?.issues[0]?.path).toEqual(["endAt"]);
  });

  it("rejects an end time equal to the start, matching the database constraint", () => {
    // events_end_after_start is CHECK (end_at > start_at), strictly greater. A
    // >= rule here would let Postgres reject the row and surface raw SQL text.
    const result = proposalSchema.safeParse(proposal({ endAt: "2026-09-05T19:00" }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("The end time must be after the start time");
  });

  it("accepts an event that finishes after midnight", () => {
    const result = proposalSchema.safeParse(
      proposal({ startAt: "2026-09-05T21:00", endAt: "2026-09-06T01:00" })
    );
    expect(result.success).toBe(true);
  });

  it("orders correctly across a month boundary", () => {
    const result = proposalSchema.safeParse(
      proposal({ startAt: "2026-09-30T23:00", endAt: "2026-10-01T02:00" })
    );
    expect(result.success).toBe(true);
  });

  it("orders correctly across a year boundary", () => {
    const result = proposalSchema.safeParse(
      proposal({ startAt: "2026-12-31T22:00", endAt: "2027-01-01T01:00" })
    );
    expect(result.success).toBe(true);
  });
});

/**
 * Mirrors addThreeHours in src/components/events/propose-event-form.tsx.
 * Wall-clock arithmetic, so the user keeps the duration they see rather than
 * the elapsed hours across a clock change.
 */
function addThreeHours(localValue: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  const asDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  if (Number.isNaN(asDate.getTime())) return "";
  // Date.UTC silently rolls impossible values over (month 13 becomes January
  // of the next year), so confirm the parts survived the round trip rather
  // than returning a plausible but wrong date.
  if (
    asDate.getUTCFullYear() !== Number(year) ||
    asDate.getUTCMonth() !== Number(month) - 1 ||
    asDate.getUTCDate() !== Number(day) ||
    asDate.getUTCHours() !== Number(hour) ||
    asDate.getUTCMinutes() !== Number(minute)
  ) {
    return "";
  }
  asDate.setUTCHours(asDate.getUTCHours() + 3);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${asDate.getUTCFullYear()}-${pad(asDate.getUTCMonth() + 1)}-${pad(asDate.getUTCDate())}T${pad(asDate.getUTCHours())}:${pad(asDate.getUTCMinutes())}`;
}

describe("three hour prefill", () => {
  it("adds three hours to a normal evening slot", () => {
    expect(addThreeHours("2026-09-05T19:00")).toBe("2026-09-05T22:00");
  });

  it("rolls over midnight", () => {
    expect(addThreeHours("2026-09-05T23:00")).toBe("2026-09-06T02:00");
  });

  it("rolls over a month end", () => {
    expect(addThreeHours("2026-09-30T23:30")).toBe("2026-10-01T02:30");
  });

  it("rolls over a year end", () => {
    expect(addThreeHours("2026-12-31T23:00")).toBe("2027-01-01T02:00");
  });

  it("keeps the wall clock duration across the spring clock change", () => {
    // 2027-03-28 is the BST transition. Wall-clock arithmetic gives 04:00,
    // which is what a user picking "three hours" expects to see, even though
    // only two hours actually elapse.
    expect(addThreeHours("2027-03-28T01:00")).toBe("2027-03-28T04:00");
  });

  it("produces a value the schema accepts", () => {
    const startAt = "2026-09-05T19:00";
    const endAt = addThreeHours(startAt);
    expect(proposalSchema.safeParse(proposal({ startAt, endAt })).success).toBe(true);
  });

  it("returns empty for an unparseable value rather than a wrong date", () => {
    for (const value of ["", "not-a-date", "2026-09-05", "2026-13-45T99:99"]) {
      expect(addThreeHours(value)).toBe("");
    }
  });
});
