import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCurrentUserMock, loadEventEditContextMock, adminClient } = vi.hoisted(() => {
  return {
    getCurrentUserMock: vi.fn(),
    loadEventEditContextMock: vi.fn(),
    adminClient: {
      storage: {
        from: vi.fn().mockReturnValue({
          createSignedUploadUrl: vi.fn().mockResolvedValue({
            data: { signedUrl: "https://signed.example/upload", token: "tok" },
            error: null,
          }),
        }),
      },
      from: vi.fn(),
    },
  };
});

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/events/edit-context", () => ({ loadEventEditContext: loadEventEditContextMock }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => adminClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: vi.fn().mockResolvedValue(undefined) }));

import { requestAttachmentUploadAction, deleteAttachmentAction } from "../attachments";

const VENUE_A = "11111111-1111-4111-8111-111111111111";
const VENUE_B = "22222222-2222-4222-8222-222222222222";
const EVENT_1 = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT_1 = "44444444-4444-4444-8444-444444444444";
const MANAGER_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_OW_ID = "66666666-6666-4666-8666-666666666666";
const ADMIN_ID = "77777777-7777-4777-8777-777777777777";
const EXEC_ID = "88888888-8888-4888-8888-888888888888";

const approvedAtA = {
  venueId: VENUE_A,
  managerResponsibleId: MANAGER_ID,
  createdBy: MANAGER_ID,
  status: "approved",
  deletedAt: null,
};

function validUploadInput(parentId: string = EVENT_1) {
  return {
    parentType: "event" as const,
    parentId,
    originalFilename: "doc.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1234,
  };
}

describe("requestAttachmentUploadAction — event parent authz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminClient.storage.from.mockReturnValue({
      createSignedUploadUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: "https://signed.example/upload", token: "tok" },
        error: null,
      }),
    });
    adminClient.from.mockImplementation(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) }));
  });

  it("manager_responsible OW on approved event can upload", async () => {
    getCurrentUserMock.mockResolvedValue({ id: MANAGER_ID, role: "office_worker", venueId: VENUE_A });
    loadEventEditContextMock.mockResolvedValue(approvedAtA);
    const result = await requestAttachmentUploadAction(validUploadInput());
    expect(result.success).toBe(true);
  });

  it("non-manager OW at same venue is rejected", async () => {
    getCurrentUserMock.mockResolvedValue({ id: OTHER_OW_ID, role: "office_worker", venueId: VENUE_A });
    loadEventEditContextMock.mockResolvedValue(approvedAtA);
    const result = await requestAttachmentUploadAction(validUploadInput());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
  });

  it("OW at different venue is rejected", async () => {
    getCurrentUserMock.mockResolvedValue({ id: OTHER_OW_ID, role: "office_worker", venueId: VENUE_B });
    loadEventEditContextMock.mockResolvedValue(approvedAtA);
    const result = await requestAttachmentUploadAction(validUploadInput());
    expect(result.success).toBe(false);
  });

  it("administrator can upload regardless of manager", async () => {
    getCurrentUserMock.mockResolvedValue({ id: ADMIN_ID, role: "administrator", venueId: null });
    loadEventEditContextMock.mockResolvedValue(approvedAtA);
    const result = await requestAttachmentUploadAction(validUploadInput());
    expect(result.success).toBe(true);
  });

  it("executive cannot upload", async () => {
    getCurrentUserMock.mockResolvedValue({ id: EXEC_ID, role: "executive", venueId: null });
    loadEventEditContextMock.mockResolvedValue(approvedAtA);
    const result = await requestAttachmentUploadAction(validUploadInput());
    expect(result.success).toBe(false);
  });

  it("missing event is rejected", async () => {
    getCurrentUserMock.mockResolvedValue({ id: MANAGER_ID, role: "office_worker", venueId: VENUE_A });
    loadEventEditContextMock.mockResolvedValue(null);
    const result = await requestAttachmentUploadAction(validUploadInput());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found|permission/i);
  });

  it("planning_item parent is not gated by canEditEvent", async () => {
    getCurrentUserMock.mockResolvedValue({ id: OTHER_OW_ID, role: "office_worker", venueId: VENUE_A });
    const result = await requestAttachmentUploadAction({
      ...validUploadInput(),
      parentType: "planning_item",
    });
    // Planning-item authz is out of scope for SEC-005; existing behaviour preserved (success).
    expect(result.success).toBe(true);
    expect(loadEventEditContextMock).not.toHaveBeenCalled();
  });
});

describe("deleteAttachmentAction — event parent authz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupAttachmentRow(row: {
    event_id: string | null;
    planning_item_id?: string | null;
    planning_task_id?: string | null;
    uploaded_by: string;
  }) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const eqAttach = vi.fn(() => ({ maybeSingle }));
    const selectAttach = vi.fn(() => ({ eq: eqAttach }));
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    adminClient.from.mockImplementation((table: string) => {
      if (table === "attachments") {
        return { select: selectAttach, update };
      }
      return { select: vi.fn(), update: vi.fn() };
    });
  }

  function fd(attachmentId: string): FormData {
    const f = new FormData();
    f.set("attachmentId", attachmentId);
    return f;
  }

  it("manager_responsible OW can delete event-parented attachment", async () => {
    getCurrentUserMock.mockResolvedValue({ id: MANAGER_ID, role: "office_worker", venueId: VENUE_A });
    setupAttachmentRow({ event_id: EVENT_1, uploaded_by: OTHER_OW_ID });
    loadEventEditContextMock.mockResolvedValue(approvedAtA);
    const result = await deleteAttachmentAction(undefined, fd(ATTACHMENT_1));
    expect(result.success).toBe(true);
  });

  it("uploader who is not manager cannot delete event-parented attachment", async () => {
    getCurrentUserMock.mockResolvedValue({ id: OTHER_OW_ID, role: "office_worker", venueId: VENUE_A });
    setupAttachmentRow({ event_id: EVENT_1, uploaded_by: OTHER_OW_ID });
    loadEventEditContextMock.mockResolvedValue(approvedAtA);
    const result = await deleteAttachmentAction(undefined, fd(ATTACHMENT_1));
    expect(result.success).toBe(false);
  });

  it("admin can always delete", async () => {
    getCurrentUserMock.mockResolvedValue({ id: ADMIN_ID, role: "administrator", venueId: null });
    setupAttachmentRow({ event_id: EVENT_1, uploaded_by: OTHER_OW_ID });
    loadEventEditContextMock.mockResolvedValue(approvedAtA);
    const result = await deleteAttachmentAction(undefined, fd(ATTACHMENT_1));
    expect(result.success).toBe(true);
  });

  it("planning-item-parented attachment keeps legacy uploader rule", async () => {
    getCurrentUserMock.mockResolvedValue({ id: OTHER_OW_ID, role: "office_worker", venueId: VENUE_A });
    setupAttachmentRow({ event_id: null, planning_item_id: "pi-1", uploaded_by: OTHER_OW_ID });
    const result = await deleteAttachmentAction(undefined, fd(ATTACHMENT_1));
    expect(result.success).toBe(true);
    expect(loadEventEditContextMock).not.toHaveBeenCalled();
  });
});
