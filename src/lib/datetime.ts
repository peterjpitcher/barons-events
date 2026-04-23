const LONDON_TIME_ZONE = "Europe/London";

export const DISPLAY_TIMEZONE = LONDON_TIME_ZONE;

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const londonFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function hasExplicitOffset(value: string): boolean {
  return /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value.trim());
}

function parseLocalDateTime(value: string): DateTimeParts | null {
  const match = value
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
    );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    !Number.isInteger(millisecond)
  ) {
    return null;
  }
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;
  if (millisecond < 0 || millisecond > 999) return null;

  return { year, month, day, hour, minute, second, millisecond };
}

function partsToUtcMillis(parts: DateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
}

function londonPartsFromUtcMillis(utcMillis: number): DateTimeParts {
  const date = new Date(utcMillis);
  const tokenMap: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  londonFormatter.formatToParts(date).forEach((part) => {
    tokenMap[part.type] = part.value;
  });

  return {
    year: Number(tokenMap.year ?? "0"),
    month: Number(tokenMap.month ?? "0"),
    day: Number(tokenMap.day ?? "0"),
    hour: Number(tokenMap.hour ?? "0"),
    minute: Number(tokenMap.minute ?? "0"),
    second: Number(tokenMap.second ?? "0"),
    millisecond: 0
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toInputString(parts: DateTimeParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function normaliseEventDateTimeForStorage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.length) return value;

  if (hasExplicitOffset(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  const localParts = parseLocalDateTime(trimmed);
  if (!localParts) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  let guessUtcMillis = partsToUtcMillis(localParts);
  const targetKey = partsToUtcMillis(localParts);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const londonParts = londonPartsFromUtcMillis(guessUtcMillis);
    const currentKey = partsToUtcMillis(londonParts);
    const deltaMillis = targetKey - currentKey;
    if (deltaMillis === 0) {
      break;
    }
    guessUtcMillis += deltaMillis;
  }

  // Round-trip check: convert the resolved UTC time back to London local time
  // and verify it matches the original input. If it doesn't, the input time
  // falls inside a DST spring-forward gap (e.g. 01:30 on the last Sunday of
  // March in the UK, when clocks jump from 01:00 straight to 02:00).
  const roundTripped = londonPartsFromUtcMillis(guessUtcMillis);
  if (
    roundTripped.hour !== localParts.hour ||
    roundTripped.minute !== localParts.minute ||
    roundTripped.day !== localParts.day ||
    roundTripped.month !== localParts.month ||
    roundTripped.year !== localParts.year
  ) {
    const inputTime = `${pad(localParts.hour)}:${pad(localParts.minute)}`;
    throw new Error(
      `The time ${inputTime} does not exist in London timezone due to daylight saving time. ` +
      `Clocks spring forward from 01:00 to 02:00 on this date.`
    );
  }

  return new Date(guessUtcMillis).toISOString();
}

export function toLondonDateTimeInputValue(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed.length) return "";

  const directLocal = parseLocalDateTime(trimmed);
  if (directLocal && !hasExplicitOffset(trimmed)) {
    return toInputString(directLocal);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return toInputString(londonPartsFromUtcMillis(parsed.getTime()));
}

/**
 * Returns a human-readable relative time string for display (e.g. "3 days ago", "yesterday").
 * Returns "Never signed in" when date is null.
 * Value is computed at call time (SSR) — it does not live-update in the browser.
 */
const londonDateChipFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short"
});

const londonTimeChipFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true
});

/**
 * Format a UTC/ISO date string into London-local display strings.
 * Returns { date: "Thu 28 May", time: "7:30pm" }.
 */
export function formatInLondon(isoString: string): { date: string; time: string } {
  const d = new Date(isoString);
  return {
    date: londonDateChipFormatter.format(d),
    time: londonTimeChipFormatter.format(d).toLowerCase().replace(/\s/g, "")
  };
}

/**
 * Returns today's date as YYYY-MM-DD in the Europe/London timezone.
 * Useful for idempotency keys and date-scoped queries.
 */
export function getTodayLondonIsoDate(): string {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function formatRelativeTime(date: Date | null): string {
  if (!date) return "Never signed in";

  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const diffMs = date.getTime() - Date.now();
  const absDiffMs = Math.abs(diffMs);

  if (absDiffMs < 60_000) {
    return rtf.format(Math.round(diffMs / 1000), "second");
  }
  if (absDiffMs < 3_600_000) {
    return rtf.format(Math.round(diffMs / 60_000), "minute");
  }
  if (absDiffMs < 86_400_000) {
    return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  }
  if (absDiffMs < 2_592_000_000) {
    return rtf.format(Math.round(diffMs / 86_400_000), "day");
  }
  if (absDiffMs < 31_536_000_000) {
    return rtf.format(Math.round(diffMs / 2_592_000_000), "month");
  }
  return rtf.format(Math.round(diffMs / 31_536_000_000), "year");
}
