import { describe, expect, it } from "vitest";
import {
  formatInLondon,
  formatWebsiteTime,
  normaliseEventDateTimeForStorage,
  normaliseWebsiteTimeText,
  toLondonDateTimeInputValue
} from "@/lib/datetime";

describe("event datetime normalisation", () => {
  it("treats naive datetime-local input as Europe/London time in summer (BST)", () => {
    const result = normaliseEventDateTimeForStorage("2026-04-13T19:00");
    expect(result).toBe("2026-04-13T18:00:00.000Z");
  });

  it("treats naive datetime-local input as Europe/London time in winter (GMT)", () => {
    const result = normaliseEventDateTimeForStorage("2026-01-13T19:00");
    expect(result).toBe("2026-01-13T19:00:00.000Z");
  });

  it("formats stored UTC timestamp back into London local input value", () => {
    const summer = toLondonDateTimeInputValue("2026-04-13T18:00:00.000Z");
    const winter = toLondonDateTimeInputValue("2026-01-13T19:00:00.000Z");
    expect(summer).toBe("2026-04-13T19:00");
    expect(winter).toBe("2026-01-13T19:00");
  });

  it("rejects invalid London local times during the spring-forward DST gap", () => {
    expect(() => normaliseEventDateTimeForStorage("2026-03-29T01:30")).toThrow(/does not exist in London timezone/i);
  });
});

describe("website time formatting", () => {
  it("uses a dot, lowercase meridiem and omits zero minutes", () => {
    expect(formatWebsiteTime("2026-01-13T13:30:00.000Z")).toBe("1.30pm");
    expect(formatWebsiteTime("2026-01-13T14:00:00.000Z")).toBe("2pm");
    expect(formatWebsiteTime("2026-01-13T09:15:00.000Z")).toBe("9.15am");
  });

  it("uses London time when daylight saving is active", () => {
    expect(formatWebsiteTime("2026-07-13T18:30:00.000Z")).toBe("7.30pm");
    expect(formatInLondon("2026-07-13T18:30:00.000Z").time).toBe("7.30pm");
  });

  it("normalises common times embedded in website copy", () => {
    expect(
      normaliseWebsiteTimeText(
        "Doors 19:00. Music 8:00 PM until 10.30pm. Brunch starts at 09:15."
      )
    ).toBe("Doors 7pm. Music 8pm until 10.30pm. Brunch starts at 9.15am.");
  });

  it("keeps sentence punctuation and does not change unrelated numbers", () => {
    expect(normaliseWebsiteTimeText("Finish at 8pm. Allow 1:30 per table.")).toBe(
      "Finish at 8pm. Allow 1:30 per table."
    );
  });
});
