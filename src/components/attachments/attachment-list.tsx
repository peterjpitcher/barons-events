"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Download, History, Pencil, Trash2, Upload, X } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  confirmAttachmentVersionUploadAction,
  deleteAttachmentAction,
  getAttachmentUrlAction,
  getAttachmentVersionUrlAction,
  renameAttachmentAction,
  requestAttachmentVersionUploadAction,
  type RequestAttachmentVersionUploadResult
} from "@/actions/attachments";
import type { AttachmentSummary } from "@/lib/attachments-types";
import { formatBytes } from "@/lib/attachments-types";

type AttachmentListProps = {
  attachments: AttachmentSummary[];
  /** Whether the current viewer can delete — typically admin OR the uploader. */
  canDelete?: (attachment: AttachmentSummary) => boolean;
  /** Whether the current viewer can mutate file metadata and versions. */
  canManage?: (attachment: AttachmentSummary) => boolean;
  onChanged?: () => void;
  /** When true, renders a section heading with a supplied label. */
  heading?: string;
  emptyMessage?: string;
};

type AttachmentActionButtonProps = Omit<ButtonProps, "children" | "aria-label" | "title"> & {
  tooltip: string;
  ariaLabel?: string;
  children: ReactNode;
};

function AttachmentActionButton({ tooltip, ariaLabel, children, ...props }: AttachmentActionButtonProps) {
  return (
    <span className="group relative inline-flex">
      <Button {...props} aria-label={ariaLabel ?? tooltip} title={tooltip}>
        {children}
      </Button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-[80] mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-[7px] border border-[var(--hair)] bg-[var(--navy)] px-2.5 py-1.5 text-xs font-medium leading-4 text-white shadow-card group-hover:block group-focus-within:block"
      >
        {tooltip}
      </span>
    </span>
  );
}

const versionTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function formatVersionTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return versionTimestampFormatter.format(date);
}

function formatVersionUploader(version: AttachmentSummary["versions"][number]): string {
  return version.uploadedByName ?? version.uploadedByEmail ?? "Unknown uploader";
}

export function AttachmentList({
  attachments,
  canDelete,
  canManage,
  onChanged,
  heading,
  emptyMessage = "No attachments yet."
}: AttachmentListProps) {
  const [isPending, startTransition] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [historyAttachment, setHistoryAttachment] = useState<AttachmentSummary | null>(null);

  const canMutate = (attachment: AttachmentSummary) => canManage?.(attachment) ?? canDelete?.(attachment) ?? false;

  function download(attachment: AttachmentSummary) {
    startTransition(async () => {
      const result = await getAttachmentUrlAction({ attachmentId: attachment.id });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  function confirmDelete(id: string) {
    setConfirmingId(id);
  }

  function performDelete(id: string) {
    startTransition(async () => {
      const form = new FormData();
      form.set("attachmentId", id);
      const result = await deleteAttachmentAction(undefined, form);
      if (!result.success) {
        toast.error(result.message ?? "Could not delete.");
        return;
      }
      toast.success("Attachment deleted.");
      onChanged?.();
    });
    setConfirmingId(null);
  }

  function startRename(attachment: AttachmentSummary) {
    setRenamingId(attachment.id);
    setRenameDraft(attachment.displayName ?? attachment.originalFilename);
  }

  function saveRename(attachment: AttachmentSummary) {
    const nextName = renameDraft.trim();
    if (!nextName) {
      toast.error("Add a filename.");
      return;
    }
    startTransition(async () => {
      const form = new FormData();
      form.set("attachmentId", attachment.id);
      form.set("displayName", nextName);
      const result = await renameAttachmentAction(undefined, form);
      if (!result.success) {
        toast.error(result.message ?? "Could not rename attachment.");
        return;
      }
      toast.success(result.message ?? "Filename updated.");
      setRenamingId(null);
      onChanged?.();
    });
  }

  async function uploadWithFetch(url: string, file: File): Promise<void> {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file
    });
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
  }

  function uploadNewVersion(attachment: AttachmentSummary, file: File) {
    startTransition(async () => {
      let result: RequestAttachmentVersionUploadResult;
      try {
        result = await requestAttachmentVersionUploadAction({
          attachmentId: attachment.id,
          originalFilename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size
        });
      } catch (error) {
        console.error("requestAttachmentVersionUploadAction threw:", error);
        toast.error("Could not start version upload.");
        return;
      }

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      try {
        await uploadWithFetch(result.uploadUrl, file);
      } catch (error) {
        console.error("attachment version upload PUT failed:", error);
        toast.error("Upload failed.");
        return;
      }

      const form = new FormData();
      form.set("attachmentId", attachment.id);
      form.set("storagePath", result.storagePath);
      form.set("versionNo", String(result.versionNo));
      form.set("originalFilename", file.name);
      form.set("mimeType", file.type || "application/octet-stream");
      form.set("sizeBytes", String(file.size));
      const confirmResult = await confirmAttachmentVersionUploadAction(undefined, form);
      if (!confirmResult.success) {
        toast.error(confirmResult.message ?? "Could not verify new version.");
        return;
      }

      toast.success("New version uploaded.");
      onChanged?.();
    });
  }

  function downloadVersion(versionId: string) {
    startTransition(async () => {
      const result = await getAttachmentVersionUrlAction({ versionId });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  if (attachments.length === 0) {
    return (
      <div className="space-y-2">
        {heading ? <h4 className="text-sm font-semibold text-[var(--ink)]">{heading}</h4> : null}
        <p className="text-sm text-subtle">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {heading ? <h4 className="text-sm font-semibold text-[var(--ink)]">{heading}</h4> : null}
      <ul className="space-y-2">
        {attachments.map((attachment) => {
          const fileLabel = attachment.displayName ?? attachment.originalFilename;
          const versionInputId = `attachment-version-${attachment.id}`;
          const hasVersionHistory = attachment.versions.length > 0;
          return (
          <li
            key={attachment.id}
            className="flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--paper)] p-2 text-sm"
          >
            {renamingId === attachment.id ? (
              <span className="flex min-w-[12rem] flex-1 items-center gap-1">
                <input
                  value={renameDraft}
                  maxLength={180}
                  disabled={isPending}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--paper)] px-2 py-1 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--mustard)]"
                  aria-label={`Rename ${fileLabel}`}
                />
                <AttachmentActionButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isPending}
                  onClick={() => saveRename(attachment)}
                  tooltip="Save filename"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                </AttachmentActionButton>
                <AttachmentActionButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isPending}
                  onClick={() => setRenamingId(null)}
                  tooltip="Cancel rename"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </AttachmentActionButton>
              </span>
            ) : (
              <span className="flex-1 truncate font-medium text-[var(--ink)]" title={fileLabel}>
                {fileLabel}
              </span>
            )}
            <span className="text-xs text-subtle">{formatBytes(attachment.sizeBytes)}</span>
            {attachment.versionCount > 1 ? (
              <span className="rounded-full bg-[var(--canvas-2)] px-2 py-0.5 text-xs text-subtle">
                v{attachment.versions[0]?.versionNo ?? attachment.versionCount}
              </span>
            ) : null}
            <AttachmentActionButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => download(attachment)}
              disabled={isPending}
              tooltip="Download"
              ariaLabel={`Download ${attachment.originalFilename}`}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </AttachmentActionButton>
            <AttachmentActionButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setHistoryAttachment(attachment)}
              disabled={isPending || !hasVersionHistory}
              tooltip={hasVersionHistory ? "Version history" : "No version history yet"}
              ariaLabel={hasVersionHistory ? `View version history for ${fileLabel}` : `No version history for ${fileLabel}`}
            >
              <History className="h-4 w-4" aria-hidden="true" />
            </AttachmentActionButton>
            {canMutate(attachment) ? (
              <>
                <AttachmentActionButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => startRename(attachment)}
                  disabled={isPending}
                  tooltip="Rename"
                  ariaLabel={`Rename ${fileLabel}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </AttachmentActionButton>
                <input
                  id={versionInputId}
                  type="file"
                  className="sr-only"
                  disabled={isPending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) uploadNewVersion(attachment, file);
                  }}
                />
                <AttachmentActionButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => document.getElementById(versionInputId)?.click()}
                  tooltip="Upload new version"
                  ariaLabel={`Upload new version of ${fileLabel}`}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                </AttachmentActionButton>
              </>
            ) : null}
            {canDelete?.(attachment) ? (
              <AttachmentActionButton
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => confirmDelete(attachment.id)}
                disabled={isPending}
                tooltip="Delete"
                ariaLabel={`Delete ${attachment.originalFilename}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </AttachmentActionButton>
            ) : null}
          </li>
          );
        })}
      </ul>
      {historyAttachment ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => setHistoryAttachment(null)}
        >
          <div
            className="w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-5 shadow-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attachment-history-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="attachment-history-title" className="text-lg font-semibold text-[var(--ink)]">Version history</h2>
                <p className="mt-1 truncate text-sm text-subtle">{historyAttachment.displayName ?? historyAttachment.originalFilename}</p>
              </div>
              <AttachmentActionButton
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setHistoryAttachment(null)}
                tooltip="Close version history"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </AttachmentActionButton>
            </div>
            <ul className="mt-4 space-y-2">
              {historyAttachment.versions.map((version) => (
                <li key={version.id} className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--hair)] px-3 py-2 text-sm">
                  <span className="shrink-0 font-semibold text-[var(--ink)]">v{version.versionNo}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--ink)]" title={version.originalFilename}>{version.originalFilename}</span>
                    <span className="mt-0.5 block text-xs text-subtle">
                      Uploaded by {formatVersionUploader(version)} · {formatVersionTimestamp(version.uploadedAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-subtle">{formatBytes(version.sizeBytes)}</span>
                  <AttachmentActionButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => downloadVersion(version.id)}
                    disabled={isPending}
                    tooltip="Download version"
                    ariaLabel={`Download version ${version.versionNo}`}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </AttachmentActionButton>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmingId !== null}
        title="Delete attachment?"
        description="The file will be removed from the storage bucket and marked deleted. This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (confirmingId) performDelete(confirmingId);
        }}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}
