import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DebriefForm } from "@/components/events/debrief-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";
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

  const event = await getEventDetail(eventId);
  if (!event) {
    notFound();
  }

  const isManager = event.manager_responsible_id === user.id;
  const isCreatorFallback = !event.manager_responsible_id && event.created_by === user.id;
  const allowed = user.role === "administrator" || isManager || isCreatorFallback;

  if (!allowed) {
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Post-event debrief</CardTitle>
          <CardDescription>
            Keep it clear and simple—numbers help the planning team understand how the night performed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 rounded-[var(--radius)] bg-muted-surface px-4 py-3 text-sm text-subtle">
            <p>
              Event:{" "}
              <Link
                href={`/events/${event.id}`}
                className="font-medium text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-600)]"
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
          />
        </CardContent>
      </Card>
    </div>
  );
}
