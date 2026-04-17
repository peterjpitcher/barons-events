"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteAttachmentAction, getAttachmentUrlAction } from "@/actions/attachments";
import type { AttachmentSummary } from "@/lib/attachments-types";
import { formatBytes } from "@/lib/attachments-types";
import { useState } from "react";

type AttachmentListProps = {
  attachments: AttachmentSummary[];
  /** Whether the current viewer can delete — typically admin OR the uploader. */
  canDelete?: (attachment: AttachmentSummary) => boolean;
  onChanged?: () => void;
  /** When true, renders a section heading with a supplied label. */
  heading?: string;
  emptyMessage?: string;
};

export function AttachmentList({
  attachments,
  canDelete,
  onChanged,
  heading,
  emptyMessage = "No attachments yet."
}: AttachmentListProps) {
  const [isPending, startTransition] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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

  if (attachments.length === 0) {
    return (
      <div className="space-y-2">
        {heading ? <h4 className="text-sm font-semibold text-[var(--color-text)]">{heading}</h4> : null}
        <p className="text-sm text-subtle">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {heading ? <h4 className="text-sm font-semibold text-[var(--color-text)]">{heading}</h4> : null}
      <ul className="space-y-2">
        {attachments.map((attachment) => (
          <li
            key={attachment.id}
            className="flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white p-2 text-sm"
          >
            <span className="flex-1 truncate font-medium text-[var(--color-text)]" title={attachment.originalFilename}>
              {attachment.originalFilename}
            </span>
            <span className="text-xs text-subtle">{formatBytes(attachment.sizeBytes)}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => download(attachment)}
              disabled={isPending}
              aria-label={`Download ${attachment.originalFilename}`}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </Button>
            {canDelete?.(attachment) ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => confirmDelete(attachment.id)}
                disabled={isPending}
                aria-label={`Delete ${attachment.originalFilename}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
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
