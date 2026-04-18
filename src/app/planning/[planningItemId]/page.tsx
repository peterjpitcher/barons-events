import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canViewPlanning } from "@/lib/roles";
import { getPlanningItemDetail } from "@/lib/planning";
import { AuditTrailPanel } from "@/components/audit/audit-trail-panel";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { listPlanningItemAttachmentsRollup } from "@/lib/attachments";
import { listAssignableUsers } from "@/lib/users";
import { listVenues } from "@/lib/venues";
import { PlanningItemEditorShell } from "./planning-item-editor-shell";

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
  const [item, attachments, users, venueRows] = await Promise.all([
    getPlanningItemDetail(planningItemId),
    listPlanningItemAttachmentsRollup(planningItemId),
    listAssignableUsers(),
    listVenues()
  ]);

  if (!item) notFound();

  const canUploadAttachments =
    user.role === "administrator" ||
    (user.role === "office_worker" && (!user.venueId || user.venueId === item.venueId));

  const planningUsers = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email ?? "",
    role: u.role
  }));

  const planningVenues = venueRows.map((venue) => {
     
    const category: "pub" | "cafe" = (venue as any).category === "cafe" ? "cafe" : "pub";
    return { id: venue.id, name: venue.name, category };
  });

  return (
    <div className="space-y-6">
      <Link href="/planning" className="text-sm text-subtle underline">
        ← Back to planning
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* Full edit surface — matches the modal experience the planning
              board used to open. All inline editors (title, venues, dates,
              tasks, notes, attachments, status) live here. */}
          <PlanningItemEditorShell
            item={item}
            users={planningUsers}
            venues={planningVenues}
            currentUserId={user.id}
          />
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
