"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ShortLink } from "@/lib/links";
import { LinkForm, type LinkFormValues } from "./link-form";
import { UtmDropdown } from "./utm-dropdown";

type LinkRowProps = {
  link:             ShortLink;
  canEdit:          boolean;
  isEditing:        boolean;
  confirmingDelete: boolean;
  fieldErrors?:     Record<string, string>;
  isPending:        boolean;
  onEdit:           () => void;
  onSaveEdit:       (values: LinkFormValues) => void;
  onCancelEdit:     () => void;
  onDeleteRequest:  () => void;
  onDeleteConfirm:  () => void;
  onDeleteCancel:   () => void;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day:   "numeric",
    month: "short",
    year:  "numeric",
  });
}

const TYPE_TONE: Record<string, "neutral" | "info" | "success" | "warning"> = {
  event:   "success",
  booking: "info",
  social:  "info",
  menu:    "warning",
  general: "neutral",
  other:   "neutral",
};

export function LinkRow({
  link,
  canEdit,
  isEditing,
  confirmingDelete,
  fieldErrors,
  isPending,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: LinkRowProps) {
  if (isEditing) {
    return (
      <tr>
        <td colSpan={7} className="px-4 py-4 bg-[var(--color-canvas)]">
          <LinkForm
            mode="edit"
            initialValues={link}
            fieldErrors={fieldErrors}
            onSubmit={onSaveEdit}
            onCancel={onCancelEdit}
            isPending={isPending}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr className="group hover:bg-[var(--color-canvas)]">
      {/* Name + destination */}
      <td className="px-4 py-3">
        <p className="font-medium text-[var(--color-text)]">{link.name}</p>
        <a
          href={link.destination}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-subtle hover:text-[var(--color-primary-700)] transition-colors max-w-[260px] truncate block"
        >
          {link.destination}
        </a>
      </td>

      {/* Short code */}
      <td className="px-4 py-3">
        <code className="rounded bg-[var(--color-muted-surface)] px-2 py-0.5 text-xs font-mono text-[var(--color-text)]">
          /l/{link.code}
        </code>
      </td>

      {/* Type */}
      <td className="px-4 py-3">
        <Badge variant={TYPE_TONE[link.link_type] ?? "neutral"} className="capitalize">
          {link.link_type}
        </Badge>
      </td>

      {/* Clicks */}
      <td className="px-4 py-3 text-right tabular-nums text-sm text-[var(--color-text)]">
        {link.clicks.toLocaleString()}
      </td>

      {/* Expires */}
      <td className="px-4 py-3 text-sm text-subtle">
        {link.expires_at ? formatDate(link.expires_at) : <span className="italic">Never</span>}
      </td>

      {/* Created */}
      <td className="px-4 py-3 text-sm text-subtle whitespace-nowrap">
        {formatDate(link.created_at)}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
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
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onDeleteCancel}
              className="rounded p-1 text-subtle hover:bg-[var(--color-muted-surface)] transition-colors"
              aria-label="Cancel delete"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <UtmDropdown link={link} mode="share" disabled={isPending} />
            <UtmDropdown link={link} mode="print" disabled={isPending} />
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  title="Edit link"
                  className="rounded p-1.5 text-subtle hover:bg-[var(--color-muted-surface)] hover:text-[var(--color-primary-700)] transition-colors"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Edit link</span>
                </button>
                <button
                  type="button"
                  onClick={onDeleteRequest}
                  title="Delete link"
                  className="rounded p-1.5 text-subtle hover:bg-[rgba(239,68,68,0.1)] hover:text-[var(--color-danger)] transition-colors"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Delete link</span>
                </button>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
