import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canViewPlanning } from "@/lib/roles";
import { getPlanningItemDetail } from "@/lib/planning";
import { AuditTrailPanel } from "@/components/audit/audit-trail-panel";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { listPlanningItemAttachmentsRollup } from "@/lib/attachments";
import { InternalNotesPanel } from "@/components/internal-notes/internal-notes-panel";
import { listInternalNotes } from "@/lib/internal-notes";
import { listAssignableUsers } from "@/lib/users";
import { listVenues } from "@/lib/venues";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canEditVenueLinkedPlanning } from "@/lib/visibility";
import { PlanningItemEditorShell, PlanningStatusControl } from "./planning-item-editor-shell";
import { PageHeader } from "@/components/ui/design-primitives";
import { PlanningOverflowMenu } from "@/components/planning/planning-overflow-menu";
import { SopChecklistView } from "@/components/planning/sop-checklist-view";
import { SopDrawer } from "@/components/events/sop-drawer";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/format";
import { CalendarDays, CheckCircle2, ClipboardList, UserRound } from "lucide-react";

export const metadata = {
  title: "Planning item · BaronsHub 1.1",
  description: "Manage a single planning item, its SOP tasks, attachments, and audit trail."
};

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export default async function PlanningItemDetailPage({
  params
}: {
  params: Promise<{ planningItemId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewPlanning(user.role)) redirect("/unauthorized");

  const { planningItemId } = await params;
  const item = await getPlanningItemDetail(planningItemId, user);
  if (!item) notFound();

  const [attachments, users, venueRows, internalNotes, userPrefsResult] = await Promise.all([
    listPlanningItemAttachmentsRollup(planningItemId),
    listAssignableUsers(),
    listVenues(),
    listInternalNotes("planning_item", planningItemId),
    createSupabaseAdminClient()
      .from("users")
      .select("sop_drawer_pinned")
      .eq("id", user.id)
      .maybeSingle()
  ]);
  const userPrefs = userPrefsResult.data;

  const canUploadAttachments = canEditVenueLinkedPlanning(user, { venueId: item.venueId, venues: item.venues });
  const completeTaskCount = item.tasks.filter((task) => task.status === "done" || task.status === "not_required").length;
  const taskPercent = item.tasks.length > 0 ? Math.round((completeTaskCount / item.tasks.length) * 100) : 0;

  const planningUsers = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email ?? "",
    role: u.role
  }));

  const visibleVenueRows =
    user.role === "manager" && user.venueId
      ? venueRows.filter((venue) => venue.id === user.venueId)
      : venueRows;

  const planningVenues = visibleVenueRows.map((venue) => {
     
    const category: "pub" | "cafe" = (venue as any).category === "cafe" ? "cafe" : "pub";
    return { id: venue.id, name: venue.name, category, isInternal: Boolean((venue as any).is_internal) };
  });

  return (
    <div className="app-page">
      <div className="hidden md:block">
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-1">
              <Link href="/planning" className="hover:text-[var(--ink)]">
                Planning
              </Link>
              <span aria-hidden="true">/</span>
              <span>Detail</span>
            </span>
          }
          title={item.title}
          description="Manage the item details, SOP tasks, attachments, and audit trail."
          meta={
            <>
              <span>{item.venueName ?? "Global"}</span>
              <span className="h-1 w-1 rounded-full bg-[var(--hair-strong)]" />
              <span>{item.tasks.length} task{item.tasks.length === 1 ? "" : "s"}</span>
            </>
          }
          actions={
            <>
              <PlanningStatusControl
                itemId={item.id}
                status={item.status}
                disabled={!canUploadAttachments}
              />
              <PlanningOverflowMenu
                itemId={item.id}
                canDelete={canUploadAttachments}
              />
            </>
          }
        />
      </div>

      <section className="mobile-card space-y-4 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href="/planning" className="mobile-eyebrow text-[var(--ink-muted)]">Planning</Link>
            <h1 className="mt-1 text-xl font-semibold text-[var(--navy)]">{item.title}</h1>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">{item.typeLabel}</p>
          </div>
          <span className="rounded-full bg-[var(--canvas-2)] px-3 py-1 text-xs font-semibold capitalize text-[var(--ink)]">
            {statusLabel(item.status)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-3">
            <UserRound className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
            <p className="mt-2 text-[0.68rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">Owner</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--ink)]">{item.ownerName ?? "Unassigned"}</p>
          </div>
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-3">
            <CalendarDays className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
            <p className="mt-2 text-[0.68rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">Target</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--ink)]">{formatDate(item.targetDate)}</p>
          </div>
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-3">
            <ClipboardList className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
            <p className="mt-2 text-[0.68rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">Tasks</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--ink)]">{completeTaskCount}/{item.tasks.length} done</p>
          </div>
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-3">
            <CheckCircle2 className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
            <p className="mt-2 text-[0.68rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">Progress</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--ink)]">{taskPercent}%</p>
          </div>
        </div>
        <p className="text-sm text-[var(--ink-muted)]">{item.venueName ?? "Global item"}</p>
        <div className="flex items-center gap-2">
          <PlanningStatusControl
            itemId={item.id}
            status={item.status}
            disabled={!canUploadAttachments}
          />
          <Button asChild variant="secondary" className="h-11 flex-1 text-white hover:text-white">
            <a href="#planning-mobile-checklist">SOP</a>
          </Button>
          <PlanningOverflowMenu
            itemId={item.id}
            canDelete={canUploadAttachments}
          />
        </div>
      </section>

      <div className="hidden flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle md:flex">
        <span>
          <span className="font-semibold text-[var(--ink)]">Manager:</span>{" "}
          {item.ownerName ?? "Unassigned"}
        </span>
        <span>
          <span className="font-semibold text-[var(--ink)]">Target:</span>{" "}
          {formatDate(item.targetDate)}
        </span>
        <Button id={`sop-drawer-trigger-${item.id}`} type="button" variant="secondary" size="sm" className="text-white hover:text-white">
          SOP
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PlanningItemEditorShell
          item={item}
          users={planningUsers}
          venues={planningVenues}
          canEdit={canUploadAttachments}
        />
        <AttachmentsPanel
          parentType="planning_item"
          parentId={item.id}
          attachments={attachments}
          canUpload={canUploadAttachments}
          viewerId={user.id}
          isAdmin={user.role === "administrator"}
          title="Attachments"
          description="Files on this planning item and every task under it."
        />
      </div>

      <section id="planning-mobile-checklist" className="mobile-card md:hidden">
        <SopChecklistView
          tasks={item.tasks}
          users={planningUsers}
          itemId={item.id}
          currentUserId={user.id}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <InternalNotesPanel
          parentType="planning_item"
          parentId={item.id}
          notes={internalNotes}
          canAdd={canUploadAttachments}
        />
        <AuditTrailPanel
          entityType="planning"
          entityId={item.id}
          description="Everything that's happened on this planning item, oldest first."
        />
      </div>
      <SopDrawer
        tasks={item.tasks}
        users={planningUsers}
        itemId={item.id}
        currentUserId={user.id}
        readOnly={!canUploadAttachments}
        initiallyPinned={Boolean(userPrefs?.sop_drawer_pinned)}
        externalTriggerId={`sop-drawer-trigger-${item.id}`}
        title="ALL TODO ITEMS FOR THIS PLANNING ITEM (SOP)"
      />
    </div>
  );
}
