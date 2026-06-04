import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AttachmentSummary } from "@/lib/attachments-types";

export type { AttachmentSummary } from "@/lib/attachments-types";
export { formatBytes } from "@/lib/attachments-types";

export type AttachmentRow = {
  id: string;
  event_id: string | null;
  planning_item_id: string | null;
  planning_task_id: string | null;
  original_filename: string;
  display_name: string | null;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string | null;
  uploaded_by: string | null;
  current_version_id: string | null;
  attachment_versions?: Array<{
    id: string;
    version_no: number;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    uploaded_by: string | null;
    created_at: string;
  }> | null;
};

const ATTACHMENT_SELECT = `
  id,
  event_id,
  planning_item_id,
  planning_task_id,
  original_filename,
  display_name,
  mime_type,
  size_bytes,
  uploaded_at,
  uploaded_by,
  current_version_id,
  attachment_versions(
    id,
    version_no,
    original_filename,
    mime_type,
    size_bytes,
    uploaded_by,
    created_at
  )
`;

function toSummary(row: AttachmentRow): AttachmentSummary {
  const parent = row.event_id
    ? ("event" as const)
    : row.planning_item_id
      ? ("planning_item" as const)
      : ("planning_task" as const);
  const versions = [...(row.attachment_versions ?? [])]
    .sort((left, right) => right.version_no - left.version_no)
    .map((version) => ({
      id: version.id,
      versionNo: version.version_no,
      originalFilename: version.original_filename,
      mimeType: version.mime_type,
      sizeBytes: version.size_bytes,
      uploadedAt: version.created_at,
      uploadedBy: version.uploaded_by,
    }));
  return {
    id: row.id,
    originalFilename: row.original_filename,
    displayName: row.display_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    currentVersionId: row.current_version_id,
    versionCount: versions.length,
    versions,
    parent,
    parentId: row.event_id ?? row.planning_item_id ?? row.planning_task_id ?? ""
  };
}

/**
 * Returns attachments for a single parent, filtered to uploaded + non-deleted.
 * Uses the admin client so the caller is responsible for any permission check.
 */
export async function listAttachmentsForParent(
  parentType: "event" | "planning_item" | "planning_task",
  parentId: string
): Promise<AttachmentSummary[]> {
  const db = createSupabaseAdminClient();
  const column =
    parentType === "event"
      ? "event_id"
      : parentType === "planning_item"
        ? "planning_item_id"
        : "planning_task_id";

   
  const { data } = await (db as any)
    .from("attachments")
    .select(ATTACHMENT_SELECT)
    .eq(column, parentId)
    .eq("upload_status", "uploaded")
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });

  return ((data ?? []) as AttachmentRow[]).map(toSummary);
}

/**
 * Returns all attachments that belong directly to an event or to any of its
 * planning items / planning tasks — used for the "attachments roll-up" panel
 * on an event page. Bundles the three underlying queries into a single
 * operation and flattens results.
 */
export async function listEventAttachmentsRollup(eventId: string): Promise<AttachmentSummary[]> {
  const db = createSupabaseAdminClient();

  // Direct event attachments.
   
  const { data: direct } = await (db as any)
    .from("attachments")
    .select(ATTACHMENT_SELECT)
    .eq("event_id", eventId)
    .eq("upload_status", "uploaded")
    .is("deleted_at", null);

  // Planning items linked to the event.
   
  const { data: itemRows } = await (db as any)
    .from("planning_items")
    .select("id")
    .eq("event_id", eventId);
  const itemIds = (itemRows ?? []).map((row: { id: string }) => row.id);

  // Attachments on those planning items.
  let itemAttachments: AttachmentRow[] = [];
  if (itemIds.length > 0) {
     
      const { data: items } = await (db as any)
        .from("attachments")
        .select(ATTACHMENT_SELECT)
      .in("planning_item_id", itemIds)
      .eq("upload_status", "uploaded")
      .is("deleted_at", null);
    itemAttachments = (items ?? []) as AttachmentRow[];
  }

  // Tasks under those items.
  let taskAttachments: AttachmentRow[] = [];
  if (itemIds.length > 0) {
     
    const { data: taskRows } = await (db as any)
      .from("planning_tasks")
      .select("id")
      .in("planning_item_id", itemIds);
    const taskIds = (taskRows ?? []).map((row: { id: string }) => row.id);
    if (taskIds.length > 0) {
       
      const { data: tasks } = await (db as any)
        .from("attachments")
        .select(ATTACHMENT_SELECT)
        .in("planning_task_id", taskIds)
        .eq("upload_status", "uploaded")
        .is("deleted_at", null);
      taskAttachments = (tasks ?? []) as AttachmentRow[];
    }
  }

  const combined = [
    ...((direct ?? []) as AttachmentRow[]),
    ...itemAttachments,
    ...taskAttachments
  ];
  combined.sort((a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""));
  return combined.map(toSummary);
}

/**
 * Roll-up for a planning item: attachments on the item itself plus any on
 * its planning tasks.
 */
export async function listPlanningItemAttachmentsRollup(itemId: string): Promise<AttachmentSummary[]> {
  const db = createSupabaseAdminClient();

   
  const { data: direct } = await (db as any)
    .from("attachments")
    .select(ATTACHMENT_SELECT)
    .eq("planning_item_id", itemId)
    .eq("upload_status", "uploaded")
    .is("deleted_at", null);

   
  const { data: taskRows } = await (db as any)
    .from("planning_tasks")
    .select("id")
    .eq("planning_item_id", itemId);
  const taskIds = (taskRows ?? []).map((row: { id: string }) => row.id);

  let taskAttachments: AttachmentRow[] = [];
  if (taskIds.length > 0) {
     
      const { data: tasks } = await (db as any)
        .from("attachments")
        .select(ATTACHMENT_SELECT)
      .in("planning_task_id", taskIds)
      .eq("upload_status", "uploaded")
      .is("deleted_at", null);
    taskAttachments = (tasks ?? []) as AttachmentRow[];
  }

  const combined = [...((direct ?? []) as AttachmentRow[]), ...taskAttachments];
  combined.sort((a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""));
  return combined.map(toSummary);
}
