"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ShortLink } from "@/lib/links";
import { createShortLinkAction, updateShortLinkAction, deleteShortLinkAction } from "@/actions/links";
import { LinkForm, type LinkFormValues } from "./link-form";
import { LinkRow } from "./link-row";

type LinksManagerProps = {
  links:   ShortLink[];
  canEdit: boolean;
};

export function LinksManager({ links: initialLinks, canEdit }: LinksManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [links, setLinks]                     = useState<ShortLink[]>(initialLinks);
  const [showCreateForm, setShowCreateForm]   = useState(false);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId]             = useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── Create ────────────────────────────────────────────────────────────────

  function handleCreate(values: LinkFormValues) {
    setCreateFieldErrors({});
    startTransition(async () => {
      const result = await createShortLinkAction({
        name:        values.name,
        destination: values.destination,
        link_type:   values.link_type,
        expires_at:  values.expires_at || null,
      });

      if (!result.success) {
        if (result.fieldErrors) setCreateFieldErrors(result.fieldErrors);
        toast.error(result.message ?? "Could not create link.");
        return;
      }

      if (result.link) setLinks((prev) => [result.link!, ...prev]);
      setShowCreateForm(false);
      toast.success(result.message ?? "Link created.");
      router.refresh();
    });
  }

  // ── Update ────────────────────────────────────────────────────────────────

  function handleSaveEdit(id: string, values: LinkFormValues) {
    setEditFieldErrors({});
    startTransition(async () => {
      const result = await updateShortLinkAction({
        id,
        name:        values.name,
        destination: values.destination,
        link_type:   values.link_type,
        expires_at:  values.expires_at || null,
      });

      if (!result.success) {
        if (result.fieldErrors) setEditFieldErrors(result.fieldErrors);
        toast.error(result.message ?? "Could not update link.");
        return;
      }

      setLinks((prev) =>
        prev.map((l) =>
          l.id === id
            ? { ...l, name: values.name, destination: values.destination, link_type: values.link_type, expires_at: values.expires_at || null }
            : l
        )
      );
      setEditingId(null);
      toast.success(result.message ?? "Link updated.");
      router.refresh();
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteShortLinkAction({ id });

      if (!result.success) {
        toast.error(result.message ?? "Could not delete link.");
        return;
      }

      setLinks((prev) => prev.filter((l) => l.id !== id));
      setConfirmDeleteId(null);
      toast.success(result.message ?? "Link deleted.");
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-subtle">
          {links.length} link{links.length !== 1 ? "s" : ""}
        </p>
        {canEdit && (
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => { setShowCreateForm(true); setCreateFieldErrors({}); }}
            disabled={showCreateForm || isPending}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Add link
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && canEdit && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-4 shadow-soft">
          <p className="mb-3 text-sm font-semibold text-[var(--color-text)]">New short link</p>
          <LinkForm
            mode="create"
            fieldErrors={createFieldErrors}
            onSubmit={handleCreate}
            onCancel={() => { setShowCreateForm(false); setCreateFieldErrors({}); }}
            isPending={isPending}
          />
        </div>
      )}

      {/* Empty state */}
      {links.length === 0 && !showCreateForm && (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-white py-14 text-center">
          <QrCode className="mx-auto mb-3 h-8 w-8 text-subtle" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--color-text)]">No short links yet</p>
          <p className="mt-1 text-xs text-subtle">Create one to generate UTM-tagged URLs and QR codes.</p>
        </div>
      )}

      {/* Table */}
      {links.length > 0 && (
        <div className="overflow-visible rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted-surface)] text-left text-xs font-semibold uppercase tracking-[0.1em] text-subtle">
                  <th className="px-4 py-3">Name / Destination</th>
                  <th className="px-4 py-3">Short URL</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {links.map((link) => (
                  <LinkRow
                    key={link.id}
                    link={link}
                    canEdit={canEdit}
                    isEditing={editingId === link.id}
                    confirmingDelete={confirmDeleteId === link.id}
                    fieldErrors={editingId === link.id ? editFieldErrors : undefined}
                    isPending={isPending}
                    onEdit={() => { setEditingId(link.id); setEditFieldErrors({}); }}
                    onSaveEdit={(values) => handleSaveEdit(link.id, values)}
                    onCancelEdit={() => setEditingId(null)}
                    onDeleteRequest={() => setConfirmDeleteId(link.id)}
                    onDeleteConfirm={() => handleDelete(link.id)}
                    onDeleteCancel={() => setConfirmDeleteId(null)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
