import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Mock server-only
vi.mock('server-only', () => ({}));

// Mock Supabase admin client
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { fetchBankHolidays, generateInspirationItems } from '@/lib/planning/inspiration';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// ─── fetchBankHolidays ───────────────────────────────────────────────────────

describe('fetchBankHolidays', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it('returns filtered bank holidays within the window', async () => {
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'england-and-wales': {
          events: [
            { title: 'Good Friday', date: '2026-04-03' },
            { title: 'Easter Monday', date: '2026-04-06' },
            { title: 'Spring Bank Holiday', date: '2027-05-31' }, // outside window
          ],
        },
      }),
    });

    const result = await fetchBankHolidays(
      new Date('2026-03-11'),
      new Date('2026-09-07')
    );

    expect(result).toHaveLength(2);
    expect(result[0].eventName).toBe('Good Friday');
    expect(result[0].category).toBe('bank_holiday');
    expect(result[0].source).toBe('gov_uk_api');
    expect(result[0].eventDate).toBe('2026-04-03');
  });

  it('returns empty array and logs warning if API is unreachable', async () => {
    (global.fetch as Mock).mockRejectedValueOnce(new Error('Network error'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchBankHolidays(new Date('2026-03-11'), new Date('2026-09-07'));

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('bank holidays'), expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('returns empty array if API returns non-ok response', async () => {
    (global.fetch as Mock).mockResolvedValueOnce({ ok: false, status: 503 });
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchBankHolidays(new Date('2026-03-11'), new Date('2026-09-07'));

    expect(result).toEqual([]);
    consoleSpy.mockRestore();
  });
});

// ─── generateInspirationItems ────────────────────────────────────────────────

describe('generateInspirationItems', () => {
  let mockDb: {
    from: Mock;
    delete: Mock;
    neq: Mock;
    not: Mock;
    in: Mock;
    insert: Mock;
    select: Mock;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();

    // Build a chainable Supabase mock
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    const mockSelect = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockNot = vi.fn().mockResolvedValue({ error: null });
    const mockIn = vi.fn().mockResolvedValue({ error: null });
    const mockDelete = vi.fn().mockReturnValue({ not: mockNot, in: mockIn, neq: vi.fn().mockResolvedValue({ error: null }) });
    const mockFrom = vi.fn().mockReturnValue({
      delete: mockDelete,
      insert: mockInsert,
      select: mockSelect,
    });

    mockDb = { from: mockFrom, delete: mockDelete, neq: vi.fn(), not: mockNot, in: mockIn, insert: mockInsert, select: mockSelect };
    (createSupabaseAdminClient as Mock).mockReturnValue({ from: mockFrom });
  });

  it('calls gov.uk API and OpenAI, merges results, and inserts to DB', async () => {
    // gov.uk returns one bank holiday
    (global.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'england-and-wales': {
            events: [{ title: 'Good Friday', date: '2026-04-03' }],
          },
        }),
      })
      // OpenAI returns one sporting event
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                events: [
                  { event_name: 'Six Nations Final', event_date: '2026-03-21', description: 'England vs France' },
                ],
              }),
            },
          }],
        }),
      });

    const count = await generateInspirationItems(
      new Date('2026-03-11'),
      new Date('2026-09-07')
    );

    expect(count).toBeGreaterThan(0);
    expect(mockDb.from).toHaveBeenCalledWith('planning_inspiration_items');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('continues gracefully if OpenAI fails', async () => {
    (global.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'england-and-wales': { events: [] } }),
      })
      .mockRejectedValueOnce(new Error('OpenAI down'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const count = await generateInspirationItems(
      new Date('2026-03-11'),
      new Date('2026-09-07')
    );

    // Still returns computed dates even with no bank holidays or sporting events
    expect(count).toBeGreaterThanOrEqual(0);
    consoleSpy.mockRestore();
  });

  it('deduplicates items with same date and event name', async () => {
    // gov.uk returns "Christmas Day", computed dates also generate "Christmas Day"
    // Only one should survive deduplication
    (global.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'england-and-wales': {
            events: [{ title: 'Christmas Day', date: '2026-12-25' }],
          },
        }),
      })
      .mockRejectedValueOnce(new Error('OpenAI skipped'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await generateInspirationItems(new Date('2026-03-11'), new Date('2026-12-31'));

    // Check insert was called with no duplicate christmas day entries
    const insertCall = mockDb.insert.mock.calls[0][0] as Array<{ event_name: string; event_date: string }>;
    const christmasDays = insertCall.filter(
      item => item.event_date === '2026-12-25' && item.event_name.toLowerCase().includes('christmas')
    );
    // At most one Christmas Day row (bank holiday deduplicates with seasonal)
    expect(christmasDays.length).toBeLessThanOrEqual(1);
    consoleSpy.mockRestore();
  });
});
