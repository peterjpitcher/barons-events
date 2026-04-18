import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canViewPlanning } from "@/lib/roles";
import { getPlanningItemDetail } from "@/lib/planning";
import { AuditTrailPanel } from "@/components/audit/audit-trail-panel";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { SopChecklistView } from "@/components/planning/sop-checklist-view";
import { listPlanningItemAttachmentsRollup } from "@/lib/attachments";
import { listAssignableUsers } from "@/lib/users";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Planning item · BaronsHub",
  description: "Manage a single planning item, its SOP tasks, attachments, and audit trail."
};

export default async function PlanningItemDetailPage({
  params
}: {
  params: Promise<{ planningItemId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewPlanning(user.role)) redirect("/unauthorized");

  const { planningItemId } = await params;
  const [item, attachments, users] = await Promise.all([
    getPlanningItemDetail(planningItemId),
    listPlanningItemAttachmentsRollup(planningItemId),
    listAssignableUsers()
  ]);

  if (!item) notFound();

  const canUploadAttachments =
    user.role === "administrator" ||
    (user.role === "office_worker" && (!user.venueId || user.venueId === item.venueId));

  const venueLabels = item.venues.length > 0
    ? item.venues.map((v) => v.name).join(", ")
    : item.venueName ?? "Global";

  return (
    <div className="space-y-6">
      <Link href="/planning" className="text-sm text-subtle underline">
        ← Back to planning
      </Link>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">{item.title}</CardTitle>
          <CardDescription>
            {item.typeLabel} · {venueLabels} · target {item.targetDate}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {item.description ? <p>{item.description}</p> : null}
          <dl className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
            <dt className="font-semibold text-subtle">Status</dt>
            <dd>{item.status}</dd>
            <dt className="font-semibold text-subtle">Owner</dt>
            <dd>{item.ownerName ?? "Unassigned"}</dd>
            <dt className="font-semibold text-subtle">
              {item.venues.length > 1 ? "Venues" : "Venue"}
            </dt>
            <dd>{venueLabels}</dd>
            <dt className="font-semibold text-subtle">Target date</dt>
            <dd>{item.targetDate}</dd>
            <dt className="font-semibold text-subtle">Tasks</dt>
            <dd>{item.tasks.length} total</dd>
          </dl>
          <p className="text-xs text-subtle">
            Editing (title, venues, dates, tasks) is in the board modal for now. This page surfaces the
            audit trail and attachments that the modal doesn&apos;t.
            {" "}
            <Link href={`/planning?focusItemId=${item.id}`} className="underline">
              Open in board
            </Link>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>SOP checklist</CardTitle>
              <CardDescription>
                Tasks under this item. Uploads and notes show up on the row they belong to.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SopChecklistView
                tasks={item.tasks}
                users={users.map((u) => ({ id: u.id, name: u.name, email: u.email ?? "", role: u.role }))}
                itemId={item.id}
                currentUserId={user.id}
              />
            </CardContent>
          </Card>
          <AuditTrailPanel
            entityType="planning"
            entityId={item.id}
            description="Everything that's happened on this planning item, oldest first."
          />
        </div>
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
    </div>
  );
}
