import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { canViewDebriefs } from "@/lib/roles";
import { formatInLondon } from "@/lib/datetime";
import { PageHeader } from "@/components/ui/design-primitives";

export default async function DebriefsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewDebriefs(user.role)) redirect("/unauthorized");

  const supabase = await createSupabaseReadonlyClient();

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
    submitted_at: string | null;
    events: {
      title: string;
      venue_id: string;
      venues: { name: string }[] | null;
    }[];
  };
  const filtered = (debriefs ?? []) as unknown as DebriefRow[];

  if (!filtered.length) {
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
        meta={<span>{filtered.length} submission{filtered.length === 1 ? "" : "s"}</span>}
      />
      <div className="space-y-3">
        {filtered.map((debrief) => {
          const event = debrief.events?.[0];
          const venueName = event?.venues?.[0]?.name;
          return (
            <Link
              key={debrief.id}
              href={`/debriefs/${debrief.event_id}`}
              className="block rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] p-4 shadow-card transition-colors hover:bg-[var(--paper-tint)]"
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
            </Link>
          );
        })}
      </div>
    </div>
  );
}
