import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEventBookingImpact } from "@/lib/events";
import { toLondonDateTimeInputValue } from "@/lib/datetime";
import { isEventRescheduleEnabled } from "@/lib/feature-flags";
import { PageHeader } from "@/components/ui/design-primitives";
import { RescheduleWizard } from "@/components/events/reschedule-wizard";

export const metadata = { title: "Reschedule event · BaronsHub 1.1" };

export default async function ReschedulePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await requireAuth();
  if (user.role !== "administrator") {
    redirect("/unauthorized");
  }

  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("events")
    .select(
      "id, title, status, deleted_at, start_at, end_at, ticket_price, venue:venues!events_venue_id_fkey(name)"
    )
    .eq("id", eventId)
    .maybeSingle();
  const event = data as {
    id: string;
    title: string;
    status: string;
    deleted_at: string | null;
    start_at: string;
    end_at: string | null;
    ticket_price: number | string | null;
    venue: { name: string | null } | { name: string | null }[] | null;
  } | null;

  if (!event || event.deleted_at) notFound();
  if (event.status !== "approved") {
    redirect(`/events/${eventId}`);
  }

  const enabled = isEventRescheduleEnabled();
  const impact = await getEventBookingImpact(eventId);
  const venueRaw = Array.isArray(event.venue) ? event.venue[0] : event.venue;

  return (
    <div className="app-page">
      <div>
        <Link
          href={`/events/${eventId}`}
          className="inline-flex items-center gap-1 text-sm text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {event.title}
        </Link>
      </div>

      <PageHeader
        eyebrow="Reschedule"
        title={event.title}
        description="Move this event to a new date and transfer every booking across. Refunds are handled afterwards per guest."
      />

      <RescheduleWizard
        eventId={eventId}
        eventTitle={event.title}
        venueName={venueRaw?.name ?? null}
        ticketPrice={event.ticket_price != null ? Number(event.ticket_price) : null}
        enabled={enabled}
        startInput={toLondonDateTimeInputValue(event.start_at)}
        endInput={event.end_at ? toLondonDateTimeInputValue(event.end_at) : ""}
        impact={{
          paidCount: impact.paid.length,
          freeCount: impact.free.length,
          blocked: impact.blocked.map((b) => ({ id: b.id, name: b.name, reason: b.reason })),
          missingEmailCount: impact.missingEmailCount,
          refundTotalPence: impact.refundTotalPence,
          currency: impact.currency,
        }}
      />
    </div>
  );
}
