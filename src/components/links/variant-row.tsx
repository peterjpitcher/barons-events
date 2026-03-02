"use client";

import { useState } from "react";
import { Check, Copy, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { ShortLink } from "@/lib/links";
import { SHORT_LINK_BASE_URL } from "@/lib/links";

type VariantRowProps = {
  link:             ShortLink;
  touchpointLabel:  string;
  canEdit:          boolean;
  isPending:        boolean;
  confirmingDelete: boolean;
  onDeleteRequest:  () => void;
  onDeleteConfirm:  () => void;
  onDeleteCancel:   () => void;
};

export function VariantRow({
  link,
  touchpointLabel,
  canEdit,
  isPending,
  confirmingDelete,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: VariantRowProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(SHORT_LINK_BASE_URL + link.code);
      setCopied(true);
      toast.success(`${touchpointLabel} URL copied.`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  }

  return (
    <tr className="group bg-[var(--color-canvas)] hover:bg-[var(--color-muted-surface)]">
      {/* Indented name with touchpoint label */}
      <td className="py-2 pl-10 pr-4">
        <div className="flex items-center gap-1.5 text-xs text-subtle">
          <span aria-hidden="true" className="shrink-0 text-[var(--color-border)]">↳</span>
          <span className="font-medium text-[var(--color-text)]">{touchpointLabel}</span>
        </div>
      </td>

      {/* Short URL with copy button */}
      <td className="px-4 py-2" colSpan={1}>
        <div className="flex items-center gap-1.5">
          <code className="rounded bg-white px-2 py-0.5 text-xs font-mono text-[var(--color-text)] border border-[var(--color-border)]">
            /l/{link.code}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            title="Copy short URL"
            className="rounded p-1 text-subtle hover:bg-white hover:text-[var(--color-primary-700)] transition-colors"
          >
            {copied
              ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" aria-hidden="true" />
              : <Copy  className="h-3.5 w-3.5" aria-hidden="true" />
            }
            <span className="sr-only">Copy URL</span>
          </button>
        </div>
      </td>

      {/* Type — empty (inherited from parent) */}
      <td className="px-4 py-2" />

      {/* Clicks */}
      <td className="px-4 py-2 text-right tabular-nums text-xs text-subtle">
        {link.clicks.toLocaleString()}
      </td>

      {/* Expires — empty */}
      <td className="px-4 py-2" />

      {/* Created — empty */}
      <td className="px-4 py-2" />

      {/* Delete action */}
      <td className="px-4 py-2">
        {confirmingDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--color-danger)]">Delete?</span>
            <button
              type="button"
              onClick={onDeleteConfirm}
              disabled={isPending}
              className="rounded p-1 text-[var(--color-danger)] hover:bg-[rgba(239,68,68,0.1)] transition-colors"
              aria-label="Confirm delete"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onDeleteCancel}
              className="rounded p-1 text-subtle hover:bg-[var(--color-muted-surface)] transition-colors"
              aria-label="Cancel delete"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : canEdit ? (
          <button
            type="button"
            onClick={onDeleteRequest}
            title="Delete variant"
            className="rounded p-1.5 text-subtle opacity-0 group-hover:opacity-100 hover:bg-[rgba(239,68,68,0.1)] hover:text-[var(--color-danger)] transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Delete variant</span>
          </button>
        ) : null}
      </td>
    </tr>
  );
}
