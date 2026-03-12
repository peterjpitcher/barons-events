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
 * Returns the Nth occurrence of a given weekday in a given month.
 * @param weekday 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 * @param n 1-based (1 = first, 2 = second, etc.)
 */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = firstOfMonth.getDay();
  const firstTarget = 1 + ((weekday - firstWeekday + 7) % 7);
  return new Date(year, month, firstTarget + (n - 1) * 7);
}

/**
 * Returns the last occurrence of a given weekday in a given month.
 * @param weekday 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const lastOfMonth = new Date(year, month + 1, 0);
  const diff = (lastOfMonth.getDay() - weekday + 7) % 7;
  return new Date(year, month, lastOfMonth.getDate() - diff);
}

/** World Whisky Day — 3rd Saturday of May. */
export function computeWorldWhiskyDay(year: number): Date {
  return nthWeekdayOfMonth(year, 4, 6, 3); // month 4 = May, weekday 6 = Sat
}

/** World Gin Day — 2nd Saturday of June. */
export function computeWorldGinDay(year: number): Date {
  return nthWeekdayOfMonth(year, 5, 6, 2); // month 5 = June, weekday 6 = Sat
}

/** National Fish & Chip Day — 1st Friday of June. */
export function computeNationalFishAndChipDay(year: number): Date {
  return nthWeekdayOfMonth(year, 5, 5, 1); // month 5 = June, weekday 5 = Fri
}

/** International Beer Day — 1st Friday of August. */
export function computeInternationalBeerDay(year: number): Date {
  return nthWeekdayOfMonth(year, 7, 5, 1); // month 7 = August, weekday 5 = Fri
}

/** National Burger Day (UK) — last Thursday of August. */
export function computeNationalBurgerDay(year: number): Date {
  return lastWeekdayOfMonth(year, 7, 4); // month 7 = August, weekday 4 = Thu
}

/** National Curry Week — 2nd Monday of October. */
export function computeNationalCurryWeek(year: number): Date {
  return nthWeekdayOfMonth(year, 9, 1, 2); // month 9 = October, weekday 1 = Mon
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
    // January
    [0, 1,  'Veganuary',              'Plant-based January — an opportunity for vegan menu promotions.'],
    // February
    [1, 9,  'World Pizza Day',        'A global celebration of pizza — great for food promotions.'],
    [1, 14, "Valentine's Day",        'A celebration of love and romance.'],
    [1, 22, 'National Margarita Day', 'A cocktail occasion ideal for themed bar promotions.'],
    // March
    [2, 1,  'British Pie Week',       'Annual celebration of the great British pie — ideal for pub food promotions.'],
    [2, 17, "St Patrick's Day",       'Irish cultural and religious celebration.'],
    // April
    [3, 7,  'National Beer Day',      'Celebrate British beer culture with specials and tap takeovers.'],
    [3, 21, 'National Tea Day',       "A celebration of the UK's favourite brew."],
    // July
    [6, 7,  'World Chocolate Day',    'A global celebration of all things chocolate.'],
    [6, 11, 'World Rum Day',          'Celebrate rum with cocktail specials and promotions.'],
    [6, 24, 'World Tequila Day',      'A celebration of the iconic spirit — cocktail menus and themed events.'],
    // August
    [7, 13, 'National Prosecco Day',  "Celebrate the nation's favourite fizz with bottle deals and brunch events."],
    // October
    [9, 31, 'Halloween',              'All Hallows\' Eve — fancy dress and festivities.'],
    // November
    [10, 5, 'Bonfire Night',          'Guy Fawkes Night — fireworks and bonfires.'],
    [10, 3, 'National Sandwich Day',  'Celebrate the great British sandwich with specials and meal deals.'],
    // December
    [11, 24, 'Christmas Eve',         'The evening before Christmas Day.'],
    [11, 25, 'Christmas Day',         'Christmas Day celebrations.'],
    [11, 26, 'Boxing Day',            'Bank holiday following Christmas Day.'],
    [11, 31, "New Year's Eve",        'See in the New Year with celebrations.'],
    // October (global)
    [9, 1,  'World Coffee Day',       'A global celebration of coffee culture — ideal for café and brunch promotions.'],
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
 * Returns ALL computed occasions within the window — both fixed seasonal dates
 * (Valentine's Day, Christmas, etc., via `getFixedSeasonalDates`) and floating
 * dates that are calculated relative to Easter (Mother's Day, Father's Day).
 * Results are sorted chronologically by date.
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

  // Floating occasions: [compute fn, name, description]
  const FLOATING_OCCASIONS: Array<[(year: number) => Date, string, string]> = [
    [computeMothersDayUK,           "Mother's Day",          'UK Mothering Sunday — 3 Sundays before Easter.'],
    [computeFathersDay,             "Father's Day",          "Father's Day — 3rd Sunday of June."],
    [computeWorldWhiskyDay,         'World Whisky Day',      'A global celebration of Scotch and world whiskies — 3rd Saturday of May.'],
    [computeWorldGinDay,            'World Gin Day',         'Celebrate gin with cocktail specials and distillery features — 2nd Saturday of June.'],
    [computeNationalFishAndChipDay, 'National Fish & Chip Day', 'Celebrate the great British classic — 1st Friday of June.'],
    [computeInternationalBeerDay,   'International Beer Day',   'A global celebration of beer — 1st Friday of August.'],
    [computeNationalBurgerDay,      'National Burger Day',   'National Burger Day — last Thursday of August.'],
    [computeNationalCurryWeek,      'National Curry Week',   'Celebrate the UK\'s love of curry with themed menus and events — 2nd week of October.'],
  ];

  for (let year = startYear; year <= endYear; year++) {
    for (const [compute, name, description] of FLOATING_OCCASIONS) {
      const date = compute(year);
      const dateStr = toIsoDateString(date);
      if (dateStr >= windowStartStr && dateStr <= windowEndStr) {
        items.push({ eventName: name, eventDate: dateStr, category: 'floating', description, source: 'computed' });
      }
    }
  }

  // Also include fixed seasonal dates combined with floating
  const fixed = getFixedSeasonalDates(windowStart, windowEnd);
  items.push(...fixed);

  // Sort by date
  items.sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  return items;
}
