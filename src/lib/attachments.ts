import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingColumnError, isMissingRelationError, serialiseSupabaseError } from "@/lib/supabase/errors";
import type { AttachmentSummary } from "@/lib/attachments-types";

export type { AttachmentSummary } from "@/lib/attachments-types";
export { formatBytes } from "@/lib/attachments-types";

export type AttachmentRow = {
  id: string;
  event_id: string | null;
  planning_item_id: string | null;
  planning_task_id: string | null;
  original_filename: string;
  display_name?: string | null;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string | null;
  uploaded_by: string | null;
  current_version_id?: string | null;
  attachment_versions?: Array<{
    id: string;
    version_no: number;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    uploaded_by: string | null;
    created_at: string;
    uploader?: {
      full_name: string | null;
      email: string | null;
    } | Array<{
      full_name: string | null;
      email: string | null;
    }> | null;
  }> | null;
};

type AttachmentVersionRow = NonNullable<AttachmentRow["attachment_versions"]>[number] & {
  attachment_id: string;
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
  attachment_versions!attachment_versions_attachment_id_fkey(
    id,
    version_no,
    original_filename,
    mime_type,
    size_bytes,
    uploaded_by,
    created_at,
    uploader:users!attachment_versions_uploaded_by_fkey(
      full_name,
      email
    )
  )
`;

const ATTACHMENT_VERSION_SELECT = `
  id,
  attachment_id,
  version_no,
  original_filename,
  mime_type,
  size_bytes,
  uploaded_by,
  created_at,
  uploader:users!attachment_versions_uploaded_by_fkey(
    full_name,
    email
  )
`;

const LEGACY_ATTACHMENT_SELECT = `
  id,
  event_id,
  planning_item_id,
  planning_task_id,
  original_filename,
  mime_type,
  size_bytes,
  uploaded_at,
  uploaded_by
`;

type AttachmentQueryResult = {
  data: AttachmentRow[] | null;
  error: unknown;
};

function isAttachmentVersioningSchemaError(error: unknown): boolean {
  return (
    isMissingColumnError(error, "display_name") ||
    isMissingColumnError(error, "current_version_id") ||
    isMissingRelationError(error, "attachment_versions")
  );
}

async function queryAttachmentRows(
  label: string,
  buildQuery: (selectClause: string) => PromiseLike<AttachmentQueryResult>
): Promise<AttachmentRow[]> {
  const result = await buildQuery(ATTACHMENT_SELECT);
  if (result.error && isAttachmentVersioningSchemaError(result.error)) {
    const legacyResult = await buildQuery(LEGACY_ATTACHMENT_SELECT);
    if (legacyResult.error) {
      console.error(`${label} legacy attachment query failed:`, serialiseSupabaseError(legacyResult.error));
      return [];
    }
    return hydrateVersionsForLegacyRows(label, (legacyResult.data ?? []) as AttachmentRow[]);
  }
  if (result.error) {
    console.error(`${label} attachment query failed:`, serialiseSupabaseError(result.error));
    return [];
  }
  return (result.data ?? []) as AttachmentRow[];
}

async function hydrateVersionsForLegacyRows(label: string, rows: AttachmentRow[]): Promise<AttachmentRow[]> {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return rows;

  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any)
    .from("attachment_versions")
    .select(ATTACHMENT_VERSION_SELECT)
    .in("attachment_id", ids)
    .order("version_no", { ascending: false });

  if (error) {
    if (!isMissingRelationError(error, "attachment_versions")) {
      console.error(`${label} attachment versions fallback failed:`, serialiseSupabaseError(error));
    }
    return rows;
  }

  const byAttachmentId = new Map<string, AttachmentVersionRow[]>();
  for (const version of ((data ?? []) as AttachmentVersionRow[])) {
    const list = byAttachmentId.get(version.attachment_id) ?? [];
    list.push(version);
    byAttachmentId.set(version.attachment_id, list);
  }

  return rows.map((row) => ({
    ...row,
    attachment_versions: byAttachmentId.get(row.id) ?? []
  }));
}

function toSummary(row: AttachmentRow): AttachmentSummary {
  const parent = row.event_id
    ? ("event" as const)
    : row.planning_item_id
      ? ("planning_item" as const)
      : ("planning_task" as const);
  const versions = [...(row.attachment_versions ?? [])]
    .sort((left, right) => right.version_no - left.version_no)
    .map((version) => {
      const uploader = singleRelation(version.uploader);
      return {
        id: version.id,
        versionNo: version.version_no,
        originalFilename: version.original_filename,
        mimeType: version.mime_type,
        sizeBytes: version.size_bytes,
        uploadedAt: version.created_at,
        uploadedBy: version.uploaded_by,
        uploadedByName: uploader?.full_name ?? null,
        uploadedByEmail: uploader?.email ?? null,
      };
    });
  return {
    id: row.id,
    originalFilename: row.original_filename,
    displayName: row.display_name ?? null,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    currentVersionId: row.current_version_id ?? null,
    versionCount: versions.length,
    versions,
    parent,
    parentId: row.event_id ?? row.planning_item_id ?? row.planning_task_id ?? ""
  };
}

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
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

   
  const data = await queryAttachmentRows("listAttachmentsForParent", (selectClause) =>
    (db as any)
      .from("attachments")
      .select(selectClause)
      .eq(column, parentId)
      .eq("upload_status", "uploaded")
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false })
  );

  return data.map(toSummary);
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
   
  const directPromise = queryAttachmentRows("listEventAttachmentsRollup direct", (selectClause) =>
    (db as any)
      .from("attachments")
      .select(selectClause)
      .eq("event_id", eventId)
      .eq("upload_status", "uploaded")
      .is("deleted_at", null)
  );

  // Planning items linked to the event.
   
  const itemRowsPromise = (db as any)
    .from("planning_items")
    .select("id")
    .eq("event_id", eventId);
  const [direct, { data: itemRows }] = await Promise.all([directPromise, itemRowsPromise]);
  const itemIds = (itemRows ?? []).map((row: { id: string }) => row.id);

  let itemAttachments: AttachmentRow[] = [];
  let taskAttachments: AttachmentRow[] = [];
  if (itemIds.length > 0) {
     
    const [loadedItemAttachments, { data: taskRows }] = await Promise.all([
      queryAttachmentRows("listEventAttachmentsRollup items", (selectClause) =>
        (db as any)
          .from("attachments")
          .select(selectClause)
          .in("planning_item_id", itemIds)
          .eq("upload_status", "uploaded")
          .is("deleted_at", null)
      ),
      (db as any)
        .from("planning_tasks")
        .select("id")
        .in("planning_item_id", itemIds)
    ]);
    itemAttachments = loadedItemAttachments;
    const taskIds = (taskRows ?? []).map((row: { id: string }) => row.id);
    if (taskIds.length > 0) {
       
      taskAttachments = await queryAttachmentRows("listEventAttachmentsRollup tasks", (selectClause) =>
        (db as any)
          .from("attachments")
          .select(selectClause)
          .in("planning_task_id", taskIds)
          .eq("upload_status", "uploaded")
          .is("deleted_at", null)
      );
    }
  }

  const combined = [
    ...direct,
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

   
  const direct = await queryAttachmentRows("listPlanningItemAttachmentsRollup direct", (selectClause) =>
    (db as any)
      .from("attachments")
      .select(selectClause)
      .eq("planning_item_id", itemId)
      .eq("upload_status", "uploaded")
      .is("deleted_at", null)
  );

   
  const { data: taskRows } = await (db as any)
    .from("planning_tasks")
    .select("id")
    .eq("planning_item_id", itemId);
  const taskIds = (taskRows ?? []).map((row: { id: string }) => row.id);

  let taskAttachments: AttachmentRow[] = [];
  if (taskIds.length > 0) {
     
    taskAttachments = await queryAttachmentRows("listPlanningItemAttachmentsRollup tasks", (selectClause) =>
      (db as any)
        .from("attachments")
        .select(selectClause)
        .in("planning_task_id", taskIds)
        .eq("upload_status", "uploaded")
        .is("deleted_at", null)
    );
  }

  const combined = [...direct, ...taskAttachments];
  combined.sort((a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""));
  return combined.map(toSummary);
}
