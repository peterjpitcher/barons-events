import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

// inspiration-dates.ts uses `import "server-only"` — mock it so Vitest can import the module
vi.mock('server-only', () => ({}));

import {
  computeEasterSunday,
  computeMothersDayUK,
  computeFathersDay,
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
});
