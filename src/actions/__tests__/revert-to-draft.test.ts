import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Must mock these BEFORE importing the action (hoisted by Vitest)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const redirectError = new Error('NEXT_REDIRECT');
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw redirectError; }) }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseActionClient: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({ recordAuditLogEntry: vi.fn() }));
vi.mock('@/lib/roles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/roles')>();
  return { ...actual };
});

import { revertToDraftAction } from '@/actions/events';
import { createSupabaseActionClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth';
import { recordAuditLogEntry } from '@/lib/audit-log';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(role = 'administrator') {
  return { id: 'user-abc', role };
}

/** Builds a minimal chainable Supabase mock for event fetch + update */
function makeDb(eventRow: Record<string, unknown> | null, updateError: unknown = null) {
  const mockSingle = vi.fn().mockResolvedValue({ data: eventRow, error: eventRow ? null : { message: 'not found' } });
  const mockEqSelect = vi.fn().mockReturnValue({ single: mockSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEqSelect });

  const mockEqUpdate = vi.fn().mockResolvedValue({ error: updateError });
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEqUpdate });

  const mockFrom = vi.fn((table: string) => {
    if (table === 'events') {
      return { select: mockSelect, update: mockUpdate };
    }
    return { select: mockSelect, update: mockUpdate };
  });

  return { from: mockFrom, update: mockUpdate, _mockSingle: mockSingle, _mockEqUpdate: mockEqUpdate };
}

function makeFormData(eventId: string) {
  const fd = new FormData();
  fd.set('eventId', eventId);
  return fd;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('revertToDraftAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirects to /login when user is not authenticated', async () => {
    (getCurrentUser as Mock).mockResolvedValue(null);
    await expect(revertToDraftAction(undefined, makeFormData('some-id'))).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('returns error when office_worker tries to revert', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('office_worker'));
    const result = await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/administrator/i);
  });

  it('returns error when executive tries to revert', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('executive'));
    const result = await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/administrator/i);
  });

  it('returns error for invalid (non-UUID) event ID', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const result = await revertToDraftAction(undefined, makeFormData('not-a-uuid'));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invalid event reference/i);
  });

  it('returns error when event is not found', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb(null);
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    const result = await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/event not found/i);
  });

  it('returns error when event is not approved', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb({ id: '00000000-0000-0000-0000-000000000001', status: 'submitted' });
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    const result = await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not currently approved/i);
  });

  it('sets status to draft and clears assignee for an approved event', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb({ id: '00000000-0000-0000-0000-000000000001', status: 'approved' });
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    const result = await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(result.success).toBe(true);
    expect(db.from).toHaveBeenCalledWith('events');
    expect(db._mockEqUpdate).toHaveBeenCalledWith('id', '00000000-0000-0000-0000-000000000001');
    // Verify the update payload includes status: 'draft' and assignee_id: null
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft', assignee_id: null })
    );
  });

  it('writes an audit log entry with correct schema', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb({ id: '00000000-0000-0000-0000-000000000001', status: 'approved' });
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(recordAuditLogEntry).toHaveBeenCalledWith({
      entity: 'event',
      entityId: '00000000-0000-0000-0000-000000000001',
      action: 'event.status_changed',
      actorId: 'user-abc',
      meta: expect.objectContaining({
        status: 'draft',
        previousStatus: 'approved',
      }),
    });
  });

  it('revalidates events, event detail, and reviews paths', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb({ id: '00000000-0000-0000-0000-000000000001', status: 'approved' });
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(revalidatePath).toHaveBeenCalledWith('/events/00000000-0000-0000-0000-000000000001');
    expect(revalidatePath).toHaveBeenCalledWith('/events');
    expect(revalidatePath).toHaveBeenCalledWith('/reviews');
  });

  it('returns error when database update fails', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb(
      { id: '00000000-0000-0000-0000-000000000001', status: 'approved' },
      { message: 'db error' }
    );
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    const result = await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(result.success).toBe(false);
  });
});
