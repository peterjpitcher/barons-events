import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  detectNoteClashes,
  type ClashEventInput,
  type ClashNoteInput,
} from "@/lib/calendar-notes/clash";

const LIST_CAP = 2000;
const CLASH_WINDOW_DAYS = 90;

export type CalendarNote = {
  id: string;
  venueId: string;
  venueName: string;
  startDate: string;
  endDate: string | null;
  title: string;
  detail: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CalendarNoteClash = {
  event: { id: string; title: string };
  note: { id: string; title: string; venueName: string; startDate: string; endDate: string | null };
};

type NoteRow = {
  id: string;
  venue_id: string;
  start_date: string;
  end_date: string | null;
  title: string;
  detail: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  venue: { id: string; name: string } | { id: string; name: string }[] | null;
};

function mapNote(row: NoteRow): CalendarNote {
  const venue = Array.isArray(row.venue) ? row.venue[0] : row.venue;
  return {
    id: row.id,
    venueId: row.venue_id,
    venueName: venue?.name ?? "Unknown venue",
    startDate: row.start_date,
    endDate: row.end_date,
    title: row.title,
    detail: row.detail,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** All active notes, ordered by start date, hard-capped with a truncation flag. */
export async function listCalendarNotes(
  scope?: { venueId?: string }
): Promise<{ notes: CalendarNote[]; truncated: boolean }> {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("venue_calendar_notes")
    .select("id,venue_id,start_date,end_date,title,detail,created_by,created_at,updated_at,venue:venues(id,name)")
    .is("deleted_at", null);
  if (scope?.venueId) {
    query = query.eq("venue_id", scope.venueId);
  }
  const { data, error } = await query.order("start_date", { ascending: true });
  if (error) {
    throw new Error(`Could not load calendar notes: ${error.message}`);
  }
  const rows = (data ?? []) as NoteRow[];
  const truncated = rows.length >= LIST_CAP;
  if (truncated) {
    console.error(`[calendar-notes] list truncated at ${LIST_CAP} rows`);
  }
  return { notes: rows.slice(0, LIST_CAP).map(mapNote), truncated };
}

type ClashScope = { all: true } | { venueId: string };

/** Event-vs-note clashes over the next 90 days for the dashboard. */
export async function findNoteClashes(scope: ClashScope): Promise<CalendarNoteClash[]> {
  const supabase = createSupabaseAdminClient();
  const now = new Date();
  const ceiling = new Date(now.getTime() + CLASH_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data: eventData, error: eventError } = await supabase
    .from("events")
    .select("id,title,status,start_at,end_at,venue_id,event_venues(venue_id)")
    .is("deleted_at", null)
    .gte("start_at", now.toISOString())
    .lte("start_at", ceiling.toISOString())
    .order("start_at", { ascending: true });
  if (eventError) {
    throw new Error(`Could not load events for note clash check: ${eventError.message}`);
  }

  const events: ClashEventInput[] = (eventData ?? []).map((row: {
    id: string; title: string; status: string; start_at: string; end_at: string | null;
    venue_id: string; event_venues?: Array<{ venue_id: string }> | null;
  }) => {
    const linked = (row.event_venues ?? []).map((v) => v.venue_id).filter(Boolean);
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      startAt: row.start_at,
      endAt: row.end_at,
      venueIds: linked.length > 0 ? linked : [row.venue_id],
    };
  });

  const { notes } = await listCalendarNotes("all" in scope ? undefined : { venueId: scope.venueId });
  const noteInputs: ClashNoteInput[] = notes.map((n) => ({
    id: n.id, venueId: n.venueId, title: n.title, startDate: n.startDate, endDate: n.endDate,
  }));
  const noteById = new Map(notes.map((n) => [n.id, n]));

  return detectNoteClashes(events, noteInputs).map(({ event, note }) => {
    const full = noteById.get(note.id)!;
    return {
      event: { id: event.id, title: event.title },
      note: { id: full.id, title: full.title, venueName: full.venueName, startDate: full.startDate, endDate: full.endDate },
    };
  });
}
