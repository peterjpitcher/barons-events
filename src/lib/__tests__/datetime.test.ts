import { describe, expect, it } from "vitest";
import { normaliseEventDateTimeForStorage, toLondonDateTimeInputValue } from "@/lib/datetime";

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
});
