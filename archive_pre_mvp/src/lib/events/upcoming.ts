import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UpcomingEvent = {
  id: string;
  title: string;
  status: string;
  startAt: string | null;
  endAt: string | null;
  venueId: string | null;
  venueName: string | null;
};

type FetchUpcomingEventsArgs = {
  days?: number;
  limit?: number;
};

export async function fetchUpcomingEvents({
  days = 7,
  limit = 50,
}: FetchUpcomingEventsArgs = {}): Promise<UpcomingEvent[]> {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + days);

  const { data, error } = await supabase
    .from("events")
    .select(
      `id,title,status,start_at,end_at,venue_id,venue:venues(name)`
    )
    .gte("start_at", now.toISOString())
    .lte("start_at", end.toISOString())
    .order("start_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.warn("[events] fetchUpcomingEvents error", error.message);
    return [];
  }

  type RawEventRow = {
    id: string;
    title: string | null;
    status: string | null;
    start_at: string | null;
    end_at: string | null;
    venue_id: string | null;
    venue?:
      | { name: string | null }
      | Array<{ name: string | null }>
      | null;
  };

  const rows = (data ?? []) as RawEventRow[];

  return rows.map((row) => {
    const venueValue = Array.isArray(row.venue)
      ? row.venue[0]?.name ?? null
      : row.venue?.name ?? null;

    return {
      id: row.id,
      title: row.title ?? "Untitled event",
      status: row.status ?? "unknown",
      startAt: row.start_at ?? null,
      endAt: row.end_at ?? null,
      venueId: row.venue_id ?? null,
      venueName: venueValue,
    } satisfies UpcomingEvent;
  });
}
