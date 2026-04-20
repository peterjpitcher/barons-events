# Review Pack: office-worker-impl-codereview

**Generated:** 2026-04-20
**Mode:** B (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub`
**Base ref:** `b72820e`
**HEAD:** `1672d6b`
**Diff range:** `b72820e...HEAD`
**Stats:**  18 files changed, 1769 insertions(+), 141 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
src/actions/__tests__/events-edit-rbac.test.ts
src/actions/__tests__/pre-event.test.ts
src/actions/events.ts
src/actions/pre-event.ts
src/app/events/[eventId]/page.tsx
src/app/events/new/page.tsx
src/app/events/propose/page.tsx
src/components/events/event-form.tsx
src/components/events/propose-event-form.tsx
src/lib/auth/__tests__/rbac.test.ts
src/lib/events/__tests__/edit-context.test.ts
src/lib/events/edit-context.ts
src/lib/roles.ts
supabase/migrations/20260420170000_office_worker_event_scope.sql
supabase/migrations/20260420170500_propose_any_venue.sql
supabase/migrations/20260420171000_reject_event_proposal_rpc.sql
supabase/migrations/__tests__/office_worker_event_scope.test.ts
tasks/implement-plan/2026-04-20-office-worker-propose-edit/wave-1/M1/handoff.md
```

## User Concerns

Mode B code review of the implementation of the office-worker propose/edit scope feature. Spec at docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md v3.2. Verify: (a) canEditEvent helper enforces role-before-creator + soft-delete + status allowlist ('approved'|'cancelled') for office_worker branch; (b) loadEventEditContext uses admin client and logs errors; (c) proposeEventAction overwrites created_by from the authenticated user (SEC-001 critical fix); (d) all 6 canManageEvents call-sites in src/actions/events.ts migrated with correct classification (create→canProposeEvents, update→canEditEvent); (e) top-level office_worker-no-venue guard and cross-venue rejection removed in saveEventDraftAction and submitEventForReviewAction; (f) RLS migration includes needs_revisions NOT in non-admin trigger allowlist, event_artists creator branch excludes pending_approval, proposal RPC drops OW venue restrictions + adds venue validation + re-entrant idempotency, reject_event_proposal RPC validates p_admin_id. Flag any deviation between spec and code.

## Diff (`b72820e...HEAD`)

```diff
diff --git a/src/actions/__tests__/events-edit-rbac.test.ts b/src/actions/__tests__/events-edit-rbac.test.ts
new file mode 100644
index 0000000..0541098
--- /dev/null
+++ b/src/actions/__tests__/events-edit-rbac.test.ts
@@ -0,0 +1,404 @@
+import { describe, it, expect, vi, beforeEach } from "vitest";
+import type { Mock } from "vitest";
+
+// Hoisted mocks
+const mocks = vi.hoisted(() => ({
+  getUserMock: vi.fn(),
+  loadCtxMock: vi.fn(),
+}));
+
+vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
+const redirectError = new Error("NEXT_REDIRECT");
+vi.mock("next/navigation", () => ({
+  redirect: vi.fn(() => { throw redirectError; }),
+}));
+vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getUserMock }));
+vi.mock("@/lib/events/edit-context", () => ({
+  loadEventEditContext: mocks.loadCtxMock,
+  canEditEventFromRow: vi.fn(),
+}));
+// Stub modules so the action import doesn't crash. Supabase/admin/server
+// clients are not used in the permission-guard paths we exercise, so
+// vi.fn() returning nothing is enough.
+vi.mock("@/lib/supabase/server", () => ({ createSupabaseActionClient: vi.fn() }));
+vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
+vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: vi.fn() }));
+vi.mock("@/lib/events", () => ({
+  appendEventVersion: vi.fn(),
+  createEventDraft: vi.fn(),
+  createEventPlanningItem: vi.fn(),
+  recordApproval: vi.fn(),
+  softDeleteEvent: vi.fn(),
+  updateEventDraft: vi.fn(),
+  updateEventAssignee: vi.fn(),
+}));
+vi.mock("@/lib/bookings", () => ({ generateUniqueEventSlug: vi.fn() }));
+vi.mock("@/lib/artists", () => ({
+  cleanupOrphanArtists: vi.fn(),
+  parseArtistNames: vi.fn(() => []),
+  syncEventArtists: vi.fn(),
+}));
+vi.mock("@/lib/notifications", () => ({
+  sendAssigneeReassignmentEmail: vi.fn(),
+  sendEventSubmittedEmail: vi.fn(),
+  sendReviewDecisionEmail: vi.fn(),
+}));
+vi.mock("@/lib/ai", () => ({
+  generateTermsAndConditions: vi.fn(),
+  generateWebsiteCopy: vi.fn(),
+}));
+
+import {
+  saveEventDraftAction,
+  submitEventForReviewAction,
+  deleteEventAction,
+  generateWebsiteCopyFromFormAction,
+  updateBookingSettingsAction,
+} from "../events";
+import { loadEventEditContext } from "@/lib/events/edit-context";
+
+const { getUserMock, loadCtxMock } = mocks;
+
+// Valid UUID v4s for tests
+const EVENT_ID = "550e8400-e29b-41d4-a716-446655440000";
+const VENUE_A = "550e8400-e29b-41d4-a716-446655440001";
+const VENUE_B = "550e8400-e29b-41d4-a716-446655440002";
+const USER_A = "550e8400-e29b-41d4-a716-44665544aaaa";
+const USER_B = "550e8400-e29b-41d4-a716-44665544bbbb";
+
+function formData(fields: Record<string, string | string[]>): FormData {
+  const f = new FormData();
+  for (const [k, v] of Object.entries(fields)) {
+    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
+    else f.set(k, v);
+  }
+  return f;
+}
+
+// ─── saveEventDraftAction / submitEventForReviewAction — create path (any venue) ─────────
+
+describe("submitEventForReviewAction — create path (any venue)", () => {
+  beforeEach(() => vi.clearAllMocks());
+
+  it("office_worker with no venueId is permitted by capability (no pinning)", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: null });
+    // No event context needed for create-path capability check; we expect
+    // the action to proceed past the guard. The downstream path will fail
+    // for other reasons (e.g. missing required fields), but the first
+    // message must NOT be the permission rejection.
+    const result = await submitEventForReviewAction(undefined, formData({
+      venueIds: VENUE_A,
+      title: "T",
+      startAt: "2026-05-01T10:00:00Z",
+    }));
+    // The guard is satisfied — we must not see the legacy venue-not-linked
+    // or venue-mismatch rejection strings anywhere.
+    expect(result.message ?? "").not.toMatch(/not linked to a venue/i);
+    expect(result.message ?? "").not.toMatch(/own venue|venue mismatch/i);
+    expect(result.message ?? "").not.toMatch(/don't have permission/i);
+  });
+
+  it("office_worker can create for a venue different from their linked venueId", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
+    const result = await submitEventForReviewAction(undefined, formData({
+      venueIds: VENUE_B,
+      title: "T",
+      startAt: "2026-05-01T10:00:00Z",
+    }));
+    // Cross-venue is now allowed — the legacy "Venue mismatch"/"can only
+    // submit events for their linked venue" must NOT fire.
+    expect(result.message ?? "").not.toMatch(/can only submit/i);
+    expect(result.message ?? "").not.toMatch(/venue mismatch/i);
+    expect(result.message ?? "").not.toMatch(/don't have permission/i);
+  });
+
+  it("executive is rejected for create", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
+    const result = await submitEventForReviewAction(undefined, formData({
+      venueIds: VENUE_A,
+      title: "T",
+      startAt: "2026-05-01T10:00:00Z",
+    }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/don't have permission/i);
+  });
+});
+
+describe("saveEventDraftAction — create path (any venue)", () => {
+  beforeEach(() => vi.clearAllMocks());
+
+  it("office_worker with no venueId is permitted by capability (no pinning)", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: null });
+    const result = await saveEventDraftAction(undefined, formData({
+      venueIds: VENUE_A,
+      title: "T",
+      startAt: "2026-05-01T10:00:00Z",
+    }));
+    expect(result.message ?? "").not.toMatch(/not linked to a venue/i);
+    expect(result.message ?? "").not.toMatch(/own venue|venue mismatch/i);
+    expect(result.message ?? "").not.toMatch(/don't have permission/i);
+  });
+
+  it("office_worker can save draft for a venue different from their linked venueId", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
+    const result = await saveEventDraftAction(undefined, formData({
+      venueIds: VENUE_B,
+      title: "T",
+      startAt: "2026-05-01T10:00:00Z",
+    }));
+    expect(result.message ?? "").not.toMatch(/can only save/i);
+    expect(result.message ?? "").not.toMatch(/venue mismatch/i);
+    expect(result.message ?? "").not.toMatch(/don't have permission/i);
+  });
+
+  it("executive is rejected for create", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
+    const result = await saveEventDraftAction(undefined, formData({
+      venueIds: VENUE_A,
+      title: "T",
+      startAt: "2026-05-01T10:00:00Z",
+    }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/don't have permission/i);
+  });
+});
+
+// ─── update-path via canEditEvent ───────────────────────────────────────────────
+
+describe("saveEventDraftAction — update path (canEditEvent)", () => {
+  beforeEach(() => vi.clearAllMocks());
+
+  it("manager_responsible office_worker at own venue on approved event passes guard", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
+    loadCtxMock.mockResolvedValue({
+      venueId: VENUE_A,
+      managerResponsibleId: USER_A,
+      createdBy: USER_B,
+      status: "approved",
+      deletedAt: null,
+    });
+
+    const result = await saveEventDraftAction(undefined, formData({
+      eventId: EVENT_ID,
+      venueIds: VENUE_A,
+      title: "T",
+      startAt: "2026-05-01T10:00:00Z",
+    }));
+    // Permission guard passed; later logic may fail but NOT with the
+    // permission rejection message.
+    expect(result.message ?? "").not.toMatch(/don't have permission to edit/i);
+  });
+
+  it("office_worker at right venue but not manager_responsible is rejected", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
+    loadCtxMock.mockResolvedValue({
+      venueId: VENUE_A,
+      managerResponsibleId: USER_B,
+      createdBy: USER_B,
+      status: "approved",
+      deletedAt: null,
+    });
+
+    const result = await saveEventDraftAction(undefined, formData({
+      eventId: EVENT_ID,
+    }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/don't have permission to edit/i);
+  });
+
+  it("soft-deleted event allows administrator to pass guard", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });
+    loadCtxMock.mockResolvedValue({
+      venueId: VENUE_A,
+      managerResponsibleId: null,
+      createdBy: USER_B,
+      status: "approved",
+      deletedAt: "2026-04-01T00:00:00Z",
+    });
+
+    const result = await saveEventDraftAction(undefined, formData({
+      eventId: EVENT_ID,
+    }));
+    // Admin can restore a soft-deleted event, so the permission guard
+    // passes. Subsequent validation/field errors are expected.
+    expect(result.message ?? "").not.toMatch(/don't have permission to edit/i);
+  });
+
+  it("missing event (loadCtx returns null) yields Event not found", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
+    loadCtxMock.mockResolvedValue(null);
+
+    const result = await saveEventDraftAction(undefined, formData({
+      eventId: EVENT_ID,
+    }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/event not found/i);
+  });
+});
+
+describe("submitEventForReviewAction — update path (canEditEvent)", () => {
+  beforeEach(() => vi.clearAllMocks());
+
+  it("office_worker at right venue but not manager_responsible is rejected", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
+    loadCtxMock.mockResolvedValue({
+      venueId: VENUE_A,
+      managerResponsibleId: USER_B,
+      createdBy: USER_B,
+      status: "approved",
+      deletedAt: null,
+    });
+
+    const result = await submitEventForReviewAction(undefined, formData({
+      eventId: EVENT_ID,
+    }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/don't have permission to edit/i);
+  });
+
+  it("manager_responsible office_worker at own venue passes guard", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
+    loadCtxMock.mockResolvedValue({
+      venueId: VENUE_A,
+      managerResponsibleId: USER_A,
+      createdBy: USER_B,
+      status: "approved",
+      deletedAt: null,
+    });
+
+    const result = await submitEventForReviewAction(undefined, formData({
+      eventId: EVENT_ID,
+    }));
+    expect(result.message ?? "").not.toMatch(/don't have permission to edit/i);
+  });
+});
+
+// ─── deleteEventAction ───────────────────────────────────────────────────────
+
+describe("deleteEventAction", () => {
+  beforeEach(() => vi.clearAllMocks());
+
+  it("rejects non-manager OW at same venue", async () => {
+    loadCtxMock.mockResolvedValue({
+      venueId: VENUE_A,
+      managerResponsibleId: USER_B,
+      createdBy: USER_B,
+      status: "approved",
+      deletedAt: null,
+    });
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
+
+    const result = await deleteEventAction(undefined, formData({ eventId: EVENT_ID }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/don't have permission/i);
+  });
+
+  it("rejects executive", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
+    loadCtxMock.mockResolvedValue({
+      venueId: VENUE_A,
+      managerResponsibleId: USER_A,
+      createdBy: USER_A,
+      status: "approved",
+      deletedAt: null,
+    });
+
+    const result = await deleteEventAction(undefined, formData({ eventId: EVENT_ID }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/don't have permission/i);
+  });
+
+  it("missing event returns 'Event not found'", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });
+    loadCtxMock.mockResolvedValue(null);
+
+    const result = await deleteEventAction(undefined, formData({ eventId: EVENT_ID }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/event not found/i);
+  });
+});
+
+// ─── generateWebsiteCopyFromFormAction ───────────────────────────────────────
+
+describe("generateWebsiteCopyFromFormAction", () => {
+  beforeEach(() => vi.clearAllMocks());
+
+  it("allows office_worker with no venueId (canProposeEvents)", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: null });
+    const result = await generateWebsiteCopyFromFormAction(undefined, formData({
+      title: "T",
+    }));
+    // Permission passes; downstream AI call may fail, but NOT with
+    // "Only administrators or venue managers".
+    expect(result.message ?? "").not.toMatch(/only administrators or venue managers/i);
+  });
+
+  it("rejects executive", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
+    const result = await generateWebsiteCopyFromFormAction(undefined, formData({
+      title: "T",
+    }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/permission|administrators|venue managers/i);
+  });
+});
+
+// ─── updateBookingSettingsAction ─────────────────────────────────────────────
+
+describe("updateBookingSettingsAction", () => {
+  beforeEach(() => vi.clearAllMocks());
+
+  it("rejects non-manager OW at same venue", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
+    loadCtxMock.mockResolvedValue({
+      venueId: VENUE_A,
+      managerResponsibleId: USER_B,
+      createdBy: USER_B,
+      status: "approved",
+      deletedAt: null,
+    });
+
+    const result = await updateBookingSettingsAction({
+      eventId: EVENT_ID,
+      bookingEnabled: true,
+      totalCapacity: 100,
+      maxTicketsPerBooking: 5,
+    });
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/don't have permission/i);
+  });
+
+  it("rejects executive", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
+    loadCtxMock.mockResolvedValue({
+      venueId: VENUE_A,
+      managerResponsibleId: USER_A,
+      createdBy: USER_A,
+      status: "approved",
+      deletedAt: null,
+    });
+
+    const result = await updateBookingSettingsAction({
+      eventId: EVENT_ID,
+      bookingEnabled: true,
+      totalCapacity: 100,
+      maxTicketsPerBooking: 5,
+    });
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/don't have permission/i);
+  });
+
+  it("missing event returns 'Event not found'", async () => {
+    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });
+    loadCtxMock.mockResolvedValue(null);
+
+    const result = await updateBookingSettingsAction({
+      eventId: EVENT_ID,
+      bookingEnabled: true,
+      totalCapacity: 100,
+      maxTicketsPerBooking: 5,
+    });
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/event not found/i);
+  });
+});
diff --git a/src/actions/__tests__/pre-event.test.ts b/src/actions/__tests__/pre-event.test.ts
new file mode 100644
index 0000000..253c1a4
--- /dev/null
+++ b/src/actions/__tests__/pre-event.test.ts
@@ -0,0 +1,120 @@
+import { describe, it, expect, vi, beforeEach } from "vitest";
+
+// Mocks hoisted by Vitest — use vi.hoisted() for shared state so the
+// factory closures can reference them safely during hoisting.
+const mocks = vi.hoisted(() => ({
+  rpcMock: vi.fn(),
+  selectInMock: vi.fn(),
+  getUserMock: vi.fn(),
+}));
+
+vi.mock("@/lib/supabase/admin", () => ({
+  createSupabaseAdminClient: () => ({ rpc: mocks.rpcMock }),
+}));
+vi.mock("@/lib/supabase/server", () => ({
+  createSupabaseActionClient: () => ({
+    from: () => ({
+      select: () => ({
+        in: () => ({ is: mocks.selectInMock }),
+      }),
+    }),
+  }),
+}));
+vi.mock("@/lib/auth", () => ({
+  getCurrentUser: mocks.getUserMock,
+}));
+vi.mock("next/cache", () => ({
+  revalidatePath: vi.fn(),
+}));
+
+import { proposeEventAction } from "../pre-event";
+
+const { rpcMock, selectInMock, getUserMock } = mocks;
+
+// Use valid UUID v4 strings — Zod's `.uuid()` enforces strict RFC 4122.
+const VENUE_A = "550e8400-e29b-41d4-a716-446655440000";
+const VENUE_B = "550e8400-e29b-41d4-a716-446655440001";
+
+function fd(fields: Record<string, string | string[]>): FormData {
+  const f = new FormData();
+  for (const [k, v] of Object.entries(fields)) {
+    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
+    else f.set(k, v);
+  }
+  return f;
+}
+
+describe("proposeEventAction", () => {
+  beforeEach(() => vi.clearAllMocks());
+
+  it("rejects executive", async () => {
+    getUserMock.mockResolvedValue({ id: "exec-1", role: "executive", venueId: null });
+    const result = await proposeEventAction(undefined, fd({
+      title: "x",
+      startAt: "2026-05-01T10:00:00Z",
+      notes: "x",
+      venueIds: VENUE_A,
+    }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/permission/i);
+    expect(rpcMock).not.toHaveBeenCalled();
+  });
+
+  it("overwrites client-supplied created_by with authenticated user id", async () => {
+    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
+    selectInMock.mockResolvedValue({
+      data: [{ id: VENUE_A }],
+      error: null,
+    });
+    rpcMock.mockResolvedValue({ data: { event_id: "e1" }, error: null });
+
+    await proposeEventAction(undefined, fd({
+      title: "Test",
+      startAt: "2026-05-01T10:00:00Z",
+      notes: "Test",
+      venueIds: VENUE_A,
+      // Malicious payload ignored:
+      created_by: "other-user-id",
+    }));
+
+    expect(rpcMock).toHaveBeenCalledWith(
+      "create_multi_venue_event_proposals",
+      expect.objectContaining({
+        p_payload: expect.objectContaining({ created_by: "ow-1" }),
+      }),
+    );
+  });
+
+  it("returns retryable error when venue query fails", async () => {
+    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
+    selectInMock.mockResolvedValue({ data: null, error: { message: "DB down" } });
+
+    const result = await proposeEventAction(undefined, fd({
+      title: "x",
+      startAt: "2026-05-01T10:00:00Z",
+      notes: "x",
+      venueIds: VENUE_A,
+    }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/try again/i);
+    expect(rpcMock).not.toHaveBeenCalled();
+  });
+
+  it("rejects when a venue id is not in active list", async () => {
+    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
+    selectInMock.mockResolvedValue({
+      data: [{ id: VENUE_A }],
+      error: null,
+    });
+
+    const result = await proposeEventAction(undefined, fd({
+      title: "x",
+      startAt: "2026-05-01T10:00:00Z",
+      notes: "x",
+      venueIds: [VENUE_A, VENUE_B],
+    }));
+    expect(result.success).toBe(false);
+    expect(result.message).toMatch(/not available/i);
+    expect(rpcMock).not.toHaveBeenCalled();
+  });
+});
diff --git a/src/actions/events.ts b/src/actions/events.ts
index 143d4a1..21bc2fd 100644
--- a/src/actions/events.ts
+++ b/src/actions/events.ts
@@ -6,7 +6,8 @@ import { z } from "zod";
 import { createSupabaseActionClient } from "@/lib/supabase/server";
 import { createSupabaseAdminClient } from "@/lib/supabase/admin";
 import { getCurrentUser } from "@/lib/auth";
-import { canManageEvents, canReviewEvents } from "@/lib/roles";
+import { canReviewEvents, canProposeEvents, canEditEvent } from "@/lib/roles";
+import { loadEventEditContext } from "@/lib/events/edit-context";
 import { appendEventVersion, createEventDraft, createEventPlanningItem, recordApproval, softDeleteEvent, updateEventDraft, updateEventAssignee } from "@/lib/events";
 import { generateUniqueEventSlug } from "@/lib/bookings";
 import { cleanupOrphanArtists, parseArtistNames, syncEventArtists } from "@/lib/artists";
@@ -611,12 +612,30 @@ export async function saveEventDraftAction(_: ActionResult | undefined, formData
   if (!user) {
     redirect("/login");
   }
-  if (!canManageEvents(user.role, user.venueId)) {
-    return { success: false, message: "You don't have permission to save events." };
+
+  const rawEventIdRaw = formData.get("eventId");
+  const rawEventId = typeof rawEventIdRaw === "string" ? rawEventIdRaw.trim() : "";
+  const isCreate = !rawEventId;
+
+  if (isCreate) {
+    if (!canProposeEvents(user.role)) {
+      return { success: false, message: "You don't have permission to create events." };
+    }
+  } else {
+    const parsedId = z.string().uuid().safeParse(rawEventId);
+    if (!parsedId.success) {
+      return { success: false, message: "Missing event reference." };
+    }
+    const ctx = await loadEventEditContext(parsedId.data);
+    if (!ctx) {
+      return { success: false, message: "Event not found." };
+    }
+    if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
+      return { success: false, message: "You don't have permission to edit this event." };
+    }
   }
 
-  const rawEventId = formData.get("eventId");
-  const eventId = typeof rawEventId === "string" ? rawEventId.trim() || undefined : undefined;
+  const eventId = rawEventId || undefined;
 
   // Multi-venue: read the full list of picked venue IDs. Fall back to the
   // legacy single `venueId` field so existing callers keep working.
@@ -628,27 +647,10 @@ export async function saveEventDraftAction(_: ActionResult | undefined, formData
   const requestedVenueIds =
     rawVenueIds.length > 0 ? rawVenueIds : fallbackVenueId ? [fallbackVenueId] : [];
 
-  // Office workers are pinned to their linked venue regardless of UI state.
-  const venueIds = user.role === "office_worker"
-    ? (user.venueId ? [user.venueId] : [])
-    : requestedVenueIds;
+  // Office workers are no longer venue-pinned — capability is enforced via
+  // canProposeEvents (create) / canEditEvent (update) above.
+  const venueIds = requestedVenueIds;
   const venueId = venueIds[0] ?? "";
-
-  if (user.role === "office_worker" && !user.venueId) {
-    return { success: false, message: "Your account is not linked to a venue." };
-  }
-
-  if (
-    user.role === "office_worker" &&
-    requestedVenueIds.length > 0 &&
-    requestedVenueIds.some((id) => id !== user.venueId)
-  ) {
-    return {
-      success: false,
-      message: "Venue managers can only save events for their linked venue.",
-      fieldErrors: { venueId: "Venue mismatch" }
-    };
-  }
   const titleValue = formData.get("title");
   const title = typeof titleValue === "string" ? titleValue : "";
   const eventTypeValue = formData.get("eventType");
@@ -1024,14 +1026,28 @@ export async function submitEventForReviewAction(
   if (!user) {
     redirect("/login");
   }
-  if (!canManageEvents(user.role, user.venueId)) {
-    return { success: false, message: "You don't have permission to submit events." };
-  }
-  if (user.role === "office_worker" && !user.venueId) {
-    return { success: false, message: "Your account is not linked to a venue." };
-  }
 
   const eventId = formData.get("eventId");
+  const rawEventId = typeof eventId === "string" ? eventId.trim() : "";
+
+  if (!rawEventId) {
+    if (!canProposeEvents(user.role)) {
+      return { success: false, message: "You don't have permission to submit events." };
+    }
+  } else {
+    const parsedId = z.string().uuid().safeParse(rawEventId);
+    if (!parsedId.success) {
+      return { success: false, message: "Missing event reference." };
+    }
+    const ctx = await loadEventEditContext(parsedId.data);
+    if (!ctx) {
+      return { success: false, message: "Event not found." };
+    }
+    if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
+      return { success: false, message: "You don't have permission to edit this event." };
+    }
+  }
+
   const assigneeField = formData.get("assigneeId") ?? formData.get("assignedReviewerId") ?? undefined;
   const assigneeOverride = typeof assigneeField === "string" ? assigneeField : undefined;
   const eventImageEntry = formData.get("eventImage");
@@ -1039,7 +1055,6 @@ export async function submitEventForReviewAction(
   const requestedArtistIds = normaliseArtistIdList(formData.get("artistIds"));
   const requestedArtistNames = normaliseArtistNameList(formData.get("artistNames"));
 
-  const rawEventId = typeof eventId === "string" ? eventId.trim() : "";
   let targetEventId: string | null = null;
 
   try {
@@ -1057,24 +1072,12 @@ export async function submitEventForReviewAction(
       const fallbackVenueId = typeof fallbackVenueIdValue === "string" ? fallbackVenueIdValue : "";
       const requestedVenueIds =
         rawVenueIds.length > 0 ? rawVenueIds : fallbackVenueId ? [fallbackVenueId] : [];
-      const venueIds = user.role === "office_worker"
-        ? (user.venueId ? [user.venueId] : [])
-        : requestedVenueIds;
+      // Office workers are no longer venue-pinned — capability was enforced
+      // by canProposeEvents at the top of the action.
+      const venueIds = requestedVenueIds;
       const venueId = venueIds[0] ?? "";
       const requestedVenueId = venueId;
 
-      if (
-        user.role === "office_worker" &&
-        requestedVenueIds.length > 0 &&
-        requestedVenueIds.some((id) => id !== user.venueId)
-      ) {
-        return {
-          success: false,
-          message: "Venue managers can only submit events for their linked venue.",
-          fieldErrors: { venueId: "Venue mismatch" }
-        };
-      }
-
       const titleValue = formData.get("title");
       const title = typeof titleValue === "string" ? titleValue : "";
       const eventTypeValue = formData.get("eventType");
@@ -1632,8 +1635,9 @@ export async function generateWebsiteCopyFromFormAction(
     redirect("/login");
   }
 
-  if (!canManageEvents(user.role, user.venueId)) {
-    return { success: false, message: "Only administrators or venue managers can generate website copy." };
+  // LLM utility with no event context — capability alone gates it.
+  if (!canProposeEvents(user.role)) {
+    return { success: false, message: "You don't have permission to generate website copy." };
   }
 
   try {
@@ -1728,8 +1732,27 @@ export async function generateTermsAndConditionsAction(
     redirect("/login");
   }
 
-  if (!canManageEvents(user.role, user.venueId)) {
-    return { success: false, message: "Only administrators or venue managers can generate terms." };
+  // If called from within an existing event (metadata update), require
+  // full edit rights on that event. If called for an unsaved draft,
+  // capability alone is sufficient.
+  const termsEventIdRaw = formData.get("eventId");
+  const termsEventIdStr = typeof termsEventIdRaw === "string" ? termsEventIdRaw.trim() : "";
+  if (termsEventIdStr) {
+    const parsedId = z.string().uuid().safeParse(termsEventIdStr);
+    if (!parsedId.success) {
+      return { success: false, message: "Invalid event reference." };
+    }
+    const ctx = await loadEventEditContext(parsedId.data);
+    if (!ctx) {
+      return { success: false, message: "Event not found." };
+    }
+    if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
+      return { success: false, message: "You don't have permission to edit this event." };
+    }
+  } else {
+    if (!canProposeEvents(user.role)) {
+      return { success: false, message: "You don't have permission to generate terms." };
+    }
   }
 
   const bookingType = normaliseOptionalBookingTypeField(formData.get("bookingType"));
@@ -1853,9 +1876,6 @@ export async function deleteEventAction(_: ActionResult | undefined, formData: F
   if (!user) {
     redirect("/login");
   }
-  if (!canManageEvents(user.role, user.venueId)) {
-    return { success: false, message: "You don't have permission to delete events." };
-  }
 
   const eventId = formData.get("eventId");
   const parsedEvent = z.string().uuid().safeParse(eventId);
@@ -1864,6 +1884,14 @@ export async function deleteEventAction(_: ActionResult | undefined, formData: F
     return { success: false, message: "Invalid event reference." };
   }
 
+  const ctx = await loadEventEditContext(parsedEvent.data);
+  if (!ctx) {
+    return { success: false, message: "Event not found." };
+  }
+  if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
+    return { success: false, message: "You don't have permission to delete this event." };
+  }
+
   const supabase = await createSupabaseActionClient();
 
   let redirectUrl: string | null = null;
@@ -1878,15 +1906,6 @@ export async function deleteEventAction(_: ActionResult | undefined, formData: F
       return { success: false, message: "Event not found." };
     }
 
-    const canDelete =
-      user.role === "administrator" ||
-      ((user.role === "office_worker" && event.created_by === user.id) &&
-        ["draft", "needs_revisions"].includes(event.status));
-
-    if (!canDelete) {
-      return { success: false, message: "You don't have permission to delete this event." };
-    }
-
     // Record audit entry before deletion so the event ID is captured
     await recordAuditLogEntry({
       entity: "event",
@@ -2019,10 +2038,6 @@ export async function updateBookingSettingsAction(
   const user = await getCurrentUser();
   if (!user) redirect("/login");
 
-  if (!canManageEvents(user.role, user.venueId)) {
-    return { success: false, message: "You don't have permission to update booking settings." };
-  }
-
   const parsed = bookingSettingsSchema.safeParse(input);
   if (!parsed.success) {
     return { success: false, message: "Invalid booking settings." };
@@ -2030,9 +2045,20 @@ export async function updateBookingSettingsAction(
 
   const { eventId, bookingEnabled, totalCapacity, maxTicketsPerBooking, smsPromoEnabled } = parsed.data;
 
+  // This action uses the admin client below, so the server-side guard is
+  // the sole enforcement point. Validate permission via the true row.
+  const ctx = await loadEventEditContext(eventId);
+  if (!ctx) {
+    return { success: false, message: "Event not found." };
+  }
+  if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
+    return { success: false, message: "You don't have permission to update booking settings for this event." };
+  }
+
   const supabase = createSupabaseAdminClient();
 
-  // Fetch the current event to check permissions and existing slug
+  // Fetch the current event for slug/title/start_at. Permission already
+  // verified above via loadEventEditContext.
   const { data: event, error: fetchError } = await supabase
     .from("events")
     .select("id, title, start_at, venue_id, seo_slug")
@@ -2043,11 +2069,6 @@ export async function updateBookingSettingsAction(
     return { success: false, message: "Event not found." };
   }
 
-  // Venue managers can only modify events at their own venue
-  if (user.role === "office_worker" && event.venue_id !== user.venueId) {
-    return { success: false, message: "You can only manage booking settings for your own venue's events." };
-  }
-
   // Auto-generate slug when enabling bookings for the first time
   let seoSlug: string | null = event.seo_slug ?? null;
   if (bookingEnabled && !seoSlug) {
diff --git a/src/actions/pre-event.ts b/src/actions/pre-event.ts
index 780db16..631787d 100644
--- a/src/actions/pre-event.ts
+++ b/src/actions/pre-event.ts
@@ -5,6 +5,8 @@ import { z } from "zod";
 import { randomUUID } from "crypto";
 import { getCurrentUser } from "@/lib/auth";
 import { createSupabaseAdminClient } from "@/lib/supabase/admin";
+import { createSupabaseActionClient } from "@/lib/supabase/server";
+import { canProposeEvents } from "@/lib/roles";
 import { recordAuditLogEntry } from "@/lib/audit-log";
 import type { ActionResult } from "@/lib/types";
 
@@ -56,11 +58,35 @@ export async function proposeEventAction(
     };
   }
 
+  if (!canProposeEvents(user.role)) {
+    return { success: false, message: "You don't have permission to propose events." };
+  }
+
+  // WF-003 v3.1: pre-validate venue IDs with explicit error handling so a DB
+  // outage surfaces as a retryable failure rather than a user-facing "venue
+  // not available" message.
+  const supabase = await createSupabaseActionClient();
+  const { data: validVenues, error: venueErr } = await supabase
+    .from("venues")
+    .select("id")
+    .in("id", parsed.data.venueIds)
+    .is("deleted_at", null);
+  if (venueErr) {
+    console.error("proposeEventAction: venue validation query failed", { error: venueErr });
+    return { success: false, message: "We couldn't verify venues right now. Please try again." };
+  }
+  const validIds = new Set((validVenues ?? []).map((v) => v.id));
+  if (parsed.data.venueIds.some((id) => !validIds.has(id))) {
+    return { success: false, message: "One or more selected venues are not available." };
+  }
+
   const idempotencyKey = (formData.get("idempotencyKey") as string) || randomUUID();
   const db = createSupabaseAdminClient();
-   
+
   const { data, error } = await (db as any).rpc("create_multi_venue_event_proposals", {
     p_payload: {
+      // SEC-001 v3.1: authoritative created_by from the authenticated session;
+      // never trust a client-supplied value, even if the RPC later checks role.
       created_by: user.id,
       venue_ids: parsed.data.venueIds,
       title: parsed.data.title,
@@ -150,25 +176,18 @@ export async function preRejectEventAction(
 
   const db = createSupabaseAdminClient();
 
-  // Insert the approvals row with the decision + reason, then transition status.
-   
-  await (db as any).from("approvals").insert({
-    event_id: parsed.data.eventId,
-    reviewer_id: user.id,
-    decision: "rejected",
-    feedback_text: parsed.data.reason
-  });
+  // Atomic: the reject_event_proposal RPC inserts the approvals row and
+  // transitions the event status in a single transaction, validating the
+  // admin role server-side.
 
-   
-  const { error: statusError } = await (db as any)
-    .from("events")
-    .update({ status: "rejected" })
-    .eq("id", parsed.data.eventId)
-    .eq("status", "pending_approval");
-
-  if (statusError) {
-    console.error("preRejectEventAction status update failed:", statusError);
-    return { success: false, message: "Could not reject the proposal." };
+  const { error } = await (db as any).rpc("reject_event_proposal", {
+    p_event_id: parsed.data.eventId,
+    p_admin_id: user.id,
+    p_reason: parsed.data.reason
+  });
+  if (error) {
+    console.error("preRejectEventAction RPC failed:", error);
+    return { success: false, message: error.message ?? "Could not reject the proposal." };
   }
 
   await recordAuditLogEntry({
diff --git a/src/app/events/[eventId]/page.tsx b/src/app/events/[eventId]/page.tsx
index ec3ae86..5d7171d 100644
--- a/src/app/events/[eventId]/page.tsx
+++ b/src/app/events/[eventId]/page.tsx
@@ -25,6 +25,7 @@ import { parseVenueSpaces } from "@/lib/venue-spaces";
 import { formatCurrency, formatPercent } from "@/lib/utils/format";
 import { createSupabaseAdminClient } from "@/lib/supabase/admin";
 import { canViewPlanning } from "@/lib/roles";
+import { canEditEventFromRow } from "@/lib/events/edit-context";
 import { SopChecklistView } from "@/components/planning/sop-checklist-view";
 import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
 import { ProposalDecisionCard } from "@/components/events/proposal-decision-card";
@@ -90,17 +91,25 @@ export default async function EventDetailPage({ params }: { params: Promise<{ ev
     user.venueId != null &&
     event.venue_id === user.venueId;
 
-  // Pre-event proposal creators (any role) can continue editing their own
-  // proposal once an admin approves it, so they can fill in the remaining
-  // details. The saveEventDraftAction auto-transitions
-  // approved_pending_details → draft once required fields are provided.
-  const isCreator = event.created_by === user.id;
-
-  const canEdit =
-    (user.role === "administrator" &&
-      ["draft", "submitted", "needs_revisions", "approved", "approved_pending_details"].includes(event.status)) ||
-    (isVenueScoped && ["draft", "needs_revisions", "approved_pending_details"].includes(event.status)) ||
-    (isCreator && event.status === "approved_pending_details");
+  // Shared row projection for edit-context gating. All six fields come from
+  // getEventDetail (SELECT *) so no widening is required.
+  const eventRowForEdit = {
+    id: event.id,
+    venue_id: event.venue_id,
+    manager_responsible_id: event.manager_responsible_id,
+    created_by: event.created_by,
+    status: event.status,
+    deleted_at: event.deleted_at
+  };
+
+  // Edit / delete / booking-settings gate — defence-in-depth against the same
+  // rules enforced by RLS and the status-transition trigger. The matching
+  // server actions all use canEditEvent (see plan Task 9/10/16); keeping the
+  // UI aligned avoids dead controls that would server-reject.
+  const canEdit = canEditEventFromRow(user, eventRowForEdit);
+  const canDelete = canEditEventFromRow(user, eventRowForEdit);
+  const canManageBooking = canEditEventFromRow(user, eventRowForEdit);
+
   const canReview =
     (user.role === "administrator" && ["submitted", "needs_revisions"].includes(event.status));
   const canPreReview =
@@ -109,9 +118,6 @@ export default async function EventDetailPage({ params }: { params: Promise<{ ev
     (isVenueScoped && ["approved", "completed"].includes(event.status)) ||
     (user.role === "administrator" && ["approved", "completed"].includes(event.status));
   const canUpdateAssignee = user.role === "administrator";
-  const canDelete =
-    user.role === "administrator" ||
-    (isVenueScoped && ["draft", "needs_revisions"].includes(event.status));
   const canRevertToDraft = event.status === "approved" && user.role === "administrator";
 
   const reassignAssignee = async (formData: FormData) => {
@@ -614,8 +620,7 @@ export default async function EventDetailPage({ params }: { params: Promise<{ ev
                 </span>
               ) : null}
             </div>
-            {(user.role === "administrator" ||
-              (user.role === "office_worker" && event.venue_id === user.venueId)) ? (
+            {canManageBooking ? (
               <Button asChild variant="secondary" size="sm">
                 <Link href={`/events/${event.id}/bookings`}>Bookings</Link>
               </Button>
@@ -635,6 +640,7 @@ export default async function EventDetailPage({ params }: { params: Promise<{ ev
           role={user.role}
           userVenueId={user.venueId}
           users={assignableUsers.map((u) => ({ id: u.id, name: u.name }))}
+          canDelete={canDelete}
           sidebar={
             <div className="space-y-6">
               <Card>
diff --git a/src/app/events/new/page.tsx b/src/app/events/new/page.tsx
index ebd1a06..04dbd57 100644
--- a/src/app/events/new/page.tsx
+++ b/src/app/events/new/page.tsx
@@ -2,7 +2,7 @@ import { redirect } from "next/navigation";
 import { EventForm } from "@/components/events/event-form";
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
 import { getCurrentUser } from "@/lib/auth";
-import { canManageEvents } from "@/lib/roles";
+import { canProposeEvents } from "@/lib/roles";
 import { listVenues } from "@/lib/venues";
 import { listEventTypes } from "@/lib/event-types";
 import { listArtists } from "@/lib/artists";
@@ -34,7 +34,7 @@ export default async function NewEventPage({ searchParams }: PageProps) {
     redirect("/login");
   }
 
-  if (!canManageEvents(user.role, user.venueId)) {
+  if (!canProposeEvents(user.role)) {
     redirect("/unauthorized");
   }
 
@@ -49,13 +49,19 @@ export default async function NewEventPage({ searchParams }: PageProps) {
     listArtists(),
     listAssignableUsers()
   ]);
-  const availableVenues = user.role === "office_worker" ? venues.filter((venue) => venue.id === user.venueId) : venues;
   const initialStartAt = parseDateParam(resolvedSearchParams.startAt);
   const initialEndAt =
     parseDateParam(resolvedSearchParams.endAt) ??
     (initialStartAt ? new Date(new Date(initialStartAt).getTime() + 3 * 60 * 60 * 1000).toISOString() : undefined);
   const requestedVenueId = parseStringParam(resolvedSearchParams.venueId);
-  const initialVenueId = availableVenues.some((venue) => venue.id === requestedVenueId) ? requestedVenueId : undefined;
+  // Pre-select: respect ?venueId= when valid, otherwise fall back to the
+  // user's home venue for office workers. Either way the full venue list
+  // is available to pick from.
+  const initialVenueId = requestedVenueId && venues.some((venue) => venue.id === requestedVenueId)
+    ? requestedVenueId
+    : user.venueId && venues.some((venue) => venue.id === user.venueId)
+      ? user.venueId
+      : undefined;
 
   return (
     <div className="space-y-6">
@@ -69,7 +75,7 @@ export default async function NewEventPage({ searchParams }: PageProps) {
       </Card>
       <EventForm
         mode="create"
-        venues={availableVenues}
+        venues={venues}
         artists={artists}
         eventTypes={eventTypes.map((type) => type.label)}
         role={user.role}
diff --git a/src/app/events/propose/page.tsx b/src/app/events/propose/page.tsx
index a14d02e..6790eaf 100644
--- a/src/app/events/propose/page.tsx
+++ b/src/app/events/propose/page.tsx
@@ -1,7 +1,7 @@
 import { redirect } from "next/navigation";
 import Link from "next/link";
 import { getCurrentUser } from "@/lib/auth";
-import { canManageEvents } from "@/lib/roles";
+import { canProposeEvents } from "@/lib/roles";
 import { listVenues } from "@/lib/venues";
 import { ProposeEventForm } from "@/components/events/propose-event-form";
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
@@ -15,22 +15,16 @@ export const metadata = {
 export default async function ProposeEventPage() {
   const user = await getCurrentUser();
   if (!user) redirect("/login");
-  if (!canManageEvents(user.role, user.venueId)) redirect("/unauthorized");
+  if (!canProposeEvents(user.role)) redirect("/unauthorized");
 
   const venueRows = await listVenues();
   const venues: VenueOption[] = venueRows.map((v) => ({
     id: v.id,
     name: v.name,
-     
+
     category: (((v as any).category ?? "pub") === "cafe" ? "cafe" : "pub") as "pub" | "cafe"
   }));
 
-  // Office workers with a specific venue: pre-restrict to that venue only.
-  const restrictedVenues =
-    user.role === "office_worker" && user.venueId
-      ? venues.filter((v) => v.id === user.venueId)
-      : venues;
-
   return (
     <div className="space-y-6">
       <Card>
@@ -42,7 +36,7 @@ export default async function ProposeEventPage() {
           </CardDescription>
         </CardHeader>
         <CardContent>
-          <ProposeEventForm venues={restrictedVenues} />
+          <ProposeEventForm venues={venues} defaultVenueId={user.venueId ?? null} />
           <p className="mt-4 text-xs text-subtle">
             Need to submit a fully-detailed event straight away? <Link className="underline" href="/events/new">Use the full event form.</Link>
           </p>
diff --git a/src/components/events/event-form.tsx b/src/components/events/event-form.tsx
index 6847353..af6b3e0 100644
--- a/src/components/events/event-form.tsx
+++ b/src/components/events/event-form.tsx
@@ -44,6 +44,13 @@ export type EventFormProps = {
   initialVenueId?: string;
   sidebar?: ReactNode;
   users?: Array<{ id: string; name: string }>;
+  /**
+   * Gates the inline Delete button rendered inside the form actions. Caller
+   * is responsible for computing this via canEditEventFromRow so the UI,
+   * server action and RLS policy agree. Defaults to false for safety when
+   * the caller forgets to pass it in edit mode.
+   */
+  canDelete?: boolean;
 };
 
 function toLocalInputValue(date?: string | null) {
@@ -156,7 +163,8 @@ export function EventForm({
   initialEndAt,
   initialVenueId,
   sidebar,
-  users
+  users,
+  canDelete = false
 }: EventFormProps) {
   const [draftState, draftAction, isSavingPending] = useActionState(saveEventDraftAction, undefined);
   const [submitState, submitAction, isSubmittingPending] = useActionState(submitEventForReviewAction, undefined);
@@ -2092,7 +2100,9 @@ export function EventForm({
                   data-intent="submit"
                 />
               ) : null}
-              {mode === "edit" && defaultValues?.id ? <DeleteEventButton eventId={defaultValues.id} /> : null}
+              {mode === "edit" && defaultValues?.id && canDelete ? (
+                <DeleteEventButton eventId={defaultValues.id} />
+              ) : null}
               {isPending ? (
                 <span className="text-xs text-[var(--color-text-muted)] animate-pulse">
                   {isSlow ? "Still saving — please don\u0027t navigate away..." : "Saving..."}
diff --git a/src/components/events/propose-event-form.tsx b/src/components/events/propose-event-form.tsx
index 13b7d0d..21350a2 100644
--- a/src/components/events/propose-event-form.tsx
+++ b/src/components/events/propose-event-form.tsx
@@ -12,13 +12,22 @@ import { SubmitButton } from "@/components/ui/submit-button";
 
 type ProposeEventFormProps = {
   venues: VenueOption[];
+  /**
+   * Optional pre-selected venue id. When provided and matching a venue in
+   * `venues`, the form opens with that venue already ticked. Used to give
+   * office workers a sensible default without restricting the picker.
+   */
+  defaultVenueId?: string | null;
 };
 
-export function ProposeEventForm({ venues }: ProposeEventFormProps) {
+export function ProposeEventForm({ venues, defaultVenueId }: ProposeEventFormProps) {
   const [state, formAction] = useActionState(proposeEventAction, undefined);
-  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>(
-    venues.length === 1 ? [venues[0].id] : []
-  );
+  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>(() => {
+    if (defaultVenueId && venues.some((v) => v.id === defaultVenueId)) {
+      return [defaultVenueId];
+    }
+    return venues.length === 1 ? [venues[0].id] : [];
+  });
   const router = useRouter();
 
   useEffect(() => {
diff --git a/src/lib/auth/__tests__/rbac.test.ts b/src/lib/auth/__tests__/rbac.test.ts
index e26d5a7..ec42cc5 100644
--- a/src/lib/auth/__tests__/rbac.test.ts
+++ b/src/lib/auth/__tests__/rbac.test.ts
@@ -40,7 +40,9 @@ import {
 import type { AppUser } from "@/lib/types";
 import {
   isAdministrator,
-  canManageEvents,
+  canProposeEvents,
+  canEditEvent,
+  type EventEditContext,
   canViewEvents,
   canReviewEvents,
   canManageBookings,
@@ -694,13 +696,80 @@ describe("roles.ts — final capability functions", () => {
     it("returns false for executive", () => expect(isAdministrator("executive")).toBe(false));
   });
 
-  describe("canManageEvents (venue_id-dependent)", () => {
-    it("administrator can manage events without venueId", () => expect(canManageEvents("administrator")).toBe(true));
-    it("administrator can manage events with venueId", () => expect(canManageEvents("administrator", "v1")).toBe(true));
-    it("office_worker WITH venueId can manage events", () => expect(canManageEvents("office_worker", "v1")).toBe(true));
-    it("office_worker WITHOUT venueId cannot manage events", () => expect(canManageEvents("office_worker")).toBe(false));
-    it("office_worker with null venueId cannot manage events", () => expect(canManageEvents("office_worker", null)).toBe(false));
-    it("executive cannot manage events", () => expect(canManageEvents("executive")).toBe(false));
+  describe("canProposeEvents", () => {
+    it("administrator can propose", () => expect(canProposeEvents("administrator")).toBe(true));
+    it("office_worker can propose (no venueId required)", () => expect(canProposeEvents("office_worker")).toBe(true));
+    it("executive cannot propose", () => expect(canProposeEvents("executive")).toBe(false));
+  });
+
+  describe("canEditEvent", () => {
+    const base: EventEditContext = {
+      venueId: "venue-A",
+      managerResponsibleId: "user-manager",
+      createdBy: "user-creator",
+      status: "approved",
+      deletedAt: null,
+    };
+
+    it("admin always passes (except no admin override here — admin can edit any non-deleted event)", () => {
+      expect(canEditEvent("administrator", "user-x", null, base)).toBe(true);
+    });
+
+    it("admin can edit soft-deleted event (restore path)", () => {
+      expect(canEditEvent("administrator", "user-x", null, { ...base, deletedAt: "2026-01-01T00:00:00Z" })).toBe(true);
+    });
+
+    it("soft-deleted rejects non-admin (including manager)", () => {
+      expect(canEditEvent("office_worker", "user-manager", "venue-A", { ...base, deletedAt: "2026-01-01T00:00:00Z" })).toBe(false);
+    });
+
+    it("executive cannot edit even as creator on draft (role gate precedes creator clause)", () => {
+      expect(canEditEvent("executive", "user-creator", null, { ...base, status: "draft" })).toBe(false);
+    });
+
+    it("creator can edit own draft", () => {
+      expect(canEditEvent("office_worker", "user-creator", "venue-X", { ...base, status: "draft" })).toBe(true);
+    });
+
+    it("creator can edit own needs_revisions", () => {
+      expect(canEditEvent("office_worker", "user-creator", "venue-X", { ...base, status: "needs_revisions" })).toBe(true);
+    });
+
+    it("creator cannot edit own pending_approval (submitted)", () => {
+      expect(canEditEvent("office_worker", "user-creator", "venue-X", { ...base, status: "pending_approval" })).toBe(false);
+    });
+
+    it("office_worker without venueId cannot edit approved event they didn't create", () => {
+      expect(canEditEvent("office_worker", "user-manager", null, base)).toBe(false);
+    });
+
+    it("office_worker at wrong venue cannot edit", () => {
+      expect(canEditEvent("office_worker", "user-manager", "venue-B", base)).toBe(false);
+    });
+
+    it("office_worker at right venue but not manager_responsible cannot edit", () => {
+      expect(canEditEvent("office_worker", "user-other", "venue-A", base)).toBe(false);
+    });
+
+    it("office_worker manager at right venue can edit approved event", () => {
+      expect(canEditEvent("office_worker", "user-manager", "venue-A", base)).toBe(true);
+    });
+
+    it("office_worker manager can transition approved → cancelled (read-side passes for both)", () => {
+      expect(canEditEvent("office_worker", "user-manager", "venue-A", { ...base, status: "cancelled" })).toBe(true);
+    });
+
+    it("office_worker manager cannot edit completed event", () => {
+      expect(canEditEvent("office_worker", "user-manager", "venue-A", { ...base, status: "completed" })).toBe(false);
+    });
+
+    it("office_worker manager cannot edit rejected event", () => {
+      expect(canEditEvent("office_worker", "user-manager", "venue-A", { ...base, status: "rejected" })).toBe(false);
+    });
+
+    it("office_worker manager cannot edit pending_approval (admin review window)", () => {
+      expect(canEditEvent("office_worker", "user-manager", "venue-A", { ...base, status: "pending_approval" })).toBe(false);
+    });
   });
 
   describe("canViewEvents", () => {
diff --git a/src/lib/events/__tests__/edit-context.test.ts b/src/lib/events/__tests__/edit-context.test.ts
new file mode 100644
index 0000000..21caaa4
--- /dev/null
+++ b/src/lib/events/__tests__/edit-context.test.ts
@@ -0,0 +1,61 @@
+import { describe, it, expect, vi, beforeEach } from "vitest";
+
+const maybeSingleMock = vi.fn();
+const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
+const selectMock = vi.fn(() => ({ eq: eqMock }));
+const fromMock = vi.fn(() => ({ select: selectMock }));
+
+vi.mock("@/lib/supabase/admin", () => ({
+  createSupabaseAdminClient: () => ({ from: fromMock }),
+}));
+
+import { loadEventEditContext } from "../edit-context";
+
+describe("loadEventEditContext", () => {
+  beforeEach(() => {
+    vi.clearAllMocks();
+  });
+
+  it("returns projected context on success", async () => {
+    maybeSingleMock.mockResolvedValueOnce({
+      data: {
+        id: "e1",
+        venue_id: "v1",
+        manager_responsible_id: "u1",
+        created_by: "u2",
+        status: "approved",
+        deleted_at: null,
+      },
+      error: null,
+    });
+
+    const result = await loadEventEditContext("e1");
+    expect(result).toEqual({
+      venueId: "v1",
+      managerResponsibleId: "u1",
+      createdBy: "u2",
+      status: "approved",
+      deletedAt: null,
+    });
+    expect(selectMock).toHaveBeenCalledWith(
+      "id, venue_id, manager_responsible_id, created_by, status, deleted_at",
+    );
+  });
+
+  it("returns null when row is missing", async () => {
+    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
+    expect(await loadEventEditContext("e-missing")).toBeNull();
+  });
+
+  it("returns null and logs on DB error", async () => {
+    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
+    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
+
+    expect(await loadEventEditContext("e-err")).toBeNull();
+    expect(errSpy).toHaveBeenCalledWith(
+      "loadEventEditContext: DB error",
+      expect.objectContaining({ eventId: "e-err" }),
+    );
+    errSpy.mockRestore();
+  });
+});
diff --git a/src/lib/events/edit-context.ts b/src/lib/events/edit-context.ts
new file mode 100644
index 0000000..ba5735f
--- /dev/null
+++ b/src/lib/events/edit-context.ts
@@ -0,0 +1,57 @@
+import { createSupabaseAdminClient } from "@/lib/supabase/admin";
+import { canEditEvent, type EventEditContext } from "@/lib/roles";
+import type { UserRole } from "@/lib/types";
+
+export type EventRowForEdit = {
+  id: string;
+  venue_id: string | null;
+  manager_responsible_id: string | null;
+  created_by: string | null;
+  status: string | null;
+  deleted_at: string | null;
+};
+
+/**
+ * Load the minimum event projection required by canEditEvent.
+ * Uses the admin client so permission decisions are made against the true row,
+ * not an RLS-filtered view. Returns null when the event does not exist or
+ * when the query errors (errors are logged).
+ */
+export async function loadEventEditContext(
+  eventId: string,
+): Promise<EventEditContext | null> {
+  const db = createSupabaseAdminClient();
+  const { data, error } = await db
+    .from("events")
+    .select("id, venue_id, manager_responsible_id, created_by, status, deleted_at")
+    .eq("id", eventId)
+    .maybeSingle();
+
+  if (error) {
+    console.error("loadEventEditContext: DB error", { eventId, error });
+    return null;
+  }
+  if (!data) return null;
+
+  return {
+    venueId: data.venue_id,
+    managerResponsibleId: data.manager_responsible_id,
+    createdBy: data.created_by,
+    status: data.status,
+    deletedAt: data.deleted_at,
+  };
+}
+
+/** Synchronous helper for UI/list gating when the row is already loaded. */
+export function canEditEventFromRow(
+  user: { id: string; role: UserRole; venueId: string | null },
+  row: EventRowForEdit,
+): boolean {
+  return canEditEvent(user.role, user.id, user.venueId, {
+    venueId: row.venue_id,
+    managerResponsibleId: row.manager_responsible_id,
+    createdBy: row.created_by,
+    status: row.status,
+    deletedAt: row.deleted_at,
+  });
+}
diff --git a/src/lib/roles.ts b/src/lib/roles.ts
index 3b5684d..c332978 100644
--- a/src/lib/roles.ts
+++ b/src/lib/roles.ts
@@ -17,11 +17,46 @@ export function isAdministrator(role: UserRole): boolean {
   return role === "administrator";
 }
 
-/** Can create or edit events (admin always; office_worker only with venueId) */
-export function canManageEvents(role: UserRole, venueId?: string | null): boolean {
+/** Can propose or submit an event (any venue; admin triages). */
+export function canProposeEvents(role: UserRole): boolean {
+  return role === "administrator" || role === "office_worker";
+}
+
+/** Context an edit check needs about the event being edited. */
+export type EventEditContext = {
+  venueId: string | null;
+  managerResponsibleId: string | null;
+  createdBy: string | null;
+  status: string | null;
+  deletedAt: string | null;
+};
+
+/** Can edit a specific event. Defence-in-depth: also enforced at RLS + trigger. */
+export function canEditEvent(
+  role: UserRole,
+  userId: string,
+  userVenueId: string | null,
+  event: EventEditContext,
+): boolean {
+  if (event.deletedAt !== null) {
+    return role === "administrator";
+  }
+
   if (role === "administrator") return true;
-  if (role === "office_worker" && venueId) return true;
-  return false;
+  if (role !== "office_worker") return false;
+
+  if (
+    event.createdBy === userId &&
+    (event.status === "draft" || event.status === "needs_revisions")
+  ) {
+    return true;
+  }
+
+  if (!userVenueId) return false;
+  if (event.venueId !== userVenueId) return false;
+  if (event.managerResponsibleId !== userId) return false;
+  if (event.status !== "approved" && event.status !== "cancelled") return false;
+  return true;
 }
 
 /** Can view events (all roles) */
diff --git a/supabase/migrations/20260420170000_office_worker_event_scope.sql b/supabase/migrations/20260420170000_office_worker_event_scope.sql
new file mode 100644
index 0000000..a889fc2
--- /dev/null
+++ b/supabase/migrations/20260420170000_office_worker_event_scope.sql
@@ -0,0 +1,161 @@
+-- =============================================================================
+-- Office worker propose/edit scope — SELECT/UPDATE RLS + sensitive-updates
+-- trigger + event_artists policy replacement.
+-- Spec: docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md
+-- =============================================================================
+
+-- ─── public.events: SELECT (global for all three roles) ─────────────────────
+DROP POLICY IF EXISTS "events_select_policy" ON public.events;
+CREATE POLICY "events_select_policy"
+  ON public.events
+  FOR SELECT TO authenticated
+  USING (
+    deleted_at IS NULL
+    AND public.current_user_role() IN ('administrator', 'executive', 'office_worker')
+  );
+
+-- ─── public.events: UPDATE (creator-draft scoped to admin/OW;
+--                              manager branch scoped to approved/cancelled) ──
+DROP POLICY IF EXISTS "managers update editable events" ON public.events;
+CREATE POLICY "managers update editable events"
+  ON public.events
+  FOR UPDATE
+  USING (
+    public.current_user_role() = 'administrator'
+    OR (
+      public.current_user_role() = 'office_worker'
+      AND auth.uid() = created_by
+      AND status IN ('draft', 'needs_revisions')
+    )
+    OR (
+      public.current_user_role() = 'office_worker'
+      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
+      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
+      AND manager_responsible_id = auth.uid()
+      AND status IN ('approved', 'cancelled')
+    )
+  )
+  WITH CHECK (
+    public.current_user_role() = 'administrator'
+    OR (
+      public.current_user_role() = 'office_worker'
+      AND auth.uid() = created_by
+      AND status IN ('draft', 'needs_revisions', 'pending_approval')
+    )
+    OR (
+      public.current_user_role() = 'office_worker'
+      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
+      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
+      AND manager_responsible_id = auth.uid()
+      AND status IN ('approved', 'cancelled')
+    )
+  );
+
+-- ─── Sensitive-column + status-transition trigger ────────────────────────────
+CREATE OR REPLACE FUNCTION public.events_guard_sensitive_updates()
+RETURNS TRIGGER
+LANGUAGE plpgsql

[diff truncated at line 1500 — total was 2284 lines. Consider scoping the review to fewer files.]
```

## Changed File Contents

### `src/actions/__tests__/events-edit-rbac.test.ts`

```
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  loadCtxMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const redirectError = new Error("NEXT_REDIRECT");
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw redirectError; }),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getUserMock }));
vi.mock("@/lib/events/edit-context", () => ({
  loadEventEditContext: mocks.loadCtxMock,
  canEditEventFromRow: vi.fn(),
}));
// Stub modules so the action import doesn't crash. Supabase/admin/server
// clients are not used in the permission-guard paths we exercise, so
// vi.fn() returning nothing is enough.
vi.mock("@/lib/supabase/server", () => ({ createSupabaseActionClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: vi.fn() }));
vi.mock("@/lib/events", () => ({
  appendEventVersion: vi.fn(),
  createEventDraft: vi.fn(),
  createEventPlanningItem: vi.fn(),
  recordApproval: vi.fn(),
  softDeleteEvent: vi.fn(),
  updateEventDraft: vi.fn(),
  updateEventAssignee: vi.fn(),
}));
vi.mock("@/lib/bookings", () => ({ generateUniqueEventSlug: vi.fn() }));
vi.mock("@/lib/artists", () => ({
  cleanupOrphanArtists: vi.fn(),
  parseArtistNames: vi.fn(() => []),
  syncEventArtists: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  sendAssigneeReassignmentEmail: vi.fn(),
  sendEventSubmittedEmail: vi.fn(),
  sendReviewDecisionEmail: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({
  generateTermsAndConditions: vi.fn(),
  generateWebsiteCopy: vi.fn(),
}));

import {
  saveEventDraftAction,
  submitEventForReviewAction,
  deleteEventAction,
  generateWebsiteCopyFromFormAction,
  updateBookingSettingsAction,
} from "../events";
import { loadEventEditContext } from "@/lib/events/edit-context";

const { getUserMock, loadCtxMock } = mocks;

// Valid UUID v4s for tests
const EVENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const VENUE_A = "550e8400-e29b-41d4-a716-446655440001";
const VENUE_B = "550e8400-e29b-41d4-a716-446655440002";
const USER_A = "550e8400-e29b-41d4-a716-44665544aaaa";
const USER_B = "550e8400-e29b-41d4-a716-44665544bbbb";

function formData(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

// ─── saveEventDraftAction / submitEventForReviewAction — create path (any venue) ─────────

describe("submitEventForReviewAction — create path (any venue)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("office_worker with no venueId is permitted by capability (no pinning)", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: null });
    // No event context needed for create-path capability check; we expect
    // the action to proceed past the guard. The downstream path will fail
    // for other reasons (e.g. missing required fields), but the first
    // message must NOT be the permission rejection.
    const result = await submitEventForReviewAction(undefined, formData({
      venueIds: VENUE_A,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    // The guard is satisfied — we must not see the legacy venue-not-linked
    // or venue-mismatch rejection strings anywhere.
    expect(result.message ?? "").not.toMatch(/not linked to a venue/i);
    expect(result.message ?? "").not.toMatch(/own venue|venue mismatch/i);
    expect(result.message ?? "").not.toMatch(/don't have permission/i);
  });

  it("office_worker can create for a venue different from their linked venueId", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    const result = await submitEventForReviewAction(undefined, formData({
      venueIds: VENUE_B,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    // Cross-venue is now allowed — the legacy "Venue mismatch"/"can only
    // submit events for their linked venue" must NOT fire.
    expect(result.message ?? "").not.toMatch(/can only submit/i);
    expect(result.message ?? "").not.toMatch(/venue mismatch/i);
    expect(result.message ?? "").not.toMatch(/don't have permission/i);
  });

  it("executive is rejected for create", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
    const result = await submitEventForReviewAction(undefined, formData({
      venueIds: VENUE_A,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/don't have permission/i);
  });
});

describe("saveEventDraftAction — create path (any venue)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("office_worker with no venueId is permitted by capability (no pinning)", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: null });
    const result = await saveEventDraftAction(undefined, formData({
      venueIds: VENUE_A,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    expect(result.message ?? "").not.toMatch(/not linked to a venue/i);
    expect(result.message ?? "").not.toMatch(/own venue|venue mismatch/i);
    expect(result.message ?? "").not.toMatch(/don't have permission/i);
  });

  it("office_worker can save draft for a venue different from their linked venueId", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    const result = await saveEventDraftAction(undefined, formData({
      venueIds: VENUE_B,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    expect(result.message ?? "").not.toMatch(/can only save/i);
    expect(result.message ?? "").not.toMatch(/venue mismatch/i);
    expect(result.message ?? "").not.toMatch(/don't have permission/i);
  });

  it("executive is rejected for create", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
    const result = await saveEventDraftAction(undefined, formData({
      venueIds: VENUE_A,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/don't have permission/i);
  });
});

// ─── update-path via canEditEvent ───────────────────────────────────────────────

describe("saveEventDraftAction — update path (canEditEvent)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("manager_responsible office_worker at own venue on approved event passes guard", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_A,
      createdBy: USER_B,
      status: "approved",
      deletedAt: null,
    });

    const result = await saveEventDraftAction(undefined, formData({
      eventId: EVENT_ID,
      venueIds: VENUE_A,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    // Permission guard passed; later logic may fail but NOT with the
    // permission rejection message.
    expect(result.message ?? "").not.toMatch(/don't have permission to edit/i);
  });

  it("office_worker at right venue but not manager_responsible is rejected", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_B,
      createdBy: USER_B,
      status: "approved",
      deletedAt: null,
    });

[truncated at line 200 — original has 404 lines]
```

### `src/actions/__tests__/pre-event.test.ts`

```
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks hoisted by Vitest — use vi.hoisted() for shared state so the
// factory closures can reference them safely during hoisting.
const mocks = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  selectInMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpcMock }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: () => ({
    from: () => ({
      select: () => ({
        in: () => ({ is: mocks.selectInMock }),
      }),
    }),
  }),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getUserMock,
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { proposeEventAction } from "../pre-event";

const { rpcMock, selectInMock, getUserMock } = mocks;

// Use valid UUID v4 strings — Zod's `.uuid()` enforces strict RFC 4122.
const VENUE_A = "550e8400-e29b-41d4-a716-446655440000";
const VENUE_B = "550e8400-e29b-41d4-a716-446655440001";

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

describe("proposeEventAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects executive", async () => {
    getUserMock.mockResolvedValue({ id: "exec-1", role: "executive", venueId: null });
    const result = await proposeEventAction(undefined, fd({
      title: "x",
      startAt: "2026-05-01T10:00:00Z",
      notes: "x",
      venueIds: VENUE_A,
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/permission/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("overwrites client-supplied created_by with authenticated user id", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
    selectInMock.mockResolvedValue({
      data: [{ id: VENUE_A }],
      error: null,
    });
    rpcMock.mockResolvedValue({ data: { event_id: "e1" }, error: null });

    await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: VENUE_A,
      // Malicious payload ignored:
      created_by: "other-user-id",
    }));

    expect(rpcMock).toHaveBeenCalledWith(
      "create_multi_venue_event_proposals",
      expect.objectContaining({
        p_payload: expect.objectContaining({ created_by: "ow-1" }),
      }),
    );
  });

  it("returns retryable error when venue query fails", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
    selectInMock.mockResolvedValue({ data: null, error: { message: "DB down" } });

    const result = await proposeEventAction(undefined, fd({
      title: "x",
      startAt: "2026-05-01T10:00:00Z",
      notes: "x",
      venueIds: VENUE_A,
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/try again/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects when a venue id is not in active list", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
    selectInMock.mockResolvedValue({
      data: [{ id: VENUE_A }],
      error: null,
    });

    const result = await proposeEventAction(undefined, fd({
      title: "x",
      startAt: "2026-05-01T10:00:00Z",
      notes: "x",
      venueIds: [VENUE_A, VENUE_B],
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not available/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
```

### `src/actions/events.ts`

```
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { canReviewEvents, canProposeEvents, canEditEvent } from "@/lib/roles";
import { loadEventEditContext } from "@/lib/events/edit-context";
import { appendEventVersion, createEventDraft, createEventPlanningItem, recordApproval, softDeleteEvent, updateEventDraft, updateEventAssignee } from "@/lib/events";
import { generateUniqueEventSlug } from "@/lib/bookings";
import { cleanupOrphanArtists, parseArtistNames, syncEventArtists } from "@/lib/artists";
import { eventDraftSchema, eventFormSchema } from "@/lib/validation";
import { getFieldErrors } from "@/lib/form-errors";
import type { ActionResult, EventStatus } from "@/lib/types";
import { sendAssigneeReassignmentEmail, sendEventSubmittedEmail, sendReviewDecisionEmail } from "@/lib/notifications";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { generateTermsAndConditions, generateWebsiteCopy, type GeneratedWebsiteCopy } from "@/lib/ai";
import { normaliseEventDateTimeForStorage } from "@/lib/datetime";
import {
  normaliseOptionalText as normaliseOptionalTextField,
  normaliseOptionalNumber as normaliseOptionalNumberField,
  normaliseOptionalInteger as normaliseOptionalIntegerField,
} from "@/lib/normalise";

const reviewerFallback = z.string().uuid().optional();

/**
 * Keeps the event_venues join table in sync with the picked venue list.
 * Calls the set_event_venues SECURITY DEFINER helper — first id becomes
 * primary, parent events.venue_id is updated to match.
 */
async function syncEventVenueAttachments(eventId: string, venueIds: string[]): Promise<void> {
  if (!eventId) return;
  const db = createSupabaseAdminClient();
   
  const { error } = await (db as any).rpc("set_event_venues", {
    p_event_id: eventId,
    p_venue_ids: venueIds
  });
  if (error) {
    console.error("syncEventVenueAttachments RPC failed:", error);
  }
}

type WebsiteCopyValues = {
  publicTitle: string | null;
  publicTeaser: string | null;
  publicDescription: string | null;
  publicHighlights: string[] | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoSlug: string | null;
};

type WebsiteCopyActionResult = ActionResult & {
  values?: WebsiteCopyValues;
};

type TermsActionResult = ActionResult & {
  terms?: string;
};

const EVENT_IMAGE_BUCKET = "event-images";
const MAX_EVENT_IMAGE_BYTES = 10 * 1024 * 1024;
const ARTIST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEBSITE_COPY_AUDIT_CHANGES = [
  "Public title",
  "Public teaser",
  "Public description",
  "Public highlights",
  "SEO title",
  "SEO description",
  "SEO slug"
] as const;
const WEBSITE_COPY_EVENT_SELECT = `
  id,
  created_by,
  assignee_id,
  title,
  event_type,
  status,
  start_at,
  end_at,
  venue_space,
  expected_headcount,
  wet_promo,
  food_promo,
  goal_focus,
  cost_total,
  cost_details,
  booking_type,
  ticket_price,
  check_in_cutoff_minutes,
  age_policy,
  accessibility_notes,
  cancellation_window_hours,
  terms_and_conditions,
  public_title,
  public_teaser,
  public_description,
  public_highlights,
  booking_url,
  notes,
  venue:venues!events_venue_id_fkey(name,address),
  artists:event_artists(
    billing_order,
    artist:artists(name,description)
  )
`;

type ActionSupabaseClient = Awaited<ReturnType<typeof createSupabaseActionClient>>;
type WebsiteCopyEventRecord = {
  id: string;
  created_by: string | null;
  assignee_id: string | null;
  title: string | null;
  event_type: string | null;
  status: string | null;
  start_at: string | null;
  end_at: string | null;
  venue_space: string | null;
  expected_headcount: number | null;
  wet_promo: string | null;
  food_promo: string | null;
  goal_focus: string | null;
  cost_total: number | null;
  cost_details: string | null;
  booking_type: string | null;
  ticket_price: number | null;
  check_in_cutoff_minutes: number | null;
  age_policy: string | null;
  accessibility_notes: string | null;
  cancellation_window_hours: number | null;
  terms_and_conditions: string | null;
  public_title: string | null;
  public_teaser: string | null;
  public_description: string | null;
  public_highlights: unknown;
  booking_url: string | null;
  notes: string | null;
  venue: unknown;
  artists: unknown;
};

function normaliseVenueSpacesField(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") {
    return "";
  }
  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return "";
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  entries.forEach((entry) => {
    const key = entry.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  });
  return unique.join(", ");
}

type BookingType = "ticketed" | "table_booking" | "free_entry" | "mixed";
const BOOKING_TYPE_VALUES = new Set<BookingType>(["ticketed", "table_booking", "free_entry", "mixed"]);

function normaliseOptionalHighlightsField(value: FormDataEntryValue | null): string[] | null {
  if (typeof value !== "string") return null;
  const highlights = value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  return highlights.length ? highlights : null;
}

function normaliseOptionalBookingTypeField(value: FormDataEntryValue | null): BookingType | null {
  if (typeof value !== "string") return null;
  if (BOOKING_TYPE_VALUES.has(value as BookingType)) {
    return value as BookingType;
  }
  return null;
}

function sanitiseFileName(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
  return cleaned.length ? cleaned : "event-image";
}

function normaliseArtistNameList(value: FormDataEntryValue | null): string[] {
  return parseArtistNames(typeof value === "string" ? value : null);

[truncated at line 200 — original has 2113 lines]
```

### `src/actions/pre-event.ts`

```
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { canProposeEvents } from "@/lib/roles";
import { recordAuditLogEntry } from "@/lib/audit-log";
import type { ActionResult } from "@/lib/types";

/**
 * Wave 3 — pre-event approval server actions.
 *
 * proposeEventAction: venue manager (or administrator) submits a
 * bare-bones proposal for multiple venues. Calls
 * create_multi_venue_event_proposals RPC. No event_type / venue_space /
 * end_at required; no SOP generated until approval.
 *
 * preApproveEventAction: administrator only. Calls
 * pre_approve_event_proposal RPC (transitional status, planning item
 * creation + SOP generation).
 *
 * preRejectEventAction: administrator only. Records rejection with
 * reason in approvals and transitions status to 'rejected'.
 */

const proposalSchema = z.object({
  title: z.string().min(1, "Add a title").max(200),
  startAt: z.string().min(1, "Pick a start date & time"),
  notes: z.string().min(1, "Add a short description").max(2000),
  venueIds: z
    .array(z.string().uuid())
    .min(1, "Pick at least one venue")
    .max(20, "Too many venues selected")
});

export async function proposeEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const venueIds = formData.getAll("venueIds").filter((v): v is string => typeof v === "string" && v.length > 0);
  const parsed = proposalSchema.safeParse({
    title: formData.get("title"),
    startAt: formData.get("startAt"),
    notes: formData.get("notes"),
    venueIds
  });

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Check the highlighted fields."
    };
  }

  if (!canProposeEvents(user.role)) {
    return { success: false, message: "You don't have permission to propose events." };
  }

  // WF-003 v3.1: pre-validate venue IDs with explicit error handling so a DB
  // outage surfaces as a retryable failure rather than a user-facing "venue
  // not available" message.
  const supabase = await createSupabaseActionClient();
  const { data: validVenues, error: venueErr } = await supabase
    .from("venues")
    .select("id")
    .in("id", parsed.data.venueIds)
    .is("deleted_at", null);
  if (venueErr) {
    console.error("proposeEventAction: venue validation query failed", { error: venueErr });
    return { success: false, message: "We couldn't verify venues right now. Please try again." };
  }
  const validIds = new Set((validVenues ?? []).map((v) => v.id));
  if (parsed.data.venueIds.some((id) => !validIds.has(id))) {
    return { success: false, message: "One or more selected venues are not available." };
  }

  const idempotencyKey = (formData.get("idempotencyKey") as string) || randomUUID();
  const db = createSupabaseAdminClient();

  const { data, error } = await (db as any).rpc("create_multi_venue_event_proposals", {
    p_payload: {
      // SEC-001 v3.1: authoritative created_by from the authenticated session;
      // never trust a client-supplied value, even if the RPC later checks role.
      created_by: user.id,
      venue_ids: parsed.data.venueIds,
      title: parsed.data.title,
      start_at: parsed.data.startAt,
      notes: parsed.data.notes
    },
    p_idempotency_key: idempotencyKey
  });

  if (error) {
    console.error("proposeEventAction RPC failed:", error);
    return { success: false, message: error.message ?? "Could not submit the proposal." };
  }

  revalidatePath("/events");
  const venueCount = parsed.data.venueIds.length;
  return {
    success: true,
    message:
      venueCount === 1
        ? "Proposal submitted."
        : `Proposal submitted for ${venueCount} venues.`,
    // Expose batch data for UI use if needed. We omit it from the type for
    // simplicity — the toast + redirect is the primary success signal.
    ...(data ? { meta: data } : {})
  } as ActionResult;
}

const approveSchema = z.object({
  eventId: z.string().uuid()
});

export async function preApproveEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can approve proposals." };
  }

  const parsed = approveSchema.safeParse({ eventId: formData.get("eventId") });
  if (!parsed.success) {
    return { success: false, message: "Missing event reference." };
  }

  const db = createSupabaseAdminClient();
   
  const { error } = await (db as any).rpc("pre_approve_event_proposal", {
    p_event_id: parsed.data.eventId,
    p_admin_id: user.id
  });

  if (error) {
    console.error("preApproveEventAction RPC failed:", error);
    return { success: false, message: error.message ?? "Could not approve the proposal." };
  }

  revalidatePath("/events");
  revalidatePath(`/events/${parsed.data.eventId}`);
  return { success: true, message: "Proposal approved. The creator can now complete the details." };
}

const rejectSchema = z.object({
  eventId: z.string().uuid(),
  reason: z.string().min(1, "Give a reason").max(1000)
});

export async function preRejectEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can reject proposals." };
  }

  const parsed = rejectSchema.safeParse({
    eventId: formData.get("eventId"),
    reason: formData.get("reason")
  });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the rejection reason." };
  }

  const db = createSupabaseAdminClient();

  // Atomic: the reject_event_proposal RPC inserts the approvals row and
  // transitions the event status in a single transaction, validating the
  // admin role server-side.

  const { error } = await (db as any).rpc("reject_event_proposal", {
    p_event_id: parsed.data.eventId,
    p_admin_id: user.id,
    p_reason: parsed.data.reason
  });
  if (error) {
    console.error("preRejectEventAction RPC failed:", error);
    return { success: false, message: error.message ?? "Could not reject the proposal." };
  }

  await recordAuditLogEntry({
    entity: "event",
    entityId: parsed.data.eventId,
    action: "event.pre_rejected",
    actorId: user.id,
    meta: { reason: parsed.data.reason }
  });


[truncated at line 200 — original has 204 lines]
```

### `src/app/events/[eventId]/page.tsx`

```
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { EventFormActions } from "@/components/events/event-form-actions";
import { BookingSettingsCard } from "@/components/events/booking-settings-card";
import { EventDetailSummary } from "@/components/events/event-detail-summary";
import { DeleteEventButton } from "@/components/events/delete-event-button";
import { RevertToDraftButton } from "@/components/events/revert-to-draft-button";
import { DecisionForm } from "@/components/reviews/decision-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { getCurrentUser } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";
import { EVENT_GOALS_BY_VALUE, humanizeGoalValue, parseGoalFocus } from "@/lib/event-goals";
import { listAuditLogForEvent } from "@/lib/audit-log";
import { listVenues } from "@/lib/venues";
import { listEventTypes } from "@/lib/event-types";
import { listArtists } from "@/lib/artists";
import { listAssignableUsers, getUsersByIds } from "@/lib/users";
import { updateAssigneeAction } from "@/actions/events";
import { parseVenueSpaces } from "@/lib/venue-spaces";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canViewPlanning } from "@/lib/roles";
import { canEditEventFromRow } from "@/lib/events/edit-context";
import { SopChecklistView } from "@/components/planning/sop-checklist-view";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { ProposalDecisionCard } from "@/components/events/proposal-decision-card";
import { listEventAttachmentsRollup } from "@/lib/attachments";
import type { PlanningTask, PlanningPerson, PlanningTaskStatus } from "@/lib/planning/types";

const statusCopy: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Proposal — awaiting approval", tone: "info" },
  approved_pending_details: { label: "Approved — add details", tone: "info" },
  submitted: { label: "Waiting review", tone: "info" },
  needs_revisions: { label: "Needs tweaks", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  completed: { label: "Completed", tone: "success" }
};

const formatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London"
});

const auditTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London"
});

const bookingTypeLabel: Record<string, string> = {
  ticketed: "Ticketed event",
  table_booking: "Table booking event",
  free_entry: "Free entry",
  mixed: "Mixed booking model"
};

const toMetaRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const event = await getEventDetail(eventId);
  if (!event) {
    notFound();
  }

  const status = statusCopy[event.status] ?? statusCopy.draft;

  // Venue-scoped permission: office_worker can act on events at their venue (not just events they created)
  const isVenueScoped =
    user.role === "office_worker" &&
    user.venueId != null &&
    event.venue_id === user.venueId;

  // Shared row projection for edit-context gating. All six fields come from
  // getEventDetail (SELECT *) so no widening is required.
  const eventRowForEdit = {
    id: event.id,
    venue_id: event.venue_id,
    manager_responsible_id: event.manager_responsible_id,
    created_by: event.created_by,
    status: event.status,
    deleted_at: event.deleted_at
  };

  // Edit / delete / booking-settings gate — defence-in-depth against the same
  // rules enforced by RLS and the status-transition trigger. The matching
  // server actions all use canEditEvent (see plan Task 9/10/16); keeping the
  // UI aligned avoids dead controls that would server-reject.
  const canEdit = canEditEventFromRow(user, eventRowForEdit);
  const canDelete = canEditEventFromRow(user, eventRowForEdit);
  const canManageBooking = canEditEventFromRow(user, eventRowForEdit);

  const canReview =
    (user.role === "administrator" && ["submitted", "needs_revisions"].includes(event.status));
  const canPreReview =
    user.role === "administrator" && event.status === "pending_approval";
  const canSubmitDebrief =
    (isVenueScoped && ["approved", "completed"].includes(event.status)) ||
    (user.role === "administrator" && ["approved", "completed"].includes(event.status));
  const canUpdateAssignee = user.role === "administrator";
  const canRevertToDraft = event.status === "approved" && user.role === "administrator";

  const reassignAssignee = async (formData: FormData) => {
    "use server";
    await updateAssigneeAction(formData);
  };

  const [venues, assignableUsers, eventTypes, auditLog, artists, attachments] = await Promise.all([
    listVenues(),
    listAssignableUsers(),
    listEventTypes(),
    listAuditLogForEvent(event.id),
    listArtists(),
    listEventAttachmentsRollup(event.id)
  ]);

  const canUploadAttachments = user.role === "administrator" || isVenueScoped;

  // ─── Fetch linked planning item & SOP tasks for this event ────────────────
  let sopTasks: PlanningTask[] = [];
  let sopPlanningItemId: string | null = null;
  if (canViewPlanning(user.role)) {
    const db = createSupabaseAdminClient();
    const { data: planningItem } = await db
      .from("planning_items")
      .select(`
        id, target_date,
        tasks:planning_tasks(
          id, planning_item_id, title, assignee_id, due_date, status, completed_at, completed_by,
          sort_order, sop_section, sop_template_task_id, is_blocked, due_date_manually_overridden, notes,
          assignee:users!planning_tasks_assignee_id_fkey(id, full_name, email),
          assignees:planning_task_assignees(user:users(id, full_name, email)),
          dependencies:planning_task_dependencies!planning_task_dependencies_task_id_fkey(depends_on_task_id)
        )
      `)
      .eq("event_id", eventId)
      .maybeSingle();

    if (planningItem) {
      sopPlanningItemId = planningItem.id;
      const rawTasks = Array.isArray(planningItem.tasks) ? planningItem.tasks : [];
      type RawUser = { id: string; full_name: string | null; email: string } | null;
      type RawAssigneeJunction = { user: RawUser | RawUser[] | null };
      type RawDep = { depends_on_task_id: string };
      type RawTask = {
        id: string;
        planning_item_id: string;
        title: string;
        assignee_id: string | null;
        due_date: string;
        status: string;
        completed_at: string | null;
        completed_by: string | null;
        sort_order: number;
        sop_section: string | null;
        sop_template_task_id: string | null;
        is_blocked: boolean;
        due_date_manually_overridden: boolean;
        notes: string | null;
        assignee: RawUser | RawUser[] | null;
        assignees: RawAssigneeJunction[];
        dependencies: RawDep[];
      };
      sopTasks = rawTasks.map((task: RawTask): PlanningTask => {
        const assignee = Array.isArray(task.assignee) ? task.assignee[0] : task.assignee;
        const assigneesRaw = Array.isArray(task.assignees) ? task.assignees : [];
        const assignees = assigneesRaw.map((a: RawAssigneeJunction) => {
          const rawUser = a?.user;
          const u = Array.isArray(rawUser) ? rawUser[0] : rawUser;
          return { id: u?.id ?? "", name: u?.full_name ?? u?.email ?? "Unknown", email: u?.email ?? "" };
        });
        return {
          id: task.id,
          planningItemId: task.planning_item_id,
          title: task.title,
          assigneeId: task.assignee_id ?? null,
          assigneeName: assignee?.full_name ?? assignee?.email ?? "To be determined",
          assignees,
          dueDate: task.due_date,
          status: task.status as PlanningTaskStatus,

[truncated at line 200 — original has 749 lines]
```

### `src/app/events/new/page.tsx`

```
import { redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { canProposeEvents } from "@/lib/roles";
import { listVenues } from "@/lib/venues";
import { listEventTypes } from "@/lib/event-types";
import { listArtists } from "@/lib/artists";
import { listAssignableUsers } from "@/lib/users";

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

function parseDateParam(value?: string | string[]): string | undefined {
  if (!value) return undefined;
  const stringValue = Array.isArray(value) ? value[0] : value;
  if (!stringValue) return undefined;
  const parsed = new Date(stringValue);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function parseStringParam(value?: string | string[]): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] ?? undefined : value;
}

export default async function NewEventPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!canProposeEvents(user.role)) {
    redirect("/unauthorized");
  }

  const searchParamsPromise =
    searchParams?.then((params) => params as SearchParams).catch(() => ({} as SearchParams)) ??
    Promise.resolve({} as SearchParams);

  const [resolvedSearchParams, venues, eventTypes, artists, assignableUsers] = await Promise.all([
    searchParamsPromise,
    listVenues(),
    listEventTypes(),
    listArtists(),
    listAssignableUsers()
  ]);
  const initialStartAt = parseDateParam(resolvedSearchParams.startAt);
  const initialEndAt =
    parseDateParam(resolvedSearchParams.endAt) ??
    (initialStartAt ? new Date(new Date(initialStartAt).getTime() + 3 * 60 * 60 * 1000).toISOString() : undefined);
  const requestedVenueId = parseStringParam(resolvedSearchParams.venueId);
  // Pre-select: respect ?venueId= when valid, otherwise fall back to the
  // user's home venue for office workers. Either way the full venue list
  // is available to pick from.
  const initialVenueId = requestedVenueId && venues.some((venue) => venue.id === requestedVenueId)
    ? requestedVenueId
    : user.venueId && venues.some((venue) => venue.id === user.venueId)
      ? user.venueId
      : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a new event draft</CardTitle>
          <CardDescription>
            Share the essentials so reviewers can respond quickly—keep the language simple and cover timings, space, and any promos.
          </CardDescription>
        </CardHeader>
      </Card>
      <EventForm
        mode="create"
        venues={venues}
        artists={artists}
        eventTypes={eventTypes.map((type) => type.label)}
        role={user.role}
        userVenueId={user.venueId}
        initialStartAt={initialStartAt}
        initialEndAt={initialEndAt}
        initialVenueId={initialVenueId}
        users={assignableUsers.map((u) => ({ id: u.id, name: u.name }))}
      />
    </div>
  );
}
```

### `src/app/events/propose/page.tsx`

```
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canProposeEvents } from "@/lib/roles";
import { listVenues } from "@/lib/venues";
import { ProposeEventForm } from "@/components/events/propose-event-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { VenueOption } from "@/components/venues/venue-multi-select";

export const metadata = {
  title: "Propose an event · BaronsHub",
  description: "Submit a quick event proposal for admin approval before filling in the full details."
};

export default async function ProposeEventPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canProposeEvents(user.role)) redirect("/unauthorized");

  const venueRows = await listVenues();
  const venues: VenueOption[] = venueRows.map((v) => ({
    id: v.id,
    name: v.name,

    category: (((v as any).category ?? "pub") === "cafe" ? "cafe" : "pub") as "pub" | "cafe"
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Propose an event</CardTitle>
          <CardDescription>
            Give just a title, date and short description. An administrator will review and — once approved —
            you can fill in the remaining details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProposeEventForm venues={venues} defaultVenueId={user.venueId ?? null} />
          <p className="mt-4 text-xs text-subtle">
            Need to submit a fully-detailed event straight away? <Link className="underline" href="/events/new">Use the full event form.</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

### `src/components/events/event-form.tsx`

```
"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { createArtistAction } from "@/actions/artists";
import {
  generateTermsAndConditionsAction,
  generateWebsiteCopyAction,
  generateWebsiteCopyFromFormAction,
  saveEventDraftAction,
  submitEventForReviewAction
} from "@/actions/events";
import { VenueMultiSelect, type VenueOption } from "@/components/venues/venue-multi-select";
import { deriveInitialVenueIds } from "@/lib/planning/utils";
import { SubmitButton } from "@/components/ui/submit-button";
import { DeleteEventButton } from "@/components/events/delete-event-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EventFormContext } from "@/components/events/event-form-context";
import { EVENT_GOALS } from "@/lib/event-goals";
import { cn } from "@/lib/utils";
import { toLondonDateTimeInputValue } from "@/lib/datetime";
import type { EventSummary } from "@/lib/events";
import type { UserRole } from "@/lib/types";
import type { ArtistOption } from "@/lib/artists";
import type { VenueRow } from "@/lib/venues";

export type EventFormProps = {
  mode: "create" | "edit";
  defaultValues?: EventSummary;
  venues: VenueRow[];
  artists: ArtistOption[];
  eventTypes: string[];
  role: UserRole;
  userVenueId?: string | null;
  initialStartAt?: string;
  initialEndAt?: string;
  initialVenueId?: string;
  sidebar?: ReactNode;
  users?: Array<{ id: string; name: string }>;
  /**
   * Gates the inline Delete button rendered inside the form actions. Caller
   * is responsible for computing this via canEditEventFromRow so the UI,
   * server action and RLS policy agree. Defaults to false for safety when
   * the caller forgets to pass it in edit mode.
   */
  canDelete?: boolean;
};

function toLocalInputValue(date?: string | null) {
  return toLondonDateTimeInputValue(date);
}

function addHours(localIso: string, hours: number) {
  if (!localIso) return "";
  const parsed = localIso.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!parsed) return "";

  const year = Number(parsed[1]);
  const month = Number(parsed[2]);
  const day = Number(parsed[3]);
  const hour = Number(parsed[4]);
  const minute = Number(parsed[5]);
  const base = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  if (Number.isNaN(base.getTime())) return "";

  base.setUTCHours(base.getUTCHours() + hours);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  const d = String(base.getUTCDate()).padStart(2, "0");
  const h = String(base.getUTCHours()).padStart(2, "0");
  const min = String(base.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

const ARTIST_TYPE_OPTIONS = [
  { value: "artist", label: "Artist" },
  { value: "band", label: "Band" },
  { value: "host", label: "Host" },
  { value: "dj", label: "DJ" },
  { value: "comedian", label: "Comedian" },
  { value: "other", label: "Other" }
] as const;

const ARTIST_TYPE_LABELS: Record<string, string> = {
  artist: "Artist",
  band: "Band",
  host: "Host",
  dj: "DJ",
  comedian: "Comedian",
  other: "Other"
};

function toArtistType(value: string): (typeof ARTIST_TYPE_OPTIONS)[number]["value"] {
  return ARTIST_TYPE_OPTIONS.some((option) => option.value === value)
    ? (value as (typeof ARTIST_TYPE_OPTIONS)[number]["value"])
    : "artist";
}

function toArtistTypeFilter(value: string): "all" | (typeof ARTIST_TYPE_OPTIONS)[number]["value"] {
  if (value === "all") return "all";
  return toArtistType(value);
}

function sortArtistOptions(items: ArtistOption[]): ArtistOption[] {
  return [...items].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function mergeArtistOptions(current: ArtistOption[], incoming: ArtistOption[]): ArtistOption[] {
  const byId = new Map(current.map((artist) => [artist.id, artist]));
  incoming.forEach((artist) => {
    byId.set(artist.id, artist);
  });
  return sortArtistOptions(Array.from(byId.values()));
}

function getLinkedArtistSelection(defaultValues?: EventSummary): { ids: string[]; names: string[] } {
  if (!Array.isArray((defaultValues as any)?.artists)) {
    return { ids: [], names: [] };
  }

  const ids: string[] = [];
  const names: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  ((defaultValues as any).artists as any[]).forEach((entry) => {
    const artistValue = Array.isArray(entry?.artist) ? entry.artist[0] : entry?.artist;
    const artistId = typeof artistValue?.id === "string" ? artistValue.id : null;
    const artistName = typeof artistValue?.name === "string" ? artistValue.name.trim() : null;

    if (artistId && !seenIds.has(artistId)) {
      seenIds.add(artistId);
      ids.push(artistId);
    }
    if (artistName) {
      const key = artistName.toLowerCase();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        names.push(artistName);
      }
    }
  });

  return { ids, names };
}

export function EventForm({
  mode,
  defaultValues,
  venues,
  artists,
  eventTypes,
  role,
  userVenueId,
  initialStartAt,
  initialEndAt,
  initialVenueId,
  sidebar,
  users,
  canDelete = false
}: EventFormProps) {
  const [draftState, draftAction, isSavingPending] = useActionState(saveEventDraftAction, undefined);
  const [submitState, submitAction, isSubmittingPending] = useActionState(submitEventForReviewAction, undefined);
  const [websiteCopyState, websiteCopyAction, isGeneratingEditPending] = useActionState(generateWebsiteCopyAction, undefined);
  const [websiteCopyFormState, websiteCopyFormAction, isGeneratingFormPending] = useActionState(generateWebsiteCopyFromFormAction, undefined);
  const isGeneratingPending = isGeneratingEditPending || isGeneratingFormPending;
  const activeWebsiteCopyAction = mode === "create" ? websiteCopyFormAction : websiteCopyAction;
  const [termsState, termsAction] = useActionState(generateTermsAndConditionsAction, undefined);
  const [artistCreateState, createArtistFormAction] = useActionState(createArtistAction, undefined);
  const [intent, setIntent] = useState<"draft" | "submit" | "generate">("draft");
  const [activeTab, setActiveTab] = useState("event-details");
  const [isDirty, setIsDirty] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showArtistModal, setShowArtistModal] = useState(false);
  const [artistSearch, setArtistSearch] = useState("");
  const [artistTypeFilter, setArtistTypeFilter] = useState<"all" | (typeof ARTIST_TYPE_OPTIONS)[number]["value"]>("all");
  const [showCreateArtistForm, setShowCreateArtistForm] = useState(false);
  const [newArtistName, setNewArtistName] = useState("");
  const [newArtistType, setNewArtistType] = useState<(typeof ARTIST_TYPE_OPTIONS)[number]["value"]>("artist");
  const [newArtistEmail, setNewArtistEmail] = useState("");
  const [newArtistPhone, setNewArtistPhone] = useState("");
  const [newArtistDescription, setNewArtistDescription] = useState("");
  const [allowsWalkIns, setAllowsWalkIns] = useState<"" | "yes" | "no">("");
  const [refundAllowed, setRefundAllowed] = useState<"" | "yes" | "no">("");
  const [rescheduleAllowed, setRescheduleAllowed] = useState<"" | "yes" | "no">("");
  const [termsExtraNotes, setTermsExtraNotes] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSlow, setIsSlow] = useState(false);

  // Legacy collapsible sections (create mode only)
  const [sectionOpen, setSectionOpen] = useState({
    core: true,
    timing: true,

[truncated at line 200 — original has 2127 lines]
```

### `src/components/events/propose-event-form.tsx`

```
"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { proposeEventAction } from "@/actions/pre-event";
import { VenueMultiSelect, type VenueOption } from "@/components/venues/venue-multi-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

type ProposeEventFormProps = {
  venues: VenueOption[];
  /**
   * Optional pre-selected venue id. When provided and matching a venue in
   * `venues`, the form opens with that venue already ticked. Used to give
   * office workers a sensible default without restricting the picker.
   */
  defaultVenueId?: string | null;
};

export function ProposeEventForm({ venues, defaultVenueId }: ProposeEventFormProps) {
  const [state, formAction] = useActionState(proposeEventAction, undefined);
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>(() => {
    if (defaultVenueId && venues.some((v) => v.id === defaultVenueId)) {
      return [defaultVenueId];
    }
    return venues.length === 1 ? [venues[0].id] : [];
  });
  const router = useRouter();

  useEffect(() => {
    if (state?.message) {
      if (state.success) {
        toast.success(state.message);
        router.push("/events");
      } else {
        toast.error(state.message);
      }
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="propose-title">Event title</Label>
        <Input id="propose-title" name="title" required maxLength={200} placeholder="e.g. Easter Weekend Quiz" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="propose-start">When is it?</Label>
        <Input id="propose-start" name="startAt" type="datetime-local" required />
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-[var(--color-text)]">Which venues?</span>
        <VenueMultiSelect
          venues={venues}
          selectedIds={selectedVenueIds}
          onChange={setSelectedVenueIds}
          hiddenFieldName="venueIds"
        />
        {selectedVenueIds.length === 0 ? (
          <p className="text-xs text-[var(--color-danger)]">Pick at least one venue.</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="propose-notes">Short description</Label>
        <Textarea
          id="propose-notes"
          name="notes"
          rows={4}
          required
          maxLength={2000}
          placeholder="A sentence or two about the idea — the admin will use this to decide whether to green-light it."
        />
      </div>

      <SubmitButton
        label="Submit proposal"
        pendingLabel="Submitting..."
        variant="primary"
      />
    </form>
  );
}
```

### `src/lib/auth/__tests__/rbac.test.ts`

```
/**
 * Tests for src/lib/auth.ts — RBAC helpers and API route wrappers.
 * Tests for src/lib/roles.ts — capability functions.
 *
 * Mock strategy:
 * - @/lib/supabase/server is mocked so no real Supabase client is created.
 * - next/navigation redirect is mocked to capture calls without throwing.
 * - All tests reset mock state in beforeEach.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock: next/navigation ────────────────────────────────────────────────────
// next/navigation's redirect() throws a special Next.js error in production so
// execution halts after the call — replicate that here so requireAdmin's guard
// clauses work correctly in tests.
vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  })
}));

// ─── Mock: @/lib/supabase/server ─────────────────────────────────────────────
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn()
}));

import { redirect } from "next/navigation";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";

import {
  getCurrentUser,
  requireAdmin,
  requireAuth,
  withAdminAuth,
  withAdminAuthAndCSRF,
  withAuth,
  withAuthAndCSRF
} from "@/lib/auth";
import type { AppUser } from "@/lib/types";
import {
  isAdministrator,
  canProposeEvents,
  canEditEvent,
  type EventEditContext,
  canViewEvents,
  canReviewEvents,
  canManageBookings,
  canManageCustomers,
  canManageArtists,
  canCreateDebriefs,
  canEditDebrief,
  canViewDebriefs,
  canCreatePlanningItems,
  canManageOwnPlanningItems,
  canManageAllPlanning,
  canViewPlanning,
  canManageVenues,
  canManageUsers,
  canManageSettings,
  canManageLinks,
  canViewSopTemplate,
  canEditSopTemplate,
} from "@/lib/roles";

// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockCreateClient = createSupabaseReadonlyClient as ReturnType<typeof vi.fn>;
const mockRedirect = redirect as unknown as ReturnType<typeof vi.fn>;

/**
 * Build a minimal Supabase client double.
 * `authUser`  — the value returned by auth.getUser()  (null = no session)
 * `dbProfile` — the value returned by the users table query (null = no row)
 */
function makeSupabaseClient(
  authUser: { id: string } | null,
  dbProfile: {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    venue_id: string | null;
    deactivated_at: string | null;
  } | null
) {
  // Chain: supabase.from('users').select(...).eq(...).maybeSingle()
  const maybeSingle = vi.fn().mockResolvedValue({ data: dbProfile });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } })
    },
    from
  };

  return client;
}

/** Convenience: a fully valid administrator profile row. */
const validAdminProfile = {
  id: "user-1",
  email: "admin@example.com",
  full_name: "Test Admin",
  role: "administrator",
  venue_id: null,
  deactivated_at: null
};

/** Convenience: the expected AppUser produced from validAdminProfile. */
const validAdminUser: AppUser = {
  id: "user-1",
  email: "admin@example.com",
  fullName: "Test Admin",
  role: "administrator",
  venueId: null,
  deactivatedAt: null
};

/** Build a valid CSRF request with matching cookie and header. */
function makeCSRFRequest(
  token: string,
  overrides?: { cookie?: string; header?: string | null }
): Request {
  const cookie =
    overrides?.cookie !== undefined
      ? overrides.cookie
      : `csrf-token=${token}`;
  const headers: Record<string, string> = {
    cookie,
    ...(overrides?.header !== undefined && overrides.header !== null
      ? { "x-csrf-token": overrides.header }
      : overrides?.header === null
        ? {}
        : { "x-csrf-token": token })
  };
  return new Request("http://localhost/test", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getCurrentUser ───────────────────────────────────────────────────────────

describe("getCurrentUser", () => {
  it("returns null when supabase auth returns no user", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient(null, null));

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });

  it("returns null when the users table profile is not found", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, null)
    );

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });

  it("returns null when the profile has an unrecognised role (fail-closed)", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-1" },
        {
          id: "user-1",
          email: "rogue@example.com",
          full_name: null,
          role: "super_admin", // not in the allowed set
          venue_id: null,
          deactivated_at: null
        }
      )
    );

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });

  it("returns a correctly shaped AppUser when role is valid", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
    );

    const result = await getCurrentUser();

    expect(result).toEqual(validAdminUser);
  });
});

// ─── normalizeRole (exercised via getCurrentUser) ─────────────────────────────

[truncated at line 200 — original has 875 lines]
```

### `src/lib/events/__tests__/edit-context.test.ts`

```
import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import { loadEventEditContext } from "../edit-context";

describe("loadEventEditContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns projected context on success", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "e1",
        venue_id: "v1",
        manager_responsible_id: "u1",
        created_by: "u2",
        status: "approved",
        deleted_at: null,
      },
      error: null,
    });

    const result = await loadEventEditContext("e1");
    expect(result).toEqual({
      venueId: "v1",
      managerResponsibleId: "u1",
      createdBy: "u2",
      status: "approved",
      deletedAt: null,
    });
    expect(selectMock).toHaveBeenCalledWith(
      "id, venue_id, manager_responsible_id, created_by, status, deleted_at",
    );
  });

  it("returns null when row is missing", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadEventEditContext("e-missing")).toBeNull();
  });

  it("returns null and logs on DB error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    expect(await loadEventEditContext("e-err")).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      "loadEventEditContext: DB error",
      expect.objectContaining({ eventId: "e-err" }),
    );
    errSpy.mockRestore();
  });
});
```

### `src/lib/events/edit-context.ts`

```
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canEditEvent, type EventEditContext } from "@/lib/roles";
import type { UserRole } from "@/lib/types";

export type EventRowForEdit = {
  id: string;
  venue_id: string | null;
  manager_responsible_id: string | null;
  created_by: string | null;
  status: string | null;
  deleted_at: string | null;
};

/**
 * Load the minimum event projection required by canEditEvent.
 * Uses the admin client so permission decisions are made against the true row,
 * not an RLS-filtered view. Returns null when the event does not exist or
 * when the query errors (errors are logged).
 */
export async function loadEventEditContext(
  eventId: string,
): Promise<EventEditContext | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("events")
    .select("id, venue_id, manager_responsible_id, created_by, status, deleted_at")
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    console.error("loadEventEditContext: DB error", { eventId, error });
    return null;
  }
  if (!data) return null;

  return {
    venueId: data.venue_id,
    managerResponsibleId: data.manager_responsible_id,
    createdBy: data.created_by,
    status: data.status,
    deletedAt: data.deleted_at,
  };
}

/** Synchronous helper for UI/list gating when the row is already loaded. */
export function canEditEventFromRow(
  user: { id: string; role: UserRole; venueId: string | null },
  row: EventRowForEdit,
): boolean {
  return canEditEvent(user.role, user.id, user.venueId, {
    venueId: row.venue_id,
    managerResponsibleId: row.manager_responsible_id,
    createdBy: row.created_by,
    status: row.status,
    deletedAt: row.deleted_at,
  });
}
```

### `src/lib/roles.ts`

```
import type { UserRole } from "./types";

/**
 * Role capability model — FINAL (3-role)
 *
 * administrator — full platform access
 * office_worker — venue-scoped write (if venueId set) or global read-only (if no venueId)
 * executive     — read-only observer
 *
 * Functions accepting venueId use it as a capability switch:
 * office_worker + venueId = venue-scoped write access
 * office_worker + no venueId = read-only access
 */

/** Convenience: check if user is an administrator */
export function isAdministrator(role: UserRole): boolean {
  return role === "administrator";
}

/** Can propose or submit an event (any venue; admin triages). */
export function canProposeEvents(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Context an edit check needs about the event being edited. */
export type EventEditContext = {
  venueId: string | null;
  managerResponsibleId: string | null;
  createdBy: string | null;
  status: string | null;
  deletedAt: string | null;
};

/** Can edit a specific event. Defence-in-depth: also enforced at RLS + trigger. */
export function canEditEvent(
  role: UserRole,
  userId: string,
  userVenueId: string | null,
  event: EventEditContext,
): boolean {
  if (event.deletedAt !== null) {
    return role === "administrator";
  }

  if (role === "administrator") return true;
  if (role !== "office_worker") return false;

  if (
    event.createdBy === userId &&
    (event.status === "draft" || event.status === "needs_revisions")
  ) {
    return true;
  }

  if (!userVenueId) return false;
  if (event.venueId !== userVenueId) return false;
  if (event.managerResponsibleId !== userId) return false;
  if (event.status !== "approved" && event.status !== "cancelled") return false;
  return true;
}

/** Can view events (all roles) */
export function canViewEvents(role: UserRole): boolean {
  return true;
}

/** Can make review/approval decisions on events */
export function canReviewEvents(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage bookings (admin always; office_worker only with venueId) */
export function canManageBookings(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can manage customers (admin always; office_worker only with venueId) */
export function canManageCustomers(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can manage artists (admin always; office_worker only with venueId) */
export function canManageArtists(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can create debriefs (admin always; office_worker only with venueId) */
export function canCreateDebriefs(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can edit a debrief. Admin always; office_worker only if they are the submitted_by user. */
export function canEditDebrief(role: UserRole, isCreator: boolean): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && isCreator) return true;
  return false;
}

/** Can view/read debriefs (all roles) */
export function canViewDebriefs(role: UserRole): boolean {
  return true;
}

/** Can create new planning items */
export function canCreatePlanningItems(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can edit/delete own planning items (admin can manage any) */
export function canManageOwnPlanningItems(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can manage all planning items regardless of owner */
export function canManageAllPlanning(role: UserRole): boolean {
  return role === "administrator";
}

/** Can view the planning workspace */
export function canViewPlanning(role: UserRole): boolean {
  return true;
}

/** Can manage venues */
export function canManageVenues(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage users (invite, update roles) */
export function canManageUsers(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage event types and system settings */
export function canManageSettings(role: UserRole): boolean {
  return role === "administrator";
}

/** Can create, edit, or delete short links and manage QR codes */
export function canManageLinks(role: UserRole): boolean {
  return role === "administrator";
}

/** Can view the SOP template configuration */
export function canViewSopTemplate(role: UserRole): boolean {
  return role === "administrator" || role === "executive";
}

/** Can create, edit, or delete SOP template sections and tasks */
export function canEditSopTemplate(role: UserRole): boolean {
  return role === "administrator";
}
```

### `supabase/migrations/20260420170000_office_worker_event_scope.sql`

```
-- =============================================================================
-- Office worker propose/edit scope — SELECT/UPDATE RLS + sensitive-updates
-- trigger + event_artists policy replacement.
-- Spec: docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md
-- =============================================================================

-- ─── public.events: SELECT (global for all three roles) ─────────────────────
DROP POLICY IF EXISTS "events_select_policy" ON public.events;
CREATE POLICY "events_select_policy"
  ON public.events
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.current_user_role() IN ('administrator', 'executive', 'office_worker')
  );

-- ─── public.events: UPDATE (creator-draft scoped to admin/OW;
--                              manager branch scoped to approved/cancelled) ──
DROP POLICY IF EXISTS "managers update editable events" ON public.events;
CREATE POLICY "managers update editable events"
  ON public.events
  FOR UPDATE
  USING (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions')
    )
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
      AND status IN ('approved', 'cancelled')
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions', 'pending_approval')
    )
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
      AND status IN ('approved', 'cancelled')
    )
  );

-- ─── Sensitive-column + status-transition trigger ────────────────────────────
CREATE OR REPLACE FUNCTION public.events_guard_sensitive_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := public.current_user_role();
  IF v_role = 'administrator' THEN
    RETURN NEW;
  END IF;

  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.venue_id';
  END IF;
  IF NEW.manager_responsible_id IS DISTINCT FROM OLD.manager_responsible_id THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.manager_responsible_id';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.created_by';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft'              AND NEW.status = 'pending_approval')
      OR (OLD.status = 'needs_revisions' AND NEW.status = 'pending_approval')
      OR (OLD.status = 'approved'        AND NEW.status = 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Non-admin users cannot transition event status from % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_guard_sensitive_updates ON public.events;
CREATE TRIGGER events_guard_sensitive_updates
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_guard_sensitive_updates();

-- ─── public.event_artists: SELECT (follow events global visibility) ─────────
DROP POLICY IF EXISTS "event artists visible with event" ON public.event_artists;
CREATE POLICY "event artists visible with event"
  ON public.event_artists
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.deleted_at IS NULL
        AND public.current_user_role() IN ('administrator', 'office_worker', 'executive')
    )
  );

-- ─── public.event_artists: FOR ALL (tightened to match canEditEvent) ────────
DROP POLICY IF EXISTS "event artists managed by event editors" ON public.event_artists;
CREATE POLICY "event artists managed by event editors"
  ON public.event_artists
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_role() = 'administrator'
          OR (
            public.current_user_role() = 'office_worker'
            AND auth.uid() = e.created_by
            AND e.status IN ('draft', 'needs_revisions')
          )
          OR (
            public.current_user_role() = 'office_worker'
            AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
            AND e.venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
            AND e.manager_responsible_id = auth.uid()
            AND e.status IN ('approved', 'cancelled')
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_role() = 'administrator'
          OR (
            public.current_user_role() = 'office_worker'
            AND auth.uid() = e.created_by
            AND e.status IN ('draft', 'needs_revisions')
          )
          OR (
            public.current_user_role() = 'office_worker'
            AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
            AND e.venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
            AND e.manager_responsible_id = auth.uid()
            AND e.status IN ('approved', 'cancelled')
          )
        )
    )
  );
```

### `supabase/migrations/20260420170500_propose_any_venue.sql`

```
-- =============================================================================
-- Proposal RPC — drop office_worker venue restrictions, add active venue
-- validation, make idempotency re-entrant on crash-after-claim.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_multi_venue_event_proposals(
  p_payload jsonb,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch_id uuid;
  v_existing jsonb;
  v_created_by uuid;
  v_user_role text;
  v_user_venue uuid;
  v_user_deactivated timestamptz;
  v_venue_ids uuid[];
  v_primary_venue uuid;
  v_event_id uuid;
  v_result jsonb;
BEGIN
  INSERT INTO public.event_creation_batches (idempotency_key, created_by, batch_payload)
  VALUES (p_idempotency_key, (p_payload->>'created_by')::uuid, p_payload)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_batch_id;

  IF v_batch_id IS NULL THEN
    SELECT result, id INTO v_existing, v_batch_id
    FROM public.event_creation_batches
    WHERE idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
    -- WF-001 v3.1: re-entrant. Previous call claimed the batch but crashed
    -- before storing result. Fall through and re-run; the UPDATE at the end
    -- stamps the result so the next retry is a no-op success.
  END IF;

  v_created_by := (p_payload->>'created_by')::uuid;
  SELECT role, venue_id, deactivated_at INTO v_user_role, v_user_venue, v_user_deactivated
  FROM public.users WHERE id = v_created_by;

  IF v_user_deactivated IS NOT NULL THEN
    RAISE EXCEPTION 'Deactivated users cannot propose events';
  END IF;
  IF v_user_role NOT IN ('administrator', 'office_worker') THEN
    RAISE EXCEPTION 'User role % cannot propose events', v_user_role;
  END IF;
  -- REMOVED: v_user_venue IS NULL check.
  -- REMOVED: per-venue loop rejecting cross-venue proposals.

  v_venue_ids := (SELECT array_agg((x)::uuid) FROM jsonb_array_elements_text(p_payload->'venue_ids') x);
  IF v_venue_ids IS NULL OR array_length(v_venue_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Proposals require at least one venue';
  END IF;

  -- R-013 / SEC v3.1: reject missing or soft-deleted venues.
  IF EXISTS (
    SELECT 1 FROM unnest(v_venue_ids) AS submitted(id)
    LEFT JOIN public.venues v ON v.id = submitted.id AND v.deleted_at IS NULL
    WHERE v.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more submitted venues are invalid or deleted';
  END IF;

  v_primary_venue := v_venue_ids[1];
  v_event_id := gen_random_uuid();

  INSERT INTO public.events (
    id, venue_id, created_by, title,
    event_type, venue_space, start_at, end_at,
    notes, status
  ) VALUES (
    v_event_id, v_primary_venue, v_created_by, p_payload->>'title',
    NULL, NULL,
    (p_payload->>'start_at')::timestamptz,
    NULL,
    p_payload->>'notes',
    'pending_approval'
  );

  INSERT INTO public.event_venues (event_id, venue_id, is_primary)
  SELECT v_event_id, v, v = v_primary_venue
  FROM unnest(v_venue_ids) AS v;

  INSERT INTO public.audit_log (entity, entity_id, action, meta, actor_id)
  VALUES (
    'event', v_event_id, 'event.created',
    jsonb_build_object(
      'multi_venue_batch_id', v_batch_id,
      'venue_ids', v_venue_ids,
      'via', 'create_multi_venue_event_proposals'
    ),
    v_created_by
  );

  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'event_id', v_event_id,
    'venue_ids', v_venue_ids
  );

  UPDATE public.event_creation_batches SET result = v_result WHERE id = v_batch_id;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.create_multi_venue_event_proposals(jsonb, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.create_multi_venue_event_proposals(jsonb, uuid) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.create_multi_venue_event_proposals(jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
```

### `supabase/migrations/20260420171000_reject_event_proposal_rpc.sql`

```
-- =============================================================================
-- reject_event_proposal — atomic insert approval row + update event status.
-- Replaces the two-step non-atomic flow in preRejectEventAction.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reject_event_proposal(
  p_event_id uuid,
  p_admin_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_ok boolean;
  v_rows int;
BEGIN
  -- Validate p_admin_id is a real active administrator (AB-006 v2 / SEC v3.1).
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_admin_id AND role = 'administrator' AND deactivated_at IS NULL
  ) INTO v_admin_ok;
  IF NOT v_admin_ok THEN
    RAISE EXCEPTION 'Caller % is not an active administrator', p_admin_id;
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  INSERT INTO public.approvals (event_id, reviewer_id, decision, feedback_text)
  VALUES (p_event_id, p_admin_id, 'rejected', p_reason);

  UPDATE public.events
  SET status = 'rejected'
  WHERE id = p_event_id AND status = 'pending_approval';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Event % not in pending_approval', p_event_id;
  END IF;
END;
$$;

ALTER FUNCTION public.reject_event_proposal(uuid, uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reject_event_proposal(uuid, uuid, text) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_event_proposal(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
```

### `supabase/migrations/__tests__/office_worker_event_scope.test.ts`

```
/**
 * Migration integration tests for office_worker event scope.
 *
 * Covers:
 *   - 20260420170000_office_worker_event_scope.sql (RLS + trigger + event_artists)
 *   - 20260420170500_propose_any_venue.sql (proposal RPC)
 *   - 20260420171000_reject_event_proposal_rpc.sql (atomic reject RPC)
 *
 * These tests require a live Supabase instance with the migrations applied and
 * are gated behind the `RUN_MIGRATION_INTEGRATION_TESTS=1` env var. They are
 * skipped in the default test run so CI / unit-test loops are unaffected.
 *
 * Required env:
 *   RUN_MIGRATION_INTEGRATION_TESTS=1
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_OW_JWT              (JWT for an office_worker WITH a venue_id)
 *   SUPABASE_OTHER_OW_JWT        (JWT for a different office_worker at a different venue)
 *
 * All other fixtures (users, venues, pending event) are created in beforeAll
 * using the service-role client and cleaned up in afterAll.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const OW_JWT = process.env.SUPABASE_OW_JWT ?? "";
const OTHER_OW_JWT = process.env.SUPABASE_OTHER_OW_JWT ?? "";
const RUN_FLAG = process.env.RUN_MIGRATION_INTEGRATION_TESTS === "1";

const shouldRun =
  RUN_FLAG && Boolean(SUPABASE_URL) && Boolean(SERVICE_ROLE) && Boolean(OW_JWT) && Boolean(OTHER_OW_JWT);

// Anon key is only used for authenticated-session client construction; any valid
// anon key works for JWT-auth headers since the bearer token overrides it.
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? SERVICE_ROLE;

function serviceRoleClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function jwtClient(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Fixture = {
  venueA: string;
  venueB: string;
  venueDeleted: string;
  owId: string; // office_worker at venueA (has the SUPABASE_OW_JWT)
  otherOwId: string; // office_worker at venueB (has the SUPABASE_OTHER_OW_JWT)
  owNoVenueId: string; // office_worker with venue_id = null
  pendingEventId: string; // event in pending_approval for reject RPC test
  createdEventIds: string[];
  createdBatchKeys: string[];
};

const describeFn = shouldRun ? describe : describe.skip;

describeFn("migration: office_worker_event_scope", () => {
  let admin: SupabaseClient;
  const fx: Fixture = {
    venueA: "",
    venueB: "",
    venueDeleted: "",
    owId: "",
    otherOwId: "",
    owNoVenueId: "",
    pendingEventId: "",
    createdEventIds: [],
    createdBatchKeys: [],
  };

  beforeAll(async () => {
    admin = serviceRoleClient();

    // --- Resolve OW user ids from their JWTs -------------------------------
    // We use auth.getUser(jwt) via service-role admin to avoid relying on
    // shape of custom claims.
    const owUser = await admin.auth.getUser(OW_JWT);
    const otherOwUser = await admin.auth.getUser(OTHER_OW_JWT);
    if (owUser.error || !owUser.data.user) {
      throw new Error(`SUPABASE_OW_JWT is invalid: ${owUser.error?.message ?? "no user"}`);
    }
    if (otherOwUser.error || !otherOwUser.data.user) {
      throw new Error(
        `SUPABASE_OTHER_OW_JWT is invalid: ${otherOwUser.error?.message ?? "no user"}`,
      );
    }
    fx.owId = owUser.data.user.id;
    fx.otherOwId = otherOwUser.data.user.id;

    // --- Look up / verify venues for both OWs ------------------------------
    const { data: owRow, error: owRowErr } = await admin
      .from("users")
      .select("venue_id, role")
      .eq("id", fx.owId)
      .single();
    if (owRowErr || !owRow) throw new Error(`Cannot load OW user row: ${owRowErr?.message}`);
    if (owRow.role !== "office_worker" || !owRow.venue_id) {
      throw new Error("SUPABASE_OW_JWT must be for an office_worker WITH a venue_id");
    }
    fx.venueA = owRow.venue_id as string;

    const { data: otherRow, error: otherRowErr } = await admin
      .from("users")
      .select("venue_id, role")
      .eq("id", fx.otherOwId)
      .single();
    if (otherRowErr || !otherRow) throw new Error(`Cannot load other OW user row: ${otherRowErr?.message}`);
    if (otherRow.role !== "office_worker" || !otherRow.venue_id) {
      throw new Error("SUPABASE_OTHER_OW_JWT must be for an office_worker WITH a venue_id");
    }
    if (otherRow.venue_id === fx.venueA) {
      throw new Error("SUPABASE_OW_JWT and SUPABASE_OTHER_OW_JWT must be at different venues");
    }
    fx.venueB = otherRow.venue_id as string;

    // --- Find-or-create an office_worker with NO venue_id -----------------
    const { data: noVenueRow } = await admin
      .from("users")
      .select("id")
      .eq("role", "office_worker")
      .is("venue_id", null)
      .is("deactivated_at", null)
      .limit(1)
      .maybeSingle();
    if (noVenueRow?.id) {
      fx.owNoVenueId = noVenueRow.id as string;
    } else {
      // Insert a placeholder users row (auth row not required for RPC venue loop).
      const id = crypto.randomUUID();
      const { error } = await admin.from("users").insert({
        id,
        role: "office_worker",
        venue_id: null,
        email: `office-worker-novenue-${id.slice(0, 8)}@example.test`,
        full_name: "Office Worker (no venue) — test fixture",
      });
      if (error) throw new Error(`Cannot provision no-venue OW: ${error.message}`);
      fx.owNoVenueId = id;
    }

    // --- Soft-deleted venue fixture ---------------------------------------
    const { data: delVenue, error: delVenueErr } = await admin
      .from("venues")
      .insert({
        name: "DELETED fixture venue",
        deleted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (delVenueErr || !delVenue) throw new Error(`Cannot create deleted venue: ${delVenueErr?.message}`);
    fx.venueDeleted = delVenue.id as string;

    // --- Pending-approval event for reject RPC test ------------------------
    const { data: pending, error: pendingErr } = await admin
      .from("events")
      .insert({
        title: "reject-fixture",
        venue_id: fx.venueA,
        created_by: fx.owId,
        status: "pending_approval",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (pendingErr || !pending) throw new Error(`Cannot create pending event: ${pendingErr?.message}`);
    fx.pendingEventId = pending.id as string;
    fx.createdEventIds.push(fx.pendingEventId);
  });

  afterAll(async () => {
    if (!shouldRun) return;
    // Best-effort cleanup; ignore individual errors.
    for (const id of fx.createdEventIds) {
      await admin.from("events").delete().eq("id", id);
    }
    for (const key of fx.createdBatchKeys) {
      await admin.from("event_creation_batches").delete().eq("idempotency_key", key);
    }
    if (fx.venueDeleted) {
      await admin.from("venues").delete().eq("id", fx.venueDeleted);
    }
    // Note: we do NOT delete the no-venue OW row as it may pre-exist; leave cleanup
    // to the environment seed script.
  });

  // ─────────────────────────────────────────────────────────────────────
  // TRIGGER: sensitive-column + status-transition
  // ─────────────────────────────────────────────────────────────────────

  it("non-admin cannot change venue_id (trigger)", async () => {

[truncated at line 200 — original has 419 lines]
```

### `tasks/implement-plan/2026-04-20-office-worker-propose-edit/wave-1/M1/handoff.md`

```
# M1 Handoff — Database Migrations & Integration Tests

**Agent:** M1 (Database Migrations & Integration Tests)
**Date:** 2026-04-18
**Plan:** `docs/superpowers/plans/2026-04-18-office-worker-propose-edit.md` — Tasks 4, 5, 6, 7.
**Status:** Migrations + tests written; syntax verified; migrations NOT applied (local Supabase unavailable).

---

## Deliverables

| File | Status |
|------|--------|
| `supabase/migrations/20260420170000_office_worker_event_scope.sql` | Written, dry-run parse OK |
| `supabase/migrations/20260420170500_propose_any_venue.sql` | Written, dry-run parse OK |
| `supabase/migrations/20260420171000_reject_event_proposal_rpc.sql` | Written, dry-run parse OK |
| `supabase/migrations/__tests__/office_worker_event_scope.test.ts` | Written; 10 tests, gated `describe.skip` |
| `tasks/implement-plan/2026-04-20-office-worker-propose-edit/wave-1/M1/handoff.md` | This file |

SQL is copy-pasted verbatim from the plan's Task 4, 5, 6 blocks — no rewrites.

## Verification performed

- `npx supabase db push --dry-run` → exit 0, lists all three migrations (remote server only; no schema change).
- `npx tsc --noEmit` on the test file → clean.
- `npx eslint` on the test file → clean.
- `npx vitest run supabase/migrations/__tests__/office_worker_event_scope.test.ts` → 10 tests skipped (expected, gated).
- `npx vitest run` full suite → **599 passed, 10 skipped** — no regressions.

## Migrations NOT applied

Reason: The local Supabase stack is not running (Docker daemon is down), and `.env.local` points to the remote project `shofawaztmdxytukhozo.supabase.co`. Applying these migrations via `npx supabase db push` would push to the real backing database, which falls under the "explicit approval" bar in the project's safety rules (RLS replacement + trigger creation + RPC body swap). Per the agent brief, this is the documented fallback: migrations are written and parse-checked, application is left to the next step.

**Action for next operator:** When Docker is running or you are explicitly authorised to push to the linked project, run `npx supabase db push`. The dry-run output confirms the three files will be picked up in the correct order.

## Fixture assumptions (integration tests)

The 10 integration tests are defence-in-depth sanity checks; they hit a live Supabase with the migrations applied. Running them requires these env vars (all four gate the suite):

- `RUN_MIGRATION_INTEGRATION_TESTS=1`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional; falls back to service role for client construction)
- `SUPABASE_OW_JWT` — a valid JWT for an `office_worker` user whose `users.venue_id` is set
- `SUPABASE_OTHER_OW_JWT` — a valid JWT for a **different** `office_worker` at a **different** venue

If any are missing, `describe.skip` takes over and the suite passes silently. This is intentional: the project does not yet have a reusable live-DB fixture harness, and dummy fixtures baked into the test file would require writing a whole auth bootstrap. `beforeAll` bootstraps the remaining fixtures against service role:

- Resolves `owId` / `otherOwId` from their JWTs via `admin.auth.getUser()`.
- Reads `venueA` / `venueB` from each OW's `users.venue_id`; asserts they are distinct.
- Finds or provisions an `office_worker` row with `venue_id = null` for the cross-venue RPC test.
- Creates a soft-deleted venue for the "deleted venue" RPC test.
- Creates a `pending_approval` event for the reject-RPC test.

`afterAll` deletes events and batch rows created during the run. Soft-deleted fixture venue is also cleaned up. No-venue OW row is intentionally left in place (likely pre-seeded and shared with other tests).

## Self-check

- [x] SQL matches the plan's exact text (verified by re-reading the plan after writing).
- [x] "managers create events" INSERT policy from `20250218000000_initial_mvp.sql:190` was NOT modified.
- [x] Proposal RPC preserves the `GRANT EXECUTE ... TO service_role` line.
- [x] `reject_event_proposal` validates `p_admin_id` against the `users` table and raises on non-admin.
- [x] Handoff honestly reports the "migrations not applied + tests skipped" status with reason.
- [x] No TypeScript files in `src/` were touched. Only the test file under `supabase/migrations/__tests__/` was added (that's SQL-tier owned by M1 per the brief).

## Commits produced

1. `feat(rls): office-worker event scope (SELECT/UPDATE + sensitive-updates trigger + event_artists)` — migration 1 only
2. `feat(rpc): proposal RPC any-venue + venue validation + re-entrant idempotency` — migration 2 only
3. `feat(rpc): atomic reject_event_proposal with admin validation` — migration 3 only
4. `test(rls): migration integration tests for office_worker event scope` — test file + this handoff

Each migration is in its own commit per the plan. Tests + handoff are the fourth commit.
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
.env.example
.superpowers/brainstorm/12205-1773404341/approaches.html
.superpowers/brainstorm/12205-1773404341/desktop-treatment.html
.superpowers/brainstorm/12205-1773404341/desktop-v2.html
.superpowers/brainstorm/12205-1773404341/layouts-v2.html
.superpowers/brainstorm/12205-1773404341/layouts.html
.superpowers/brainstorm/27614-1773421793/colour-mapping.html
.superpowers/brainstorm/29906-1773426276/design-v2.html
.superpowers/brainstorm/29906-1773426276/design.html
.superpowers/brainstorm/69861-1773238741/board-placement.html
```

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — BaronsHub

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.1
- **Test runner**: Vitest
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: QR code generation, Email (Resend), public event API, event management
- **Size**: ~148 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check
npm run test             # Vitest run (single pass)
npm run test:watch       # Vitest watch mode
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run supabase:migrate # Apply pending migrations
npm run supabase:reset   # Reset database (linked, requires confirmation)
```

## Architecture

**Route Structure**: App Router with event management focus. Key sections:
- `/events` — Event browsing, listing (public and authenticated)
- `/admin` — Event creation, management, setup
- `/api/v1/events` — Public event API with rate limiting and auth

**Auth**: Supabase Auth with JWT + HTTP-only cookies. User context available in server and client components. Permission checks via `src/lib/` helpers.

**Database**: Supabase PostgreSQL with RLS. `src/lib/` contains data access helpers. `supabase/seed.sql` provides test data setup.

**Key Integrations**:
- **QR Codes**: `qrcode` library for event ticket generation
- **Email**: Resend for event notifications and confirmations
- **Public API**: `src/lib/public-api/` — rate-limited REST API for events
- **Notifications**: `src/lib/notifications.ts` — event alerts and reminders

**Data Flow**: Server actions for mutations (create/update/delete events). Server components for data fetching. All API responses validated with Zod. RLS enforces permission at database level.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (event models, API) |
| `src/lib/public-api/` | Rate-limited public REST API endpoints |
| `src/lib/public-api/rate-limit.ts` | API rate limiting (per IP/API key) |
| `src/lib/public-api/auth.ts` | API key validation |
| `src/lib/validation.ts` | Zod schemas for events, bookings, etc. |
| `src/lib/datetime.ts` | Date/time utilities for event scheduling |
| `src/lib/artists.ts` | Artist/performer data helpers |
| `src/lib/reviewers.ts` | Event reviewer/moderator logic |
| `src/lib/notifications.ts` | Email and notification dispatch |
| `src/app/api/v1/events` | Public event REST API |
| `src/actions/` | Server actions for mutations |
| `supabase/migrations/` | Database schema migrations |
| `supabase/seed.sql` | Database seed for testing |
| `vitest.config.ts` | Vitest configuration |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `RESEND_API_KEY` | Resend email service key |
| `BARONSHUB_WEBSITE_API_KEY` | BaronsHub website integration API key |

## Project-Specific Rules / Gotchas

### Public API
- Endpoints in `src/lib/public-api/events.ts` require rate limiting
- `src/lib/public-api/auth.ts` validates API keys (Bearer token or query param)
- All responses return `{ success: boolean; data?: T; error?: string }`
- Minimum 80% test coverage on API logic (see `src/lib/public-api/__tests__/`)

### Rate Limiting
- Per-IP limiting for anonymous requests
- Per-API-key limiting for authenticated requests
- Limits configurable in `src/lib/public-api/rate-limit.ts`
- Return 429 (Too Many Requests) when exceeded

### Event Model
- Events have status: `draft` → `published` → `completed`
- Optional artists/performers with bios
- Date/time handling via `src/lib/datetime.ts` (respects timezone)
- QR codes generated on demand (not pre-stored)

### Permissions
- Event creators can edit own events
- Administrators can moderate all events; office_workers can manage events at their venue
- Check permissions in both UI and server actions (defense in depth)
- RLS enforces at database level

### Auth Standard Deviation: Custom Role Model

**Deviation from workspace standard (auth-standard.md §7):** The workspace standard mandates three generic roles (`admin`, `editor`, `viewer`). This project uses three domain-specific roles approved for this application:

| Application Role | Maps to Standard Tier | Capabilities |
|---|---|---|
| `administrator` | `admin` | Full platform access, user management, all event operations |
| `office_worker` | `editor` | Venue-scoped write access (if venue_id set) or global read-only (if no venue_id); planning CRUD on own items; debrief create/edit (own) |
| `executive` | `viewer` | Read-only access to all events, planning, and reporting |

**Why:** Event management requires venue-scoped write access for some staff and global read-only for others, expressed through a single role with venue_id as the capability switch.

**Implementation notes:**
- Roles stored in `public.users.role` column (not Supabase `app_metadata`)
- Role helpers in `src/lib/roles.ts` use explicit capability functions with optional `venueId` parameter
- Permission checks use `role === "administrator"` for admin operations
- `venue_id` on the user record acts as a capability switch for office_worker
- All capability functions are in `src/lib/roles.ts`

### Email & Notifications
- `src/lib/notifications.ts` handles async dispatch
- Never await email sends in critical paths — queue for background jobs
- Use Resend templates for transactional emails

### Testing with Vitest
- Test API endpoints in `src/lib/public-api/__tests__/`
- Mock Resend and Supabase in tests
- Use `vitest.config.ts` for test setup (environment, ports, etc.)
- Run tests before pushing: `npm run test`

### QR Code Generation
- Use `qrcode` library (not `qrcode.react`)
- Generate QR codes server-side for ticket URLs
- Embed event ID and user ID in URL
- Cache generated QR images (optional, not required)

### Supabase Data Access
- Use service-role client only for system operations (migrations, seeding)
- Client operations use anon-key (respects RLS)
- Always wrap DB results with conversion helper (snake_case → camelCase)

### Database Seeding
- `supabase/seed.sql` creates test events and users
- Run seeding after `supabase db reset`
- Keep seed data minimal (fast test setup)

### Artist Logic
- `src/lib/artists.ts` — fetch artist info, bios, links
- `src/lib/reviewers.ts` — fetch reviewer assignments, approval status
- Always verify permissions via `src/lib/roles.ts` capability functions before allowing edits

### Datetime Handling
- Use `src/lib/datetime.ts` for all user-facing dates
- Store all times in UTC in database
- Convert to user's timezone on display
- See workspace CLAUDE.md for timezone conventions
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/supabase.md`

```markdown
# Supabase Conventions

## Client Patterns

Two Supabase client patterns — always use the correct one:

```typescript
// Server-side auth (anon key + cookie session) — use for auth checks:
const supabase = await getSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();

// Server-side data (service-role, bypasses RLS) — use for system/cron operations:
const db = await getDb(); // or createClient() with service role
const { data } = await db.from("table").select("*").eq("id", id).single();

// Browser-only (client components):
const supabase = getSupabaseBrowserClient();
```

ESLint rules should prevent importing the admin/service-role client in client components.

## snake_case ↔ camelCase Conversion

DB columns are always `snake_case`; TypeScript types are `camelCase` with Date objects. Always wrap DB results:

```typescript
import { fromDb } from "@/lib/utils";
const record = fromDb<MyType>(dbRow); // converts snake_case keys + ISO strings → Date
```

All type definitions should live in a central types file (e.g. `src/types/database.ts`).

## Row Level Security (RLS)

- RLS is always enabled on all tables
- Use the anon-key client for user-scoped operations (respects RLS)
- Use the service-role client only for system operations, crons, and webhooks
- Never disable RLS "temporarily" — create a proper service-role path instead

## Migrations

```bash
npx supabase db push          # Apply pending migrations
npx supabase migration new    # Create a new migration file
```

- Migrations live in `supabase/migrations/`
- Full schema reference in `supabase/schema.sql` (paste into SQL Editor for fresh setup)
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval
- Test migrations locally with `npx supabase db push --dry-run` before pushing (see `verification-pipeline.md`)

### Dropping columns or tables — mandatory function audit

When a migration drops a column or table, you MUST search for every function and trigger that references it and update them in the same migration. Failing to do so leaves silent breakage: PL/pgSQL functions that reference a dropped column/table throw an exception at runtime, and if any of those functions have an `EXCEPTION WHEN OTHERS THEN` handler, the error is swallowed and returned as a generic blocked/failure state — making the bug invisible until someone notices the feature is broken.

**Before writing any `DROP COLUMN` or `DROP TABLE`:**

```sql
-- Find all functions that reference the column or table
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_definition ILIKE '%column_or_table_name%'
  AND routine_type = 'FUNCTION';
```

Or search the migrations directory:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -l
```

For each function found: update it in the same migration to remove or replace the reference. Never leave a function referencing infrastructure that no longer exists.

This also applies to **triggers** — check trigger functions separately:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -n
```

## Auth

- Supabase Auth with JWT + HTTP-only cookies
- Auth checks happen in layout files or middleware
- Server actions must always re-verify auth server-side (never rely on UI hiding)
- Public routes must be explicitly allowlisted

## Audit Logging

All mutations (create, update, delete) in server actions must call `logAuditEvent()`:

```typescript
await logAuditEvent({
  user_id: user.id,
  operation_type: 'update',
  resource_type: 'thing',
  operation_status: 'success'
});
```
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/testing.md`

```markdown
# Testing Conventions

## Framework

- **Vitest** is the default test runner (not Jest)
- Test files live alongside source: `src/**/*.test.ts` or in a dedicated `tests/` directory
- **Playwright** for end-to-end testing where configured

## Commands

```bash
npm test              # Run tests once
npm run test:watch    # Watch mode (Vitest)
npm run test:ci       # With coverage report
npx vitest run src/lib/some-module.test.ts  # Run a single test file
```

## Patterns

- Use `describe` blocks grouped by function/component
- Test naming: `it('should [expected behaviour] when [condition]')`
- Prefer testing behaviour over implementation details
- Mock external services (Supabase, OpenAI, Twilio) — never hit real APIs in tests
- Use factories or fixtures for test data, not inline object literals

## Test Prioritisation

When adding tests to a feature, prioritise in this order:
1. **Server actions and business logic** — highest value, most likely to catch real bugs
2. **Data transformation utilities** — date formatting, snake_case conversion, parsers
3. **API route handlers** — input validation, error responses, auth checks
4. **Complex UI interactions** — forms, multi-step flows, conditional rendering
5. **Simple UI wrappers** — lowest priority, skip if time-constrained

Minimum per feature: happy path + at least 1 error/edge case.

## Mock Strategy

- **Always mock**: Supabase client, OpenAI/Azure OpenAI, Twilio, Stripe, PayPal, Microsoft Graph, external HTTP
- **Never mock**: Internal utility functions, date formatting, type conversion helpers
- **Use `vi.mock()`** for module-level mocks; `vi.spyOn()` for targeted function mocks
- Reset mocks between tests: `beforeEach(() => { vi.clearAllMocks() })`

## Coverage

- Business logic and server actions: target 90%
- API routes and data layers: target 80%
- UI components: target 70% (focus on interactive behaviour, not rendering)
- Don't chase coverage on trivial wrappers, type definitions, or config files

## Playwright (E2E)

- Local dev: uses native browser
- Production/CI: uses `BROWSERLESS_URL` env var for remote browser
- E2E tests should be independent (no shared state between tests)
- Use page object models for complex flows
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/ui-patterns.md`

```markdown
# UI Patterns & Component Standards

## Server vs Client Components

- Default to **Server Components** — only add `'use client'` when you need interactivity, hooks, or browser APIs
- Server Components can fetch data directly (no useEffect/useState for data loading)
- Client Components should receive data as props from server parents where possible

## Data Fetching & Display

Every data-driven UI must handle all three states:
1. **Loading** — skeleton loaders or spinners (not blank screens)
2. **Error** — user-facing error message or error boundary
3. **Empty** — meaningful empty state component (not just no content)

## Forms

- Use React Hook Form + Zod for validation where configured
- Validation errors displayed inline, not just console logs
- Required field indicators visible
- Loading/disabled state during submission (prevent double-submit)
- Server action errors surfaced to user via toast or inline message
- Form reset after successful submission where appropriate

## Buttons

Check every button for:
- Consistent variant usage (primary, secondary, destructive, ghost) — no ad-hoc Tailwind-only buttons
- Loading states on async actions (spinner/disabled during server action calls)
- Disabled states when form is invalid or submission in progress
- `type="button"` to prevent accidental form submission (use `type="submit"` only on submit buttons)
- Confirmation dialogs on destructive actions (delete, archive, bulk operations)
- `aria-label` on icon-only buttons

## Navigation

- Breadcrumbs on nested pages
- Active state on current nav item
- Back/cancel navigation returns to correct parent page
- New sections added to project navigation with correct permission gating
- Mobile responsiveness of all nav elements

## Permissions (RBAC)

- Every authenticated page must check permissions via the project's permission helper
- UI elements (edit, delete, create buttons) conditionally rendered based on permissions
- Server actions must re-check permissions server-side (never rely on UI hiding alone)

## Accessibility Baseline

These items are also enforced in the Definition of Done (`definition-of-done.md`):

- Interactive elements have visible focus styles
- Colour is not the only indicator of state
- Modal dialogs trap focus and close on Escape
- Tables use proper `<thead>`, `<th scope>` markup
- Images have meaningful `alt` text
- Keyboard navigation works for all interactive elements
```

---

_End of pack._
