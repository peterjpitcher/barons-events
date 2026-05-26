import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DebriefForm } from "@/components/events/debrief-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/design-primitives";
import { getCurrentUser } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";
import { canSubmitDebriefForEvent, canViewDebriefs } from "@/lib/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Form accepts a slightly wider defaults shape (with labour_hours) than
// getEventDetail currently returns; a cast keeps the page unchanged while
// the server action handles the extra field independently.
 
type DebriefForm_Defaults = any;

export default async function DebriefPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const event = await getEventDetail(eventId, user);
  if (!event) {
    notFound();
  }

  const canEdit = canSubmitDebriefForEvent(user.role, user.id, user.venueId, {
    venueId: event.venue_id,
    venueIds: event.venues.map((venue) => venue.id),
    managerResponsibleId: event.manager_responsible_id,
    createdBy: event.created_by,
    status: event.status,
    deletedAt: event.deleted_at,
  });
  const canView = canViewDebriefs(user.role);

  if (!canView) {
    redirect("/unauthorized");
  }

  // Load the current labour rate so the form can show live cost. Fallback
  // to the spec default if the row is missing for any reason.
  const db = createSupabaseAdminClient();
   
  const { data: rateRow } = await (db as any)
    .from("business_settings")
    .select("labour_rate_gbp")
    .eq("id", true)
    .maybeSingle();
  const labourRateGbp = Number(rateRow?.labour_rate_gbp ?? 12.71);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Post-event report"
        title="Post-event debrief"
        description="Keep it clear and simple. Numbers help the planning team understand how the night performed."
        meta={<span>{event.title}</span>}
      />
      <Card>
        <CardHeader>
          <CardTitle>{event.title}</CardTitle>
          <CardDescription>{new Date(event.start_at).toLocaleDateString("en-GB")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 rounded-[8px] border border-[var(--hair)] bg-[var(--paper-tint)] px-4 py-3 text-sm text-subtle">
            <p>
              Event:{" "}
              <Link
                href={`/events/${event.id}`}
                className="font-medium text-[var(--ink)] transition-colors hover:text-[var(--navy)]"
              >
                {event.title}
              </Link>{" "}
              ({new Date(event.start_at).toLocaleDateString("en-GB")})
            </p>
          </div>
          <DebriefForm
            eventId={event.id}
            defaults={event.debrief as DebriefForm_Defaults}
            labourRateGbp={labourRateGbp}
            readOnly={!canEdit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
