import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseActionClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/planning/inspiration', () => ({ generateInspirationItems: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/roles', () => ({
  canCreatePlanningItems: vi.fn((role: string) => role === 'administrator' || role === 'office_worker'),
  canViewPlanning: vi.fn(() => true),
}));
vi.mock('@/lib/planning/sop', () => ({
  generateSopChecklist: vi.fn(),
  recalculateSopDates: vi.fn(),
  updateBlockedStatus: vi.fn(),
}));
// Also mock planning module to prevent its internals from running
vi.mock('@/lib/planning', () => ({
  createPlanningItem: vi.fn(),
  createPlanningSeries: vi.fn(),
  createPlanningTask: vi.fn(),
  deletePlanningItem: vi.fn(),
  deletePlanningTask: vi.fn(),
  movePlanningItemDate: vi.fn(),
  pausePlanningSeries: vi.fn(),
  updatePlanningItem: vi.fn(),
  updatePlanningSeries: vi.fn(),
  updatePlanningTask: vi.fn(),
}));
vi.mock('@/lib/env', () => ({
  getEnv: vi.fn().mockReturnValue({
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
  }),
}));

import { convertInspirationItemAction, dismissInspirationItemAction, refreshInspirationItemsAction } from '@/actions/planning';
import { createSupabaseActionClient } from '@/lib/supabase/server';
import { generateInspirationItems } from '@/lib/planning/inspiration';
import { getCurrentUser } from '@/lib/auth';

function makeUser(role: string) {
  return { id: 'user-123', role };
}

function makeChainableDb() {
  // Mock for .insert().select().single() chain (planning_items insert)
  const mockInsertSingle = vi.fn().mockResolvedValue({
    data: { id: 'new-item-1', target_date: '2026-04-03' },
    error: null,
  });
  const mockInsertSelect = vi.fn().mockReturnValue({ single: mockInsertSingle });
  const mockInsert = vi.fn().mockReturnValue({
    select: mockInsertSelect,
  });
  // For inserts that don't chain .select() (dismissals), also resolve directly
  mockInsert.mockImplementation(() => {
    const result = Promise.resolve({ error: null }) as unknown as Record<string, unknown>;
    result.select = mockInsertSelect;
    return result;
  });

  // Mock for .select().eq().single() chain (fetching inspiration item)
  const mockFetchSingle = vi.fn().mockReturnValue({
    data: { id: 'item-1', event_name: 'Good Friday', event_date: '2026-04-03', category: 'bank_holiday', description: null, source: 'gov_uk_api' },
    error: null,
  });
  const mockEq = vi.fn().mockReturnValue({ single: mockFetchSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
  });
  return { from: mockFrom, insert: mockInsert, select: mockSelect };
}

describe('convertInspirationItemAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error if user is not authenticated', async () => {
    (getCurrentUser as Mock).mockResolvedValue(null);
    const result = await convertInspirationItemAction('item-1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/signed in/i);
  });

  it('returns error if user role cannot create planning items', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('executive'));
    const result = await convertInspirationItemAction('item-1');
    expect(result.success).toBe(false);
  });

  it('creates planning item and dismissal row for administrator', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('administrator'));
    const db = makeChainableDb();
    (createSupabaseActionClient as Mock).mockResolvedValue(db);

    const result = await convertInspirationItemAction('item-1');

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/added to your plan/i);
    // Three inserts: planning_items, planning_inspiration_dismissals, audit_log
    // (the audit row uses the same mocked action client).
    expect(db.insert).toHaveBeenCalledTimes(3);
  });
});

describe('dismissInspirationItemAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error if not authenticated', async () => {
    (getCurrentUser as Mock).mockResolvedValue(null);
    const result = await dismissInspirationItemAction('item-1');
    expect(result.success).toBe(false);
  });

  it('returns error if user role cannot create planning items', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('executive'));
    const result = await dismissInspirationItemAction('item-1');
    expect(result.success).toBe(false);
  });

  it('inserts dismissal row for authenticated viewer', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('administrator'));
    const db = makeChainableDb();
    (createSupabaseActionClient as Mock).mockResolvedValue(db);

    const result = await dismissInspirationItemAction('item-1');

    expect(result.success).toBe(true);
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({ inspiration_item_id: 'item-1', reason: 'dismissed' })
    );
  });
});

describe('refreshInspirationItemsAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns unauthorised error for non-administrator', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('executive'));
    const result = await refreshInspirationItemsAction();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/unauthorised/i);
  });

  it('calls generateInspirationItems for administrator', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('administrator'));
    (generateInspirationItems as Mock).mockResolvedValue(12);

    const result = await refreshInspirationItemsAction();

    expect(result.success).toBe(true);
    expect(result.message).toContain('12');
    expect(generateInspirationItems).toHaveBeenCalled();
  });
});
