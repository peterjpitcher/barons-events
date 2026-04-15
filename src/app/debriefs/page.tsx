import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { canViewDebriefs } from "@/lib/roles";
import { formatInLondon } from "@/lib/datetime";

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
        venues ( name )
      )
    `)
    .order("submitted_at", { ascending: false });

  // Venue-scoped filtering: office_worker with venueId only sees their venue's debriefs
  if (user.role === "office_worker" && user.venueId) {
    query = query.eq("events.venue_id", user.venueId);
  }

  const { data: debriefs, error } = await query;

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Debriefs</h1>
        <p className="text-red-600">Failed to load debriefs: {error.message}</p>
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
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Debriefs</h1>
        <p className="text-[var(--color-text-muted)]">No debriefs found.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Debriefs</h1>
      <div className="space-y-3">
        {filtered.map((debrief) => {
          const event = debrief.events?.[0];
          const venueName = event?.venues?.[0]?.name;
          return (
            <Link
              key={debrief.id}
              href={`/debriefs/${debrief.event_id}`}
              className="block rounded-xl border border-[var(--color-border)] p-4 hover:bg-[rgba(39,54,64,0.06)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{event?.title}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {venueName}
                  </p>
                </div>
                <div className="text-right text-sm text-[var(--color-text-muted)]">
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
