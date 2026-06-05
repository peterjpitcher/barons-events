"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingColumnError, isMissingRelationError, serialiseSupabaseError } from "@/lib/supabase/errors";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { canEditAttachment, canUploadToAttachmentParent, canViewAttachment } from "@/lib/attachment-access";
import type { ActionResult } from "@/lib/types";

// file-type detects the raw container format. Some declared types collapse
// to a shared magic-byte signature, so a strict string-equality check would
// reject legitimate uploads. Express the allowed equivalences here so we can
// "trust" a detected type when it's a known synonym for the declared one.
//
// (Known limitation: .doc/.xls/.ppt OLE Compound Document files share the
// application/x-cfb container signature. Declared Office/legacy types are
// accepted provided the detected type is application/x-cfb — we don't have a
// way to distinguish .doc vs .xls beyond filename/extension heuristics.)
const MIME_SYNONYMS: Record<string, Set<string>> = {
  "application/pdf": new Set(["application/pdf"]),
  // Modern Office formats are OOXML = ZIP containers. file-type emits the
  // specific subtype when known, or falls back to "application/zip".
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip"
  ]),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip"
  ]),
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": new Set([
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip"
  ]),
  // Legacy Office binary formats are OLE CFB containers.
  "application/msword": new Set(["application/msword", "application/x-cfb"]),
  "application/vnd.ms-excel": new Set(["application/vnd.ms-excel", "application/x-cfb"]),
  "application/vnd.ms-powerpoint": new Set([
    "application/vnd.ms-powerpoint",
    "application/x-cfb"
  ]),
  "image/jpeg": new Set(["image/jpeg"]),
  "image/png": new Set(["image/png"]),
  "image/heic": new Set(["image/heic"]),
  "image/webp": new Set(["image/webp"]),
  "video/mp4": new Set(["video/mp4"]),
  "video/quicktime": new Set(["video/quicktime", "video/mp4"])
};

function detectedTypeMatchesDeclared(declared: string, detected: string): boolean {
  const expected = MIME_SYNONYMS[declared];
  if (!expected) return false;
  return expected.has(detected);
}

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "video/mp4",
  "video/quicktime"
]);
const MAX_SIZE_BYTES = 262_144_000; // 250 MB

const parentTypeSchema = z.enum(["event", "planning_item", "planning_task"]);

function sanitiseFilename(raw: string): string {
  const cleaned = raw.replace(/[/\\\x00\n\r]/g, "_");
  return cleaned.slice(0, 180);
}

function attachmentDisplayLabel(row: { display_name?: string | null; original_filename?: string | null }): string | null {
  return row.display_name ?? row.original_filename ?? null;
}

function attachmentParentMeta(row: {
  event_id?: string | null;
  planning_item_id?: string | null;
  planning_task_id?: string | null;
}): Record<string, string> {
  return Object.fromEntries(
    [
      ["event_id", row.event_id],
      ["planning_item_id", row.planning_item_id],
      ["planning_task_id", row.planning_task_id]
    ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
  );
}

function safeExtensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov"
  };
  return map[mime] ?? "bin";
}

const requestUploadSchema = z.object({
  parentType: parentTypeSchema,
  parentId: z.string().uuid(),
  originalFilename: z.string().min(1).max(180),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive().max(MAX_SIZE_BYTES)
});

export type RequestAttachmentUploadResult =
  | { success: true; attachmentId: string; uploadUrl: string; storagePath: string; uploadToken: string }
  | { success: false; message: string };

export type RequestAttachmentVersionUploadResult =
  | { success: true; attachmentId: string; uploadUrl: string; storagePath: string; versionNo: number; uploadToken: string }
  | { success: false; message: string };

async function recordAttachmentUploadFailure(args: {
  attachmentId: string;
  userId: string;
  reason: string;
  markAttachmentFailed?: boolean;
}): Promise<void> {
  const db = createSupabaseAdminClient();
  const { data: attachment } = await (db as any)
    .from("attachments")
    .select("display_name, original_filename, event_id, planning_item_id, planning_task_id")
    .eq("id", args.attachmentId)
    .maybeSingle();
  if (args.markAttachmentFailed !== false) {
    await (db as any)
      .from("attachments")
      .update({ upload_status: "failed", uploaded_at: new Date().toISOString() })
      .eq("id", args.attachmentId);
  }

  await recordAuditLogEntry({
    entity: "attachment",
    entityId: args.attachmentId,
    action: "attachment.upload_failed",
    actorId: args.userId,
    meta: {
      ...(attachment ? attachmentParentMeta(attachment) : {}),
      reason: args.reason,
      filename: attachment ? attachmentDisplayLabel(attachment) : null
    }
  });
}

async function verifyUploadedObject(args: {
  storagePath: string;
  declaredMimeType: string;
  attachmentId: string;
  userId: string;
  markAttachmentFailed?: boolean;
}): Promise<ActionResult | null> {
  const db = createSupabaseAdminClient();
  const { data: existing, error: existErr } = await (db as any)
    .storage.from("task-attachments")
    .createSignedUrl(args.storagePath, 30);
  if (existErr || !existing?.signedUrl) {
    await recordAttachmentUploadFailure({
      attachmentId: args.attachmentId,
      userId: args.userId,
      reason: "storage_object_missing",
      markAttachmentFailed: args.markAttachmentFailed
    });
    return { success: false, message: "Upload not yet visible in storage. Retry in a moment." };
  }

  try {
    const response = await fetch(existing.signedUrl, { headers: { Range: "bytes=0-16383" } });
    if (!response.ok && response.status !== 206) {
      console.error("verifyUploadedObject sniff fetch failed:", response.status);
      await (db as unknown as { storage: { from: (b: string) => { remove: (p: string[]) => Promise<unknown> } } })
        .storage.from("task-attachments")
        .remove([args.storagePath]);
      await recordAttachmentUploadFailure({
        attachmentId: args.attachmentId,
        userId: args.userId,
        reason: "sniff_fetch_failed",
        markAttachmentFailed: args.markAttachmentFailed
      });
      return { success: false, message: "Upload verification failed." };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !detectedTypeMatchesDeclared(args.declaredMimeType, detected.mime)) {
      console.warn(
        "verifyUploadedObject MIME mismatch:",
        { declared: args.declaredMimeType, detected: detected?.mime }
      );
      await (db as unknown as { storage: { from: (b: string) => { remove: (p: string[]) => Promise<unknown> } } })
        .storage.from("task-attachments")
        .remove([args.storagePath]);
      await recordAttachmentUploadFailure({
        attachmentId: args.attachmentId,
        userId: args.userId,
        reason: "mime_mismatch",
        markAttachmentFailed: args.markAttachmentFailed
      });
      return {
        success: false,
        message: "File contents don't match the declared type. Upload rejected."
      };
    }
  } catch (sniffError) {
    console.error("verifyUploadedObject sniff threw:", sniffError);
    return { success: false, message: "Could not verify upload. Try again in a moment." };
  }

  return null;
}

async function revalidateAttachmentParentPaths(parent: {
  event_id?: string | null;
  planning_item_id?: string | null;
  planning_task_id?: string | null;
}): Promise<void> {
  revalidatePath("/planning");

  if (parent.event_id) {
    revalidatePath(`/events/${parent.event_id}`);
    revalidatePath("/events");
    return;
  }

  const db = createSupabaseAdminClient();
  if (parent.planning_item_id) {
    revalidatePath(`/planning/${parent.planning_item_id}`);
    const { data: item } = await (db as any)
      .from("planning_items")
      .select("event_id")
      .eq("id", parent.planning_item_id)
      .maybeSingle();
    if (item?.event_id) {
      revalidatePath(`/events/${item.event_id}`);
    }
    return;
  }

  if (parent.planning_task_id) {
    const { data: task } = await (db as any)
      .from("planning_tasks")
      .select("planning_item_id, planning_item:planning_items(event_id)")
      .eq("id", parent.planning_task_id)
      .maybeSingle();
    const planningItemId = task?.planning_item_id ?? null;
    const planningItemRelation = Array.isArray(task?.planning_item)
      ? task.planning_item[0]
      : task?.planning_item;
    if (planningItemId) {
      revalidatePath(`/planning/${planningItemId}`);
    }
    if (planningItemRelation?.event_id) {
      revalidatePath(`/events/${planningItemRelation.event_id}`);
    }
  }
}

export async function requestAttachmentUploadAction(
  input: z.infer<typeof requestUploadSchema>
): Promise<RequestAttachmentUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = requestUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid upload request." };
  }
  if (!ALLOWED_MIME_TYPES.has(parsed.data.mimeType)) {
    return { success: false, message: "That file type is not supported." };
  }

  if (!(await canUploadToAttachmentParent(user, parsed.data.parentType, parsed.data.parentId))) {
    return { success: false, message: "You don't have permission to upload attachments here." };
  }

  const db = createSupabaseAdminClient();
  const attachmentId = crypto.randomUUID();
  const safeName = sanitiseFilename(parsed.data.originalFilename);
  const ext = safeExtensionFromMime(parsed.data.mimeType);
  const storagePath = `${attachmentId}.${ext}`;

   
  const { data: signed, error: signErr } = await (db as any)
    .storage.from("task-attachments")
    .createSignedUploadUrl(storagePath);

  if (signErr || !signed) {
    console.error("requestAttachmentUploadAction sign failed:", signErr);
    return { success: false, message: "Could not prepare upload." };
  }

   
  const insertRow: any = {
    id: attachmentId,
    storage_path: storagePath,
    original_filename: safeName,
    display_name: safeName,
    mime_type: parsed.data.mimeType,
    size_bytes: parsed.data.sizeBytes,
    upload_status: "pending",
    uploaded_by: user.id
  };
  if (parsed.data.parentType === "event") insertRow.event_id = parsed.data.parentId;
  else if (parsed.data.parentType === "planning_item") insertRow.planning_item_id = parsed.data.parentId;
  else insertRow.planning_task_id = parsed.data.parentId;

   
  const { error: insertErr } = await (db as any).from("attachments").insert(insertRow);
  if (insertErr) {
    if (isMissingColumnError(insertErr, "display_name")) {
      const legacyInsertRow = { ...insertRow };
      delete legacyInsertRow.display_name;
      const { error: legacyInsertErr } = await (db as any).from("attachments").insert(legacyInsertRow);
      if (!legacyInsertErr) {
        return {
          success: true,
          attachmentId,
          uploadUrl: signed.signedUrl,
          storagePath,
          uploadToken: signed.token ?? ""
        };
      }
      console.error(
        "requestAttachmentUploadAction legacy insert failed:",
        serialiseSupabaseError(legacyInsertErr)
      );
      return { success: false, message: "Could not create attachment record." };
    }
    console.error("requestAttachmentUploadAction insert failed:", serialiseSupabaseError(insertErr));
    return { success: false, message: "Could not create attachment record." };
  }

  return {
    success: true,
    attachmentId,
    uploadUrl: signed.signedUrl,
    storagePath,
    uploadToken: signed.token ?? ""
  };
}

const confirmSchema = z.object({ attachmentId: z.string().uuid() });

export async function confirmAttachmentUploadAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = confirmSchema.safeParse({ attachmentId: formData.get("attachmentId") });
  if (!parsed.success) return { success: false, message: "Missing attachment reference." };

  const db = createSupabaseAdminClient();
   
  let supportsAttachmentDisplayName = true;
  let { data: row, error: readErr } = await (db as any)
    .from("attachments")
    .select("id, uploaded_by, event_id, planning_item_id, planning_task_id, storage_path, original_filename, display_name, mime_type, size_bytes, upload_status")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();

  if (readErr && isMissingColumnError(readErr, "display_name")) {
    supportsAttachmentDisplayName = false;
    const legacyRead = await (db as any)
      .from("attachments")
      .select("id, uploaded_by, event_id, planning_item_id, planning_task_id, storage_path, original_filename, mime_type, size_bytes, upload_status")
      .eq("id", parsed.data.attachmentId)
      .maybeSingle();
    row = legacyRead.data;
    readErr = legacyRead.error;
  }

  if (readErr || !row) {
    if (readErr) {
      console.error("confirmAttachmentUploadAction read failed:", serialiseSupabaseError(readErr));
    }
    return { success: false, message: "Attachment not found." };
  }
  if (row.uploaded_by !== user.id && user.role !== "administrator") {
    return { success: false, message: "You cannot confirm this upload." };
  }
  if (!(await canEditAttachment(user, row))) {
    return { success: false, message: "You don't have permission to confirm this upload." };
  }
  if (row.upload_status === "uploaded") {
    return { success: true, message: "Already confirmed." };
  }

  const verificationError = await verifyUploadedObject({
    storagePath: row.storage_path,
    declaredMimeType: row.mime_type,
    attachmentId: parsed.data.attachmentId,
    userId: user.id
  });
  if (verificationError) {
    return verificationError;
  }

  let currentVersionId: string | null = null;
  const { data: version, error: versionError } = await (db as any)
    .from("attachment_versions")
    .insert({
      attachment_id: parsed.data.attachmentId,
      version_no: 1,
      storage_path: row.storage_path,
      original_filename: row.original_filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      uploaded_by: user.id
    })
    .select("id")
    .single();
  if (versionError || !version) {
    if (!isMissingRelationError(versionError, "attachment_versions")) {
      console.error("confirmAttachmentUploadAction version insert failed:", serialiseSupabaseError(versionError));
      return { success: false, message: "Could not record attachment version." };
    }
  } else {
    currentVersionId = version.id;
  }

  const uploadedAt = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    upload_status: "uploaded",
    uploaded_at: uploadedAt
  };
  if (supportsAttachmentDisplayName) {
    updatePayload.display_name = row.display_name ?? row.original_filename;
  }
  if (currentVersionId) {
    updatePayload.current_version_id = currentVersionId;
  }

  let { error: updateErr } = await (db as any)
    .from("attachments")
    .update(updatePayload)
    .eq("id", parsed.data.attachmentId);
  if (
    updateErr &&
    (isMissingColumnError(updateErr, "display_name") || isMissingColumnError(updateErr, "current_version_id"))
  ) {
    const legacyUpdate = {
      upload_status: "uploaded",
      uploaded_at: uploadedAt
    };
    const legacyResult = await (db as any)
      .from("attachments")
      .update(legacyUpdate)
      .eq("id", parsed.data.attachmentId);
    updateErr = legacyResult.error;
  }
  if (updateErr) {
    console.error("confirmAttachmentUploadAction update failed:", serialiseSupabaseError(updateErr));
    return { success: false, message: "Could not mark attachment uploaded." };
  }

  await recordAuditLogEntry({
    entity: "attachment",
    entityId: parsed.data.attachmentId,
    action: "attachment.uploaded",
    actorId: user.id,
    meta: {
      ...attachmentParentMeta(row),
      filename: attachmentDisplayLabel(row),
      original_filename: row.original_filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      storage_path: row.storage_path
    }
  });

  await revalidateAttachmentParentPaths(row);
  return { success: true, message: "Attachment uploaded." };
}

const deleteSchema = z.object({ attachmentId: z.string().uuid() });

const renameSchema = z.object({
  attachmentId: z.string().uuid(),
  displayName: z.string().trim().min(1, "Add a filename").max(180)
});

export async function renameAttachmentAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = renameSchema.safeParse({
    attachmentId: formData.get("attachmentId"),
    displayName: formData.get("displayName")
  });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the filename." };
  }

  const db = createSupabaseAdminClient();
  let supportsAttachmentDisplayName = true;
  let { data: row, error: readError } = await (db as any)
    .from("attachments")
    .select("uploaded_by, event_id, planning_item_id, planning_task_id, display_name, original_filename")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (readError && isMissingColumnError(readError, "display_name")) {
    supportsAttachmentDisplayName = false;
    const legacyRead = await (db as any)
      .from("attachments")
      .select("uploaded_by, event_id, planning_item_id, planning_task_id, original_filename")
      .eq("id", parsed.data.attachmentId)
      .maybeSingle();
    row = legacyRead.data;
    readError = legacyRead.error;
  }
  if (readError) {
    console.error("renameAttachmentAction read failed:", serialiseSupabaseError(readError));
    return { success: false, message: "Attachment not found." };
  }
  if (!row) return { success: false, message: "Attachment not found." };
  if (!(await canEditAttachment(user, row))) {
    return { success: false, message: "You don't have permission to rename this attachment." };
  }

  const displayName = sanitiseFilename(parsed.data.displayName);
  const updatePayload = supportsAttachmentDisplayName
    ? { display_name: displayName }
    : { original_filename: displayName };
  let { error } = await (db as any)
    .from("attachments")
    .update(updatePayload)
    .eq("id", parsed.data.attachmentId);
  if (error && supportsAttachmentDisplayName && isMissingColumnError(error, "display_name")) {
    supportsAttachmentDisplayName = false;
    const legacyUpdate = await (db as any)
      .from("attachments")
      .update({ original_filename: displayName })
      .eq("id", parsed.data.attachmentId);
    error = legacyUpdate.error;
  }
  if (error) {
    console.error("renameAttachmentAction update failed:", serialiseSupabaseError(error));
    return { success: false, message: "Could not rename attachment." };
  }

  await recordAuditLogEntry({
    entity: "attachment",
    entityId: parsed.data.attachmentId,
    action: "attachment.renamed",
    actorId: user.id,
    meta: {
      ...attachmentParentMeta(row),
      previous_display_name: row.display_name ?? row.original_filename,
      display_name: displayName,
      persisted_field: supportsAttachmentDisplayName ? "display_name" : "original_filename"
    }
  });

  await revalidateAttachmentParentPaths(row);
  return { success: true, message: "Filename updated." };
}

const requestVersionUploadSchema = z.object({
  attachmentId: z.string().uuid(),
  originalFilename: z.string().min(1).max(180),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive().max(MAX_SIZE_BYTES)
});

export async function requestAttachmentVersionUploadAction(
  input: z.infer<typeof requestVersionUploadSchema>
): Promise<RequestAttachmentVersionUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = requestVersionUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid upload request." };
  }
  if (!ALLOWED_MIME_TYPES.has(parsed.data.mimeType)) {
    return { success: false, message: "That file type is not supported." };
  }

  const db = createSupabaseAdminClient();
  const { data: row } = await (db as any)
    .from("attachments")
    .select("id, uploaded_by, event_id, planning_item_id, planning_task_id")
    .eq("id", parsed.data.attachmentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { success: false, message: "Attachment not found." };
  if (!(await canEditAttachment(user, row))) {
    return { success: false, message: "You don't have permission to upload a new version." };
  }

  let versionNo = 1;
  const { data: latest, error: latestError } = await (db as any)
    .from("attachment_versions")
    .select("version_no")
    .eq("attachment_id", parsed.data.attachmentId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError && !isMissingRelationError(latestError, "attachment_versions")) {
    console.error("requestAttachmentVersionUploadAction latest version lookup failed:", serialiseSupabaseError(latestError));
    return { success: false, message: "Could not prepare version upload." };
  }
  if (latestError && isMissingRelationError(latestError, "attachment_versions")) {
    return {
      success: false,
      message: "Attachment version history needs the database migration before uploading versions."
    };
  }
  if (!latestError) {
    versionNo = Number(latest?.version_no ?? 0) + 1;
  }
  const ext = safeExtensionFromMime(parsed.data.mimeType);
  const storagePath = `${parsed.data.attachmentId}/v${versionNo}-${crypto.randomUUID()}.${ext}`;

  const { data: signed, error: signErr } = await (db as any)
    .storage.from("task-attachments")
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    console.error("requestAttachmentVersionUploadAction sign failed:", signErr);
    return { success: false, message: "Could not prepare upload." };
  }

  return {
    success: true,
    attachmentId: parsed.data.attachmentId,
    uploadUrl: signed.signedUrl,
    storagePath,
    versionNo,
    uploadToken: signed.token ?? ""
  };
}

const confirmVersionSchema = z.object({
  attachmentId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  versionNo: z.coerce.number().int().positive(),
  originalFilename: z.string().min(1).max(180),
  mimeType: z.string().min(1),
  sizeBytes: z.coerce.number().int().positive().max(MAX_SIZE_BYTES)
});

export async function confirmAttachmentVersionUploadAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = confirmVersionSchema.safeParse({
    attachmentId: formData.get("attachmentId"),
    storagePath: formData.get("storagePath"),
    versionNo: formData.get("versionNo"),
    originalFilename: formData.get("originalFilename"),
    mimeType: formData.get("mimeType"),
    sizeBytes: formData.get("sizeBytes")
  });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Missing version upload reference." };
  }
  if (!ALLOWED_MIME_TYPES.has(parsed.data.mimeType)) {
    return { success: false, message: "That file type is not supported." };
  }

  const db = createSupabaseAdminClient();
  let supportsAttachmentDisplayName = true;
  let { data: row, error: readError } = await (db as any)
    .from("attachments")
    .select("id, uploaded_by, event_id, planning_item_id, planning_task_id, original_filename, display_name")
    .eq("id", parsed.data.attachmentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError && isMissingColumnError(readError, "display_name")) {
    supportsAttachmentDisplayName = false;
    const legacyRead = await (db as any)
      .from("attachments")
      .select("id, uploaded_by, event_id, planning_item_id, planning_task_id, original_filename")
      .eq("id", parsed.data.attachmentId)
      .is("deleted_at", null)
      .maybeSingle();
    row = legacyRead.data;
    readError = legacyRead.error;
  }
  if (readError) {
    console.error("confirmAttachmentVersionUploadAction attachment read failed:", serialiseSupabaseError(readError));
  }
  if (!row) return { success: false, message: "Attachment not found." };
  if (!(await canEditAttachment(user, row))) {
    return { success: false, message: "You don't have permission to confirm this version." };
  }

  const verificationError = await verifyUploadedObject({
    storagePath: parsed.data.storagePath,
    declaredMimeType: parsed.data.mimeType,
    attachmentId: parsed.data.attachmentId,
    userId: user.id,
    markAttachmentFailed: false
  });
  if (verificationError) {
    return verificationError;
  }

  const safeName = sanitiseFilename(parsed.data.originalFilename);
  const currentDisplayName = typeof row.display_name === "string" && row.display_name.trim().length > 0
    ? row.display_name
    : null;
  const hasUserEditedDisplayName = Boolean(currentDisplayName && currentDisplayName !== row.original_filename);
  const nextDisplayName = hasUserEditedDisplayName ? currentDisplayName : safeName;
  const { data: version, error: versionError } = await (db as any)
    .from("attachment_versions")
    .insert({
      attachment_id: parsed.data.attachmentId,
      version_no: parsed.data.versionNo,
      storage_path: parsed.data.storagePath,
      original_filename: safeName,
      mime_type: parsed.data.mimeType,
      size_bytes: parsed.data.sizeBytes,
      uploaded_by: user.id
    })
    .select("id")
    .single();
  if (versionError || !version) {
    if (!isMissingRelationError(versionError, "attachment_versions")) {
      console.error("confirmAttachmentVersionUploadAction version insert failed:", serialiseSupabaseError(versionError));
      return { success: false, message: "Could not record the new version." };
    }

    await (db as any).storage.from("task-attachments").remove([parsed.data.storagePath]).catch(() => {});
    return {
      success: false,
      message: "Attachment version history needs the database migration before uploading versions."
    };
  }

  const uploadedAt = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    current_version_id: version.id,
    storage_path: parsed.data.storagePath,
    original_filename: safeName,
    mime_type: parsed.data.mimeType,
    size_bytes: parsed.data.sizeBytes,
    uploaded_at: uploadedAt,
    uploaded_by: user.id,
    upload_status: "uploaded"
  };
  if (supportsAttachmentDisplayName) {
    updatePayload.display_name = nextDisplayName;
  }

  let { error: updateError } = await (db as any)
    .from("attachments")
    .update(updatePayload)
    .eq("id", parsed.data.attachmentId);
  if (
    updateError &&
    (isMissingColumnError(updateError, "current_version_id") || isMissingColumnError(updateError, "display_name"))
  ) {
    const retryPayload = { ...updatePayload };
    if (isMissingColumnError(updateError, "current_version_id")) {
      delete retryPayload.current_version_id;
    }
    if (isMissingColumnError(updateError, "display_name")) {
      delete retryPayload.display_name;
    }
    const legacyUpdate = await (db as any)
      .from("attachments")
      .update(retryPayload)
      .eq("id", parsed.data.attachmentId);
    updateError = legacyUpdate.error;
  }
  if (updateError) return { success: false, message: "Could not activate the new version." };

  await recordAuditLogEntry({
    entity: "attachment",
    entityId: parsed.data.attachmentId,
    action: "attachment.version_added",
    actorId: user.id,
    meta: {
      ...attachmentParentMeta(row),
      filename: nextDisplayName,
      uploaded_filename: safeName,
      previous_filename: row.original_filename,
      version_no: parsed.data.versionNo,
      mime_type: parsed.data.mimeType,
      size_bytes: parsed.data.sizeBytes
    }
  });

  await revalidateAttachmentParentPaths(row);
  return { success: true, message: "New version uploaded." };
}

export async function deleteAttachmentAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = deleteSchema.safeParse({ attachmentId: formData.get("attachmentId") });
  if (!parsed.success) return { success: false, message: "Missing attachment reference." };

  const db = createSupabaseAdminClient();


  let supportsAttachmentDisplayName = true;
  let { data: row, error: readError } = await (db as any)
    .from("attachments")
    .select("uploaded_by, event_id, planning_item_id, planning_task_id, display_name, original_filename")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (readError && isMissingColumnError(readError, "display_name")) {
    supportsAttachmentDisplayName = false;
    const legacyRead = await (db as any)
      .from("attachments")
      .select("uploaded_by, event_id, planning_item_id, planning_task_id, original_filename")
      .eq("id", parsed.data.attachmentId)
      .maybeSingle();
    row = legacyRead.data;
    readError = legacyRead.error;
  }
  if (readError) {
    console.error("deleteAttachmentAction read failed:", serialiseSupabaseError(readError));
  }

  if (!row) return { success: false, message: "Attachment not found." };

  if (!(await canEditAttachment(user, row))) {
    return { success: false, message: "You don't have permission to delete this attachment." };
  }

   
  const { error } = await (db as any)
    .from("attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.attachmentId);
  if (error) return { success: false, message: "Could not delete attachment." };

  await recordAuditLogEntry({
    entity: "attachment",
    entityId: parsed.data.attachmentId,
    action: "attachment.deleted",
    actorId: user.id,
    meta: {
      ...attachmentParentMeta(row),
      filename: supportsAttachmentDisplayName ? attachmentDisplayLabel(row) : row.original_filename,
      original_filename: row.original_filename
    }
  });

  await revalidateAttachmentParentPaths(row);
  return { success: true, message: "Attachment deleted." };
}

const urlSchema = z.object({ attachmentId: z.string().uuid() });
const versionUrlSchema = z.object({ versionId: z.string().uuid() });

export type GetAttachmentUrlResult =
  | { success: true; url: string; expiresInSeconds: number }
  | { success: false; message: string };

export async function getAttachmentUrlAction(
  input: z.infer<typeof urlSchema>
): Promise<GetAttachmentUrlResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = urlSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Missing attachment reference." };

  const db = createSupabaseAdminClient();

   
  const { data: row, error } = await (db as any)
    .from("attachments")
    .select("storage_path, size_bytes, upload_status, deleted_at, uploaded_by, event_id, planning_item_id, planning_task_id")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();

  if (error || !row) return { success: false, message: "Attachment not found." };
  if (row.deleted_at) return { success: false, message: "Attachment no longer available." };
  if (row.upload_status !== "uploaded") return { success: false, message: "Upload still in progress." };
  if (!(await canViewAttachment(user, row))) {
    return { success: false, message: "You don't have permission to download this attachment." };
  }

  const ttl = row.size_bytes <= 20_000_000 ? 300 : 1800;
   
  const { data: signed, error: signErr } = await (db as any)
    .storage.from("task-attachments")
    .createSignedUrl(row.storage_path, ttl);

  if (signErr || !signed) {
    return { success: false, message: "Could not issue download URL." };
  }

  return { success: true, url: signed.signedUrl, expiresInSeconds: ttl };
}

export async function getAttachmentVersionUrlAction(
  input: z.infer<typeof versionUrlSchema>
): Promise<GetAttachmentUrlResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = versionUrlSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Missing attachment version reference." };

  const db = createSupabaseAdminClient();
  const { data: version, error } = await (db as any)
    .from("attachment_versions")
    .select(`
      storage_path,
      size_bytes,
      attachment:attachments(
        uploaded_by,
        upload_status,
        deleted_at,
        event_id,
        planning_item_id,
        planning_task_id
      )
    `)
    .eq("id", parsed.data.versionId)
    .maybeSingle();

  if (error || !version) return { success: false, message: "Attachment version not found." };
  const attachment = Array.isArray(version.attachment) ? version.attachment[0] : version.attachment;
  if (!attachment || attachment.deleted_at) return { success: false, message: "Attachment no longer available." };
  if (attachment.upload_status !== "uploaded") return { success: false, message: "Upload still in progress." };
  if (!(await canViewAttachment(user, attachment))) {
    return { success: false, message: "You don't have permission to download this attachment." };
  }

  const ttl = version.size_bytes <= 20_000_000 ? 300 : 1800;
  const { data: signed, error: signErr } = await (db as any)
    .storage.from("task-attachments")
    .createSignedUrl(version.storage_path, ttl);

  if (signErr || !signed) {
    return { success: false, message: "Could not issue download URL." };
  }

  return { success: true, url: signed.signedUrl, expiresInSeconds: ttl };
}
