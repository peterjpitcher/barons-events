const LONDON_TIME_ZONE = "Europe/London";

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
