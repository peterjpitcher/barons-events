import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { canViewDebriefs } from "@/lib/roles";
import { formatInLondon } from "@/lib/datetime";
import { PageHeader } from "@/components/ui/design-primitives";
import { getDebriefsDue } from "@/lib/dashboard";

export default async function DebriefsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewDebriefs(user.role)) redirect("/unauthorized");

  const supabase = await createSupabaseReadonlyClient();
  const outstandingDebriefs = await getDebriefsDue(user);

  // ID-004: Filter at query level for office_worker with venueId
  let query = supabase
    .from("debriefs")
    .select(`
      id,
      event_id,
      attendance,
      wet_takings,
      food_takings,
      submitted_by,
      submitted_at,
      events!inner (
        id,
        title,
        start_at,
        venue_id,
        venues!events_venue_id_fkey ( name )
      )
    `)
    .order("submitted_at", { ascending: false });

  const { data: debriefs, error } = await query;

  if (error) {
    return (
      <div className="app-page">
        <PageHeader eyebrow="Reporting" title="Debriefs" description="Review submitted post-event debriefs." />
        <p className="rounded-[8px] border border-[var(--burgundy)] bg-[var(--burgundy-tint)] px-4 py-3 text-sm text-[var(--burgundy)]">Failed to load debriefs: {error.message}</p>
      </div>
    );
  }

  // Supabase !inner join types as array but returns object at runtime for FK relations.
  // Cast each row to a simpler shape for safe access.
  type DebriefRow = {
    id: string;
    event_id: string;
    attendance: number | null;
    wet_takings: number | null;
    food_takings: number | null;
    submitted_at: string | null;
    events: {
      title: string;
      venue_id: string;
      venues: { name: string }[] | null;
    }[];
  };
  const filtered = (debriefs ?? []) as unknown as DebriefRow[];

  if (!filtered.length && outstandingDebriefs.length === 0) {
    return (
      <div className="app-page">
        <PageHeader eyebrow="Reporting" title="Debriefs" description="Review submitted post-event debriefs." />
        <p className="rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">No debriefs found.</p>
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Reporting"
        title="Debriefs"
        description="Review submitted post-event debriefs."
        meta={<span>{outstandingDebriefs.length} outstanding · {filtered.length} submitted</span>}
      />
      <div className="space-y-3">
        {outstandingDebriefs.length > 0 ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="mobile-section-label md:text-xs">Outstanding</h2>
              <span className="rounded-full bg-[var(--mustard-tint)] px-2 py-1 text-xs font-semibold text-[var(--mustard-dark)]">
                {outstandingDebriefs.length}
              </span>
            </div>
            <div className="grid gap-2">
              {outstandingDebriefs.map((event) => (
                <Link
                  key={event.id}
                  href={`/debriefs/${event.id}`}
                  className="mobile-card block transition-colors hover:bg-[var(--paper-tint)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--ink)]">{event.title}</p>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{event.venueName || "No venue"}</p>
                    </div>
                    <span className="rounded-full bg-[var(--mustard-tint)] px-2 py-1 text-xs font-semibold text-[var(--mustard-dark)]">
                      Due
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-[var(--ink-muted)]">Ended {event.endAt ? formatInLondon(event.endAt).date : "recently"}</span>
                    <span className="font-semibold text-[var(--navy)]">Write debrief</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        {filtered.length > 0 ? (
          <h2 className="mobile-section-label pt-2 md:text-xs">Submitted</h2>
        ) : null}
        {filtered.map((debrief) => {
          const event = debrief.events?.[0];
          const venueName = event?.venues?.[0]?.name;
          return (
            <Link
              key={debrief.id}
              href={`/debriefs/${debrief.event_id}`}
              className="mobile-card block transition-colors hover:bg-[var(--paper-tint)] md:rounded-[8px]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{event?.title}</p>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {venueName}
                  </p>
                </div>
                <div className="text-right text-sm text-[var(--ink-muted)]">
                  {debrief.submitted_at
                    ? formatInLondon(debrief.submitted_at).date
                    : "Not submitted"}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[var(--ink-muted)] md:hidden">
                <span>Attendance <strong className="block text-sm text-[var(--ink)]">{debrief.attendance ?? "-"}</strong></span>
                <span>Wet <strong className="block text-sm text-[var(--ink)]">{debrief.wet_takings ?? "-"}</strong></span>
                <span>Food <strong className="block text-sm text-[var(--ink)]">{debrief.food_takings ?? "-"}</strong></span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
