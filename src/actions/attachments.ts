"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { canEditEvent } from "@/lib/roles";
import { loadEventEditContext } from "@/lib/events/edit-context";
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

  // SEC-005: event-parented attachments follow the canonical event-edit rule.
  // Planning-item/task parents keep their existing (pre-SEC-005) authz path —
  // out of scope for this fix.
  if (parsed.data.parentType === "event") {
    const ctx = await loadEventEditContext(parsed.data.parentId);
    if (!ctx) return { success: false, message: "Event not found." };
    if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
      return { success: false, message: "You don't have permission to upload attachments to this event." };
    }
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
    console.error("requestAttachmentUploadAction insert failed:", insertErr);
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
   
  const { data: row, error: readErr } = await (db as any)
    .from("attachments")
    .select("id, uploaded_by, storage_path, mime_type, upload_status")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();

  if (readErr || !row) {
    return { success: false, message: "Attachment not found." };
  }
  if (row.uploaded_by !== user.id && user.role !== "administrator") {
    return { success: false, message: "You cannot confirm this upload." };
  }
  if (row.upload_status === "uploaded") {
    return { success: true, message: "Already confirmed." };
  }

   
  const { data: existing, error: existErr } = await (db as any)
    .storage.from("task-attachments")
    .createSignedUrl(row.storage_path, 30);
  if (existErr || !existing?.signedUrl) {
    return { success: false, message: "Upload not yet visible in storage. Retry in a moment." };
  }

  // Sniff the first 16 KB to verify the uploaded bytes match the declared
  // MIME type. Renamed executables or content mismatches are rejected and the
  // storage object is removed. file-type is robust for all allowed formats
  // except legacy .doc/.xls/.ppt (all OLE CFB — we can't disambiguate).
  try {
    const response = await fetch(existing.signedUrl, { headers: { Range: "bytes=0-16383" } });
    if (!response.ok && response.status !== 206) {
      console.error("confirmAttachmentUploadAction sniff fetch failed:", response.status);
      await (db as unknown as { storage: { from: (b: string) => { remove: (p: string[]) => Promise<unknown> } } })
        .storage.from("task-attachments")
        .remove([row.storage_path]);
       
      await (db as any)
        .from("attachments")
        .update({ upload_status: "failed", uploaded_at: new Date().toISOString() })
        .eq("id", parsed.data.attachmentId);
      return { success: false, message: "Upload verification failed." };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !detectedTypeMatchesDeclared(row.mime_type, detected.mime)) {
      console.warn(
        "confirmAttachmentUploadAction MIME mismatch:",
        { declared: row.mime_type, detected: detected?.mime }
      );
      await (db as unknown as { storage: { from: (b: string) => { remove: (p: string[]) => Promise<unknown> } } })
        .storage.from("task-attachments")
        .remove([row.storage_path]);
       
      await (db as any)
        .from("attachments")
        .update({ upload_status: "failed", uploaded_at: new Date().toISOString() })
        .eq("id", parsed.data.attachmentId);
      return {
        success: false,
        message: "File contents don't match the declared type. Upload rejected."
      };
    }
  } catch (sniffError) {
    console.error("confirmAttachmentUploadAction sniff threw:", sniffError);
    return { success: false, message: "Could not verify upload. Try again in a moment." };
  }

   
  const { error: updateErr } = await (db as any)
    .from("attachments")
    .update({ upload_status: "uploaded", uploaded_at: new Date().toISOString() })
    .eq("id", parsed.data.attachmentId);
  if (updateErr) {
    return { success: false, message: "Could not mark attachment uploaded." };
  }

  await recordAuditLogEntry({
    entity: "attachment",
    entityId: parsed.data.attachmentId,
    action: "attachment.uploaded",
    actorId: user.id,
    meta: { mime_type: row.mime_type, storage_path: row.storage_path }
  });

  revalidatePath("/planning");
  return { success: true, message: "Attachment uploaded." };
}

const deleteSchema = z.object({ attachmentId: z.string().uuid() });

export async function deleteAttachmentAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = deleteSchema.safeParse({ attachmentId: formData.get("attachmentId") });
  if (!parsed.success) return { success: false, message: "Missing attachment reference." };

  const db = createSupabaseAdminClient();


  const { data: row } = await (db as any)
    .from("attachments")
    .select("uploaded_by, event_id, planning_item_id, planning_task_id")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();

  if (!row) return { success: false, message: "Attachment not found." };

  // SEC-005: event-parented attachments require event-edit capability.
  // Admin short-circuits. Planning-parented attachments keep the legacy
  // uploader-or-admin rule (out of scope for SEC-005).
  if (user.role !== "administrator") {
    if (row.event_id) {
      const ctx = await loadEventEditContext(row.event_id);
      if (!ctx || !canEditEvent(user.role, user.id, user.venueId, ctx)) {
        return { success: false, message: "You don't have permission to delete this attachment." };
      }
    } else if (row.uploaded_by !== user.id) {
      return { success: false, message: "You cannot delete this attachment." };
    }
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
    meta: {}
  });

  revalidatePath("/planning");
  return { success: true, message: "Attachment deleted." };
}

const urlSchema = z.object({ attachmentId: z.string().uuid() });

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
    .select("storage_path, size_bytes, upload_status, deleted_at")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();

  if (error || !row) return { success: false, message: "Attachment not found." };
  if (row.deleted_at) return { success: false, message: "Attachment no longer available." };
  if (row.upload_status !== "uploaded") return { success: false, message: "Upload still in progress." };

  const ttl = row.size_bytes <= 20_000_000 ? 300 : 1800;
   
  const { data: signed, error: signErr } = await (db as any)
    .storage.from("task-attachments")
    .createSignedUrl(row.storage_path, ttl);

  if (signErr || !signed) {
    return { success: false, message: "Could not issue download URL." };
  }

  return { success: true, url: signed.signedUrl, expiresInSeconds: ttl };
}
