"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarX, Check, ChevronDown, ChevronRight, Copy, Plus, QrCode, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SHORT_LINK_BASE_URL,
  groupLinks,
  getVariantLabel,
  isShortLinkExpired,
  type ShortLink,
} from "@/lib/links";
import { createShortLinkAction, updateShortLinkAction, deleteShortLinkAction } from "@/actions/links";
import { LinkForm, type LinkFormValues } from "./link-form";
import { LinkRow } from "./link-row";
import { VariantRow } from "./variant-row";
import { Badge } from "@/components/ui/badge";

type LinksManagerProps = {
  links:   ShortLink[];
  canEdit: boolean;
};

export function LinksManager({ links: initialLinks, canEdit }: LinksManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [links, setLinks]                         = useState<ShortLink[]>(initialLinks);
  const [showCreateForm, setShowCreateForm]       = useState(false);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId]                 = useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors]     = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId]     = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups]       = useState<Set<string>>(new Set());

  // ── Server-state reconciliation ───────────────────────────────────────────
  // revalidatePath/router.refresh() deliver fresh `links` props; without this
  // sync the list would never converge with the server (system-created links,
  // other admins' changes, variant propagation). Optimistic rows that the
  // server snapshot hasn't caught up with yet are preserved until confirmed.
  const optimisticAddsRef = useRef<Set<string>>(new Set());
  const prevServerLinksRef = useRef<ShortLink[]>(initialLinks);

  useEffect(() => {
    if (prevServerLinksRef.current === initialLinks) return;
    prevServerLinksRef.current = initialLinks;
    setLinks((prev) => {
      const serverIds = new Set(initialLinks.map((l) => l.id));
      for (const id of [...optimisticAddsRef.current]) {
        if (serverIds.has(id)) optimisticAddsRef.current.delete(id); // confirmed by server
      }
      const inFlight = prev.filter((l) => !serverIds.has(l.id) && optimisticAddsRef.current.has(l.id));
      return [...inFlight, ...initialLinks];
    });
  }, [initialLinks]);

  const groups = groupLinks(links);

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

      if (result.link) {
        optimisticAddsRef.current.add(result.link.id);
        setLinks((prev) => [result.link!, ...prev]);
      }
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
        // The parent may still have been updated (partial variant failure) —
        // refresh so the list reflects the server truth.
        router.refresh();
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

      // The FK cascade also removes the link's variants — mirror that locally.
      setLinks((prev) => prev.filter((l) => l.id !== id && l.parent_link_id !== id));
      setConfirmDeleteId(null);
      toast.success(result.message ?? "Link deleted.");
      router.refresh();
    });
  }

  // ── New variant callback (called by UtmDropdown → LinkRow) ────────────────

  function handleNewVariant(parentId: string, newLink: ShortLink) {
    setLinks((prev) => {
      // Already present (e.g. a reused variant we know about) — no duplicate row.
      if (prev.some((l) => l.id === newLink.id)) return prev;
      optimisticAddsRef.current.add(newLink.id);
      return [...prev, newLink];
    });
    // Auto-expand the parent group so the user sees the new sub-link.
    setExpandedGroups((prev) => new Set([...prev, parentId]));
  }

  async function copyShortUrl(link: ShortLink) {
    const url = `${SHORT_LINK_BASE_URL}${link.code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Short URL copied.");
    } catch {
      toast.error("Could not copy URL.");
    }
  }

  async function shareShortUrl(link: ShortLink) {
    const url = `${SHORT_LINK_BASE_URL}${link.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: link.name, url });
        return;
      } catch {
        return;
      }
    }
    await copyShortUrl(link);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Flat list of rows rendered inside <tbody>: parent rows + conditionally
  // their variant sub-rows immediately after.
  const rows: React.ReactNode[] = [];

  for (const { parent, variants } of groups) {
    const isExpanded = expandedGroups.has(parent.id);
    const totalClicks = parent.clicks + variants.reduce((sum, v) => sum + v.clicks, 0);

    rows.push(
      <LinkRow
        key={parent.id}
        link={parent}
        canEdit={canEdit}
        isEditing={editingId === parent.id}
        confirmingDelete={confirmDeleteId === parent.id}
        fieldErrors={editingId === parent.id ? editFieldErrors : undefined}
        isPending={isPending}
        variantCount={variants.length}
        totalClicks={totalClicks}
        isExpanded={isExpanded}
        onToggleExpand={() =>
          setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(parent.id)) next.delete(parent.id);
            else next.add(parent.id);
            return next;
          })
        }
        onNewVariant={(newLink) => handleNewVariant(parent.id, newLink)}
        onEdit={() => { setEditingId(parent.id); setEditFieldErrors({}); }}
        onSaveEdit={(values) => handleSaveEdit(parent.id, values)}
        onCancelEdit={() => setEditingId(null)}
        onDeleteRequest={() => setConfirmDeleteId(parent.id)}
        onDeleteConfirm={() => handleDelete(parent.id)}
        onDeleteCancel={() => setConfirmDeleteId(null)}
      />
    );

    if (isExpanded) {
      for (const variant of variants) {
        rows.push(
          <VariantRow
            key={variant.id}
            link={variant}
            touchpointLabel={getVariantLabel(variant)}
            canEdit={canEdit}
            isPending={isPending}
            confirmingDelete={confirmDeleteId === variant.id}
            onDeleteRequest={() => setConfirmDeleteId(variant.id)}
            onDeleteConfirm={() => handleDelete(variant.id)}
            onDeleteCancel={() => setConfirmDeleteId(null)}
          />
        );
      }
    }
  }

  const activeCount = groups.filter((g) => !isShortLinkExpired(g.parent.expires_at)).length;
  const expiredCount = groups.length - activeCount;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-subtle">
          {activeCount} active link{activeCount !== 1 ? "s" : ""}
          {expiredCount > 0 ? ` · ${expiredCount} expired` : ""}
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
        <div className="rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-4 shadow-card">
          <p className="mb-3 text-sm font-semibold text-[var(--ink)]">New short link</p>
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
      {groups.length === 0 && !showCreateForm && (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--hair)] bg-[var(--paper)] py-14 text-center">
          <QrCode className="mx-auto mb-3 h-8 w-8 text-subtle" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--ink)]">No short links yet</p>
          <p className="mt-1 text-xs text-subtle">Create one to generate UTM-tagged URLs and QR codes.</p>
        </div>
      )}

      {/* Table */}
      {groups.length > 0 && (
        <>
        <div className="space-y-2 md:hidden">
          {groups.map(({ parent, variants }) => {
            const isExpanded = expandedGroups.has(parent.id);
            const totalClicks = parent.clicks + variants.reduce((sum, variant) => sum + variant.clicks, 0);
            const shortUrl = `${SHORT_LINK_BASE_URL}${parent.code}`;
            const expired = isShortLinkExpired(parent.expires_at);
            if (editingId === parent.id) {
              return (
                <div key={parent.id} className="mobile-card">
                  <p className="mb-3 text-sm font-semibold text-[var(--ink)]">Edit short link</p>
                  <LinkForm
                    mode="edit"
                    initialValues={parent}
                    fieldErrors={editFieldErrors}
                    onSubmit={(values) => handleSaveEdit(parent.id, values)}
                    onCancel={() => setEditingId(null)}
                    isPending={isPending}
                  />
                </div>
              );
            }
            return (
              <article key={parent.id} className="mobile-card space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[8px] border border-[var(--hair)] bg-[var(--canvas-2)]">
                    <QrCode className="h-7 w-7 text-[var(--navy)]" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="truncate font-semibold text-[var(--ink)]">{parent.name}</h2>
                        <p className="mt-1 truncate font-mono text-xs text-[var(--ink-muted)]">{shortUrl}</p>
                      </div>
                      <span className="text-right text-sm font-semibold tabular-nums text-[var(--navy)]">
                        {totalClicks.toLocaleString()}
                        <span className="block text-xs font-medium text-[var(--ink-soft)]">clicks</span>
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={parent.link_type === "event" ? "success" : parent.link_type === "menu" ? "warning" : "info"} className="capitalize">
                        {parent.link_type}
                      </Badge>
                      {expired && (
                        <Badge variant="danger" className="gap-1">
                          <CalendarX className="h-3 w-3" aria-hidden="true" />
                          Expired
                        </Badge>
                      )}
                      {variants.length > 0 ? (
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--canvas-2)] px-2 text-xs font-semibold text-[var(--ink-muted)]"
                          onClick={() =>
                            setExpandedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(parent.id)) next.delete(parent.id);
                              else next.add(parent.id);
                              return next;
                            })
                          }
                        >
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                          {variants.length} variant{variants.length === 1 ? "" : "s"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="secondary" className="h-11" onClick={() => void copyShortUrl(parent)}>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    Copy
                  </Button>
                  <Button type="button" variant="secondary" className="h-11" onClick={() => void shareShortUrl(parent)}>
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    Share link
                  </Button>
                </div>
                {canEdit ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="ghost" className="h-11" onClick={() => { setEditingId(parent.id); setEditFieldErrors({}); }}>
                      Edit
                    </Button>
                    {confirmDeleteId === parent.id ? (
                      <Button type="button" variant="destructive" className="h-11" disabled={isPending} onClick={() => handleDelete(parent.id)}>
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Confirm
                      </Button>
                    ) : (
                      <Button type="button" variant="destructive" className="h-11" onClick={() => setConfirmDeleteId(parent.id)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Delete
                      </Button>
                    )}
                  </div>
                ) : null}
                {isExpanded && variants.length > 0 ? (
                  <div className="space-y-2 border-t border-[var(--hair)] pt-3">
                    {variants.map((variant) => {
                      return (
                        <div key={variant.id} className="rounded-[8px] bg-[var(--canvas-2)] p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-[var(--ink)]">{getVariantLabel(variant)}</p>
                              <p className="mt-1 truncate font-mono text-xs text-[var(--ink-muted)]">{SHORT_LINK_BASE_URL}{variant.code}</p>
                            </div>
                            <span className="text-sm font-semibold tabular-nums text-[var(--navy)]">{variant.clicks}</span>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button type="button" className="text-xs font-semibold text-[var(--ink)]" onClick={() => void copyShortUrl(variant)}>
                              Copy
                            </button>
                            {canEdit ? (
                              confirmDeleteId === variant.id ? (
                                <button type="button" className="text-xs font-semibold text-[var(--burgundy)]" disabled={isPending} onClick={() => handleDelete(variant.id)}>
                                  Confirm delete
                                </button>
                              ) : (
                                <button type="button" className="text-xs font-semibold text-[var(--burgundy)]" onClick={() => setConfirmDeleteId(variant.id)}>
                                  Delete
                                </button>
                              )
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        <div className="data-table-shell hidden overflow-visible md:block">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr className="border-b border-[var(--hair)] bg-[var(--canvas-2)] text-left text-xs font-semibold uppercase tracking-[0.1em] text-subtle">
                  <th className="px-4 py-3">Name / Destination</th>
                  <th className="px-4 py-3">Short URL</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hair)]">
                {rows}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
