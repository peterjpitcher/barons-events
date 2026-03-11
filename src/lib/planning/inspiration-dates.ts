import 'server-only';
import type { PlanningInspirationItem } from './types';

type InspirationDateItem = Omit<PlanningInspirationItem, 'id'>;

/**
 * Computes Easter Sunday for a given year using the Anonymous Gregorian algorithm.
 * Returns a local-time Date (not UTC) to avoid timezone drift in calendar comparisons.
 */
export function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  // month is 1-indexed (3=March, 4=April); Date constructor uses 0-indexed months
  return new Date(year, month - 1, day);
}

/**
 * Computes UK Mothering Sunday — the 4th Sunday of Lent, which is 3 Sundays
 * before Easter (21 days before Easter Sunday).
 */
export function computeMothersDayUK(year: number): Date {
  const easter = computeEasterSunday(year);
  return new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 21);
}

/**
 * Computes Father's Day — the 3rd Sunday of June.
 */
export function computeFathersDay(year: number): Date {
  // Find the first Sunday in June
  const firstOfJune = new Date(year, 5, 1); // month 5 = June (0-indexed)
  const dayOfWeek = firstOfJune.getDay(); // 0=Sun, 1=Mon, ...
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const firstSunday = 1 + daysUntilSunday;
  // 3rd Sunday = first Sunday + 14 days
  return new Date(year, 5, firstSunday + 14);
}

/**
 * Formats a local-time Date as a YYYY-MM-DD string without timezone conversion.
 */
function toIsoDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns fixed (same date every year) seasonal occasions within the window.
 */
export function getFixedSeasonalDates(
  windowStart: Date,
  windowEnd: Date
): InspirationDateItem[] {
  const startYear = windowStart.getFullYear();
  const endYear = windowEnd.getFullYear();

  const windowStartStr = toIsoDateString(windowStart);
  const windowEndStr = toIsoDateString(windowEnd);

  // Fixed occasions: [month (0-indexed), day, name, description]
  const FIXED_OCCASIONS: Array<[number, number, string, string | null]> = [
    [1, 14, "Valentine's Day", "A celebration of love and romance."],
    [2, 17, "St Patrick's Day", "Irish cultural and religious celebration."],
    [9, 31, 'Halloween', 'All Hallows\' Eve — fancy dress and festivities.'],
    [10, 5, 'Bonfire Night', 'Guy Fawkes Night — fireworks and bonfires.'],
    [11, 24, 'Christmas Eve', 'The evening before Christmas Day.'],
    [11, 25, 'Christmas Day', 'Christmas Day celebrations.'],
    [11, 26, 'Boxing Day', 'Bank holiday following Christmas Day.'],
    [11, 31, "New Year's Eve", 'See in the New Year with celebrations.'],
  ];

  const items: InspirationDateItem[] = [];

  for (let year = startYear; year <= endYear; year++) {
    for (const [month, day, name, description] of FIXED_OCCASIONS) {
      const dateStr = toIsoDateString(new Date(year, month, day));
      if (dateStr >= windowStartStr && dateStr <= windowEndStr) {
        items.push({
          eventName: name,
          eventDate: dateStr,
          category: 'seasonal',
          description,
          source: 'computed',
        });
      }
    }
  }

  return items;
}

/**
 * Returns floating (algorithmically computed) occasions within the window.
 */
export function getComputedDates(
  windowStart: Date,
  windowEnd: Date
): InspirationDateItem[] {
  const startYear = windowStart.getFullYear();
  const endYear = windowEnd.getFullYear();

  const windowStartStr = toIsoDateString(windowStart);
  const windowEndStr = toIsoDateString(windowEnd);

  const items: InspirationDateItem[] = [];

  for (let year = startYear; year <= endYear; year++) {
    const mothersDay = computeMothersDayUK(year);
    const mothersDayStr = toIsoDateString(mothersDay);
    if (mothersDayStr >= windowStartStr && mothersDayStr <= windowEndStr) {
      items.push({
        eventName: "Mother's Day",
        eventDate: mothersDayStr,
        category: 'floating',
        description: 'UK Mothering Sunday — 3 Sundays before Easter.',
        source: 'computed',
      });
    }

    const fathersDay = computeFathersDay(year);
    const fathersDayStr = toIsoDateString(fathersDay);
    if (fathersDayStr >= windowStartStr && fathersDayStr <= windowEndStr) {
      items.push({
        eventName: "Father's Day",
        eventDate: fathersDayStr,
        category: 'floating',
        description: "Father's Day — 3rd Sunday of June.",
        source: 'computed',
      });
    }
  }

  // Also include fixed seasonal dates combined with floating
  const fixed = getFixedSeasonalDates(windowStart, windowEnd);
  items.push(...fixed);

  // Sort by date
  items.sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  return items;
}
