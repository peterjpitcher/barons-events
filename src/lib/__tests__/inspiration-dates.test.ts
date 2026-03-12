import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

// inspiration-dates.ts uses `import "server-only"` — mock it so Vitest can import the module
vi.mock('server-only', () => ({}));

import {
  computeEasterSunday,
  computeMothersDayUK,
  computeFathersDay,
  computeWorldWhiskyDay,
  computeWorldGinDay,
  computeNationalFishAndChipDay,
  computeInternationalBeerDay,
  computeNationalBurgerDay,
  computeNationalCurryWeek,
  getFixedSeasonalDates,
  getComputedDates,
} from '@/lib/planning/inspiration-dates';

describe('computeEasterSunday', () => {
  it('returns Easter Sunday 2024 (31 March)', () => {
    const easter = computeEasterSunday(2024);
    expect(easter.getFullYear()).toBe(2024);
    expect(easter.getMonth()).toBe(2); // 0-indexed March
    expect(easter.getDate()).toBe(31);
  });

  it('returns Easter Sunday 2025 (20 April)', () => {
    const easter = computeEasterSunday(2025);
    expect(easter.getFullYear()).toBe(2025);
    expect(easter.getMonth()).toBe(3); // 0-indexed April
    expect(easter.getDate()).toBe(20);
  });

  it('returns Easter Sunday 2026 (5 April)', () => {
    const easter = computeEasterSunday(2026);
    expect(easter.getFullYear()).toBe(2026);
    expect(easter.getMonth()).toBe(3); // 0-indexed April
    expect(easter.getDate()).toBe(5);
  });

  it('always returns a Sunday', () => {
    for (const year of [2024, 2025, 2026, 2027, 2028]) {
      expect(computeEasterSunday(year).getDay()).toBe(0); // 0 = Sunday
    }
  });
});

describe('computeMothersDayUK', () => {
  it('returns Mothering Sunday 2024 (10 March — 21 days before Easter 31 Mar)', () => {
    const md = computeMothersDayUK(2024);
    expect(md.getFullYear()).toBe(2024);
    expect(md.getMonth()).toBe(2); // March
    expect(md.getDate()).toBe(10);
  });

  it('returns Mothering Sunday 2025 (30 March — 21 days before Easter 20 Apr)', () => {
    const md = computeMothersDayUK(2025);
    expect(md.getFullYear()).toBe(2025);
    expect(md.getMonth()).toBe(2); // March
    expect(md.getDate()).toBe(30);
  });

  it('always returns a Sunday', () => {
    for (const year of [2024, 2025, 2026]) {
      expect(computeMothersDayUK(year).getDay()).toBe(0);
    }
  });
});

describe('computeFathersDay', () => {
  it("returns Father's Day 2024 (16 June — 3rd Sunday of June)", () => {
    const fd = computeFathersDay(2024);
    expect(fd.getFullYear()).toBe(2024);
    expect(fd.getMonth()).toBe(5); // June (0-indexed)
    expect(fd.getDate()).toBe(16);
  });

  it("returns Father's Day 2025 (15 June)", () => {
    const fd = computeFathersDay(2025);
    expect(fd.getFullYear()).toBe(2025);
    expect(fd.getMonth()).toBe(5);
    expect(fd.getDate()).toBe(15);
  });

  it('always returns a Sunday', () => {
    for (const year of [2024, 2025, 2026]) {
      expect(computeFathersDay(year).getDay()).toBe(0);
    }
  });
});

describe('computeWorldWhiskyDay', () => {
  it('returns the 3rd Saturday of May 2024 (18 May)', () => {
    const d = computeWorldWhiskyDay(2024);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(4); // May
    expect(d.getDate()).toBe(18);
    expect(d.getDay()).toBe(6); // Saturday
  });

  it('returns the 3rd Saturday of May 2025 (17 May)', () => {
    const d = computeWorldWhiskyDay(2025);
    expect(d.getDate()).toBe(17);
    expect(d.getDay()).toBe(6);
  });

  it('always returns a Saturday', () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      expect(computeWorldWhiskyDay(year).getDay()).toBe(6);
    }
  });
});

describe('computeWorldGinDay', () => {
  it('returns the 2nd Saturday of June 2024 (8 Jun)', () => {
    const d = computeWorldGinDay(2024);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(5); // June
    expect(d.getDate()).toBe(8);
    expect(d.getDay()).toBe(6); // Saturday
  });

  it('always returns a Saturday in June', () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      const d = computeWorldGinDay(year);
      expect(d.getDay()).toBe(6);
      expect(d.getMonth()).toBe(5);
    }
  });
});

describe('computeNationalFishAndChipDay', () => {
  it('returns the 1st Friday of June 2024 (7 Jun)', () => {
    const d = computeNationalFishAndChipDay(2024);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(5); // June
    expect(d.getDate()).toBe(7);
    expect(d.getDay()).toBe(5); // Friday
  });

  it('always returns a Friday in June', () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      const d = computeNationalFishAndChipDay(year);
      expect(d.getDay()).toBe(5);
      expect(d.getMonth()).toBe(5);
    }
  });
});

describe('computeInternationalBeerDay', () => {
  it('returns the 1st Friday of August 2024 (2 Aug)', () => {
    const d = computeInternationalBeerDay(2024);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(7); // August
    expect(d.getDate()).toBe(2);
    expect(d.getDay()).toBe(5); // Friday
  });

  it('always returns a Friday in August', () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      const d = computeInternationalBeerDay(year);
      expect(d.getDay()).toBe(5);
      expect(d.getMonth()).toBe(7);
    }
  });
});

describe('computeNationalBurgerDay', () => {
  it('returns the last Thursday of August 2024 (29 Aug)', () => {
    const d = computeNationalBurgerDay(2024);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(7); // August
    expect(d.getDate()).toBe(29);
    expect(d.getDay()).toBe(4); // Thursday
  });

  it('always returns a Thursday in August', () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      const d = computeNationalBurgerDay(year);
      expect(d.getDay()).toBe(4);
      expect(d.getMonth()).toBe(7);
    }
  });
});

describe('computeNationalCurryWeek', () => {
  it('returns the 2nd Monday of October 2024 (14 Oct)', () => {
    const d = computeNationalCurryWeek(2024);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(9); // October
    expect(d.getDate()).toBe(14);
    expect(d.getDay()).toBe(1); // Monday
  });

  it('always returns a Monday in October', () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      const d = computeNationalCurryWeek(year);
      expect(d.getDay()).toBe(1);
      expect(d.getMonth()).toBe(9);
    }
  });
});

describe('getFixedSeasonalDates', () => {
  it("returns Valentine's Day for a year in the window", () => {
    const items = getFixedSeasonalDates(
      new Date('2026-01-01'),
      new Date('2026-12-31')
    );
    const valentines = items.find(i => i.eventName === "Valentine's Day");
    expect(valentines).toBeDefined();
    expect(valentines!.eventDate).toBe('2026-02-14');
    expect(valentines!.category).toBe('seasonal');
    expect(valentines!.source).toBe('computed');
  });

  it('returns Bonfire Night', () => {
    const items = getFixedSeasonalDates(
      new Date('2026-01-01'),
      new Date('2026-12-31')
    );
    const bonfire = items.find(i => i.eventName === 'Bonfire Night');
    expect(bonfire).toBeDefined();
    expect(bonfire!.eventDate).toBe('2026-11-05');
  });

  it('does not return dates outside the window', () => {
    const items = getFixedSeasonalDates(
      new Date('2026-03-01'),
      new Date('2026-06-30')
    );
    expect(items.every(i => i.eventDate >= '2026-03-01' && i.eventDate <= '2026-06-30')).toBe(true);
  });

  it('returns hospitality occasions (Gin Day excluded — it is floating)', () => {
    const items = getFixedSeasonalDates(new Date('2026-01-01'), new Date('2026-12-31'));
    expect(items.some(i => i.eventName === 'National Beer Day')).toBe(true);
    expect(items.some(i => i.eventName === 'World Rum Day')).toBe(true);
    expect(items.some(i => i.eventName === 'National Prosecco Day')).toBe(true);
    expect(items.some(i => i.eventName === 'World Coffee Day')).toBe(true);
    expect(items.some(i => i.eventName === 'British Pie Week')).toBe(true);
  });
});

describe('getComputedDates', () => {
  it("includes Mother's Day and Father's Day in a full year window", () => {
    const items = getComputedDates(
      new Date('2026-01-01'),
      new Date('2026-12-31')
    );
    expect(items.some(i => i.eventName === "Mother's Day")).toBe(true);
    expect(items.some(i => i.eventName === "Father's Day")).toBe(true);
  });

  it('all items have source = computed', () => {
    const items = getComputedDates(new Date('2026-01-01'), new Date('2026-12-31'));
    expect(items.every(i => i.source === 'computed')).toBe(true);
  });

  it('does not return items outside the window', () => {
    const items = getComputedDates(new Date('2026-04-01'), new Date('2026-06-30'));
    expect(items.every(i => i.eventDate >= '2026-04-01' && i.eventDate <= '2026-06-30')).toBe(true);
  });

  it("finds Mother's Day from the second year in a cross-year window", () => {
    // Oct 2025 – Mar 2026: Mother's Day 2026 (15 Mar 2026) should be included
    const items = getComputedDates(
      new Date('2025-10-01'),
      new Date('2026-03-31')
    );
    const mothersDay = items.find(i => i.eventName === "Mother's Day");
    expect(mothersDay).toBeDefined();
    expect(mothersDay!.eventDate).toBe('2026-03-15'); // Easter 2026 is 5 Apr; 21 days before = 15 Mar
    // Should not include Mother's Day 2025 (30 Mar 2025) which is outside the window
    const allMothersDays = items.filter(i => i.eventName === "Mother's Day");
    expect(allMothersDays).toHaveLength(1);
  });

  it('returns both seasonal and floating categories', () => {
    const items = getComputedDates(new Date('2026-01-01'), new Date('2026-12-31'));
    const categories = new Set(items.map(i => i.category));
    expect(categories.has('seasonal')).toBe(true);
    expect(categories.has('floating')).toBe(true);
  });

  it('includes floating hospitality occasions in a full-year window', () => {
    const items = getComputedDates(new Date('2026-01-01'), new Date('2026-12-31'));
    expect(items.some(i => i.eventName === 'World Gin Day')).toBe(true);
    expect(items.some(i => i.eventName === 'World Whisky Day')).toBe(true);
    expect(items.some(i => i.eventName === 'National Fish & Chip Day')).toBe(true);
    expect(items.some(i => i.eventName === 'International Beer Day')).toBe(true);
    expect(items.some(i => i.eventName === 'National Burger Day')).toBe(true);
    expect(items.some(i => i.eventName === 'National Curry Week')).toBe(true);
  });
});
