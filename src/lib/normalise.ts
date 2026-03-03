/**
 * Normalisation helpers for optional field values.
 * Consolidates identical functions previously duplicated across
 * src/lib/events.ts, src/lib/artists.ts, src/lib/planning/index.ts,
 * src/lib/public-api/events.ts, and src/actions/events.ts.
 */

/** Trim a string value; return null for empty / non-string input. */
export function normaliseOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** Parse a numeric value from unknown input; return null for non-finite results. */
export function normaliseOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Like normaliseOptionalNumber but rejects non-integer values. */
export function normaliseOptionalInteger(value: unknown): number | null {
  const parsed = normaliseOptionalNumber(value);
  if (parsed === null) return null;
  return Number.isInteger(parsed) ? parsed : null;
}
