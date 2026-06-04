import "server-only";

import { canViewArtists, canViewBookings, canViewCustomers, canViewDebriefs } from "@/lib/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppUser } from "@/lib/types";
import { canViewVenueLinkedResource } from "@/lib/visibility";

export type GlobalSearchResult = {
  id: string;
  label: string;
  meta: string;
  href: string;
  type: string;
};

type ScoredSearchResult = GlobalSearchResult & {
  score: number;
};

const SOURCE_LIMIT = 8;

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

export function normaliseGlobalSearchTerm(value: string): string {
  return value
    .replace(/[(),]/g, " ")
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function ilikeAny(columns: string[], term: string): string {
  const pattern = `*${term}*`;
  return columns.map((column) => `${column}.ilike.${pattern}`).join(",");
}

function single<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function joinMeta(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim().length > 0)).join(" · ");
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return dateFormatter.format(parsed);
}

function displayName(firstName: string, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}

function score(label: string, meta: string, term: string): number {
  const haystackLabel = label.toLowerCase();
  const haystackMeta = meta.toLowerCase();
  const needle = term.toLowerCase();

  if (haystackLabel === needle) return 100;
  if (haystackLabel.startsWith(needle)) return 90;
  if (haystackLabel.includes(needle)) return 75;
  if (haystackMeta.includes(needle)) return 50;
  return 10;
}

function result(input: GlobalSearchResult, term: string): ScoredSearchResult {
  return {
    ...input,
    score: score(input.label, input.meta, term),
  };
}

function sortAndLimit(results: ScoredSearchResult[], limit: number): GlobalSearchResult[] {
  const seen = new Set<string>();
  return results
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.label.localeCompare(right.label);
    })
    .filter((item) => {
      const key = `${item.type}:${item.href}:${item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ score: _score, ...item }) => item);
}

async function runSource(name: string, loader: () => Promise<ScoredSearchResult[]>): Promise<ScoredSearchResult[]> {
  try {
    return await loader();
  } catch (error) {
    console.error(`Global search source failed: ${name}`, error);
    return [];
  }
}

export async function searchWorkspace(
  user: AppUser,
  rawTerm: string,
  limit = 18,
): Promise<GlobalSearchResult[]> {
  const term = normaliseGlobalSearchTerm(rawTerm);
  if (term.length < 2) return [];

  const db = createSupabaseAdminClient();

  const sources = await Promise.all([
    runSource("events", async () => {
      const { data, error } = await db
        .from("events")
        .select(
          `
          id,
          title,
          public_title,
          public_teaser,
          public_description,
          event_type,
          status,
          start_at,
          venue_id,
          venue_space,
          seo_slug,
          venue:venues!events_venue_id_fkey(id,name),
          event_venues(venue_id)
        `,
        )
        .is("deleted_at", null)
        .or(ilikeAny(["title", "public_title", "public_teaser", "public_description", "event_type", "status", "venue_space", "seo_slug"], term))
        .order("start_at", { ascending: false })
        .limit(SOURCE_LIMIT * 2);

      if (error) throw error;

      type EventRow = {
        id: string;
        title: string;
        public_title: string | null;
        event_type: string | null;
        status: string;
        start_at: string;
        venue_id: string | null;
        venue_space: string | null;
        venue?: { id: string; name: string } | Array<{ id: string; name: string }> | null;
        event_venues?: Array<{ venue_id: string | null }> | null;
      };

      return ((data ?? []) as EventRow[])
        .filter((event) =>
          canViewVenueLinkedResource(user, {
            venue_id: event.venue_id,
            event_venues: event.event_venues ?? [],
          }),
        )
        .slice(0, SOURCE_LIMIT)
        .map((event) => {
          const venue = single(event.venue);
          return result(
            {
              id: `event-${event.id}`,
              label: event.public_title ?? event.title,
              meta: joinMeta([venue?.name, event.event_type, event.status.replace(/_/g, " "), formatDate(event.start_at)]),
              href: `/events/${event.id}`,
              type: "Event",
            },
            term,
          );
        });
    }),

    runSource("planning-items", async () => {
      const { data, error } = await db
        .from("planning_items")
        .select(
          `
          id,
          title,
          description,
          type_label,
          status,
          target_date,
          venue_id,
          venue:venues!planning_items_venue_id_fkey(id,name),
          planning_item_venues(venue_id)
        `,
        )
        .or(ilikeAny(["title", "description", "type_label", "status"], term))
        .order("target_date", { ascending: false })
        .limit(SOURCE_LIMIT * 2);

      if (error) throw error;

      type PlanningItemRow = {
        id: string;
        title: string;
        type_label: string;
        status: string;
        target_date: string;
        venue_id: string | null;
        venue?: { id: string; name: string } | Array<{ id: string; name: string }> | null;
        planning_item_venues?: Array<{ venue_id: string | null }> | null;
      };

      return ((data ?? []) as PlanningItemRow[])
        .filter((item) =>
          canViewVenueLinkedResource(user, {
            venue_id: item.venue_id,
            planning_item_venues: item.planning_item_venues ?? [],
          }),
        )
        .slice(0, SOURCE_LIMIT)
        .map((item) => {
          const venue = single(item.venue);
          return result(
            {
              id: `planning-${item.id}`,
              label: item.title,
              meta: joinMeta([item.type_label, venue?.name ?? "Global", item.status.replace(/_/g, " "), formatDate(item.target_date)]),
              href: `/planning/${item.id}`,
              type: "Planning",
            },
            term,
          );
        });
    }),

    runSource("planning-tasks", async () => {
      const { data, error } = await db
        .from("planning_tasks")
        .select(
          `
          id,
          title,
          notes,
          sop_section,
          status,
          due_date,
          planning_item:planning_items!planning_tasks_planning_item_id_fkey(
            id,
            title,
            venue_id,
            venue:venues!planning_items_venue_id_fkey(id,name),
            planning_item_venues(venue_id)
          )
        `,
        )
        .or(ilikeAny(["title", "notes", "sop_section", "status"], term))
        .order("due_date", { ascending: false })
        .limit(SOURCE_LIMIT * 2);

      if (error) throw error;

      type TaskRow = {
        id: string;
        title: string;
        status: string;
        due_date: string;
        planning_item?: {
          id: string;
          title: string;
          venue_id: string | null;
          venue?: { id: string; name: string } | Array<{ id: string; name: string }> | null;
          planning_item_venues?: Array<{ venue_id: string | null }> | null;
        } | Array<{
          id: string;
          title: string;
          venue_id: string | null;
          venue?: { id: string; name: string } | Array<{ id: string; name: string }> | null;
          planning_item_venues?: Array<{ venue_id: string | null }> | null;
        }> | null;
      };

      return ((data ?? []) as TaskRow[])
        .map((task) => ({ task, item: single(task.planning_item) }))
        .filter(({ item }) =>
          item
            ? canViewVenueLinkedResource(user, {
                venue_id: item.venue_id,
                planning_item_venues: item.planning_item_venues ?? [],
              })
            : false,
        )
        .slice(0, SOURCE_LIMIT)
        .map(({ task, item }) =>
          result(
            {
              id: `planning-task-${task.id}`,
              label: task.title,
              meta: joinMeta([item?.title, single(item?.venue)?.name, task.status.replace(/_/g, " "), formatDate(task.due_date)]),
              href: `/planning/${item?.id}`,
              type: "Task",
            },
            term,
          ),
        );
    }),

    runSource("debriefs", async () => {
      if (!canViewDebriefs(user.role)) return [];

      const { data, error } = await db
        .from("debriefs")
        .select(
          `
          id,
          event_id,
          highlights,
          issues,
          guest_sentiment_notes,
          operational_notes,
          next_time_actions,
          submitted_at,
          event:events!debriefs_event_id_fkey(
            id,
            title,
            start_at,
            venue_id,
            venue:venues!events_venue_id_fkey(id,name),
            event_venues(venue_id)
          )
        `,
        )
        .or(ilikeAny(["highlights", "issues", "guest_sentiment_notes", "operational_notes", "next_time_actions"], term))
        .order("submitted_at", { ascending: false })
        .limit(SOURCE_LIMIT * 2);

      if (error) throw error;

      type DebriefRow = {
        id: string;
        event_id: string;
        submitted_at: string;
        event?: {
          id: string;
          title: string;
          start_at: string;
          venue_id: string | null;
          venue?: { id: string; name: string } | Array<{ id: string; name: string }> | null;
          event_venues?: Array<{ venue_id: string | null }> | null;
        } | Array<{
          id: string;
          title: string;
          start_at: string;
          venue_id: string | null;
          venue?: { id: string; name: string } | Array<{ id: string; name: string }> | null;
          event_venues?: Array<{ venue_id: string | null }> | null;
        }> | null;
      };

      return ((data ?? []) as DebriefRow[])
        .map((debrief) => ({ debrief, event: single(debrief.event) }))
        .filter(({ event }) =>
          event
            ? canViewVenueLinkedResource(user, {
                venue_id: event.venue_id,
                event_venues: event.event_venues ?? [],
              })
            : false,
        )
        .slice(0, SOURCE_LIMIT)
        .map(({ debrief, event }) =>
          result(
            {
              id: `debrief-${debrief.id}`,
              label: event?.title ?? "Event debrief",
              meta: joinMeta([single(event?.venue)?.name, "Debrief", formatDate(debrief.submitted_at)]),
              href: `/debriefs/${debrief.event_id}`,
              type: "Debrief",
            },
            term,
          ),
        );
    }),

    runSource("users", async () => {
      const { data, error } = await db
        .from("users")
        .select("id,full_name,email,role,venue:venues!users_venue_id_fkey(name)")
        .is("deactivated_at", null)
        .or(ilikeAny(["full_name", "email", "role"], term))
        .order("full_name", { ascending: true })
        .limit(SOURCE_LIMIT);

      if (error) throw error;

      type UserRow = {
        id: string;
        full_name: string | null;
        email: string;
        role: string;
        venue?: { name: string | null } | Array<{ name: string | null }> | null;
      };

      return ((data ?? []) as UserRow[]).map((row) =>
        result(
          {
            id: `user-${row.id}`,
            label: row.full_name ?? row.email,
            meta: joinMeta([row.email, row.role.replace(/_/g, " "), single(row.venue)?.name]),
            href: "/users",
            type: "User",
          },
          term,
        ),
      );
    }),

    runSource("venues", async () => {
      const { data, error } = await db
        .from("venues")
        .select("id,name,address,category,is_internal")
        .or(ilikeAny(["name", "address", "category"], term))
        .order("name", { ascending: true })
        .limit(SOURCE_LIMIT);

      if (error) throw error;

      type VenueRow = {
        id: string;
        name: string;
        address: string | null;
        category: string;
        is_internal: boolean;
      };

      return ((data ?? []) as VenueRow[]).map((venue) =>
        result(
          {
            id: `venue-${venue.id}`,
            label: venue.name,
            meta: joinMeta([venue.category, venue.address, venue.is_internal ? "Internal" : null]),
            href: "/venues",
            type: "Venue",
          },
          term,
        ),
      );
    }),

    runSource("artists", async () => {
      if (!canViewArtists(user.role)) return [];

      const { data, error } = await db
        .from("artists")
        .select("id,name,artist_type,email,phone,description,is_archived")
        .eq("is_archived", false)
        .or(ilikeAny(["name", "artist_type", "email", "phone", "description"], term))
        .order("name", { ascending: true })
        .limit(SOURCE_LIMIT);

      if (error) throw error;

      type ArtistRow = {
        id: string;
        name: string;
        artist_type: string;
        email: string | null;
        phone: string | null;
      };

      return ((data ?? []) as ArtistRow[]).map((artist) =>
        result(
          {
            id: `artist-${artist.id}`,
            label: artist.name,
            meta: joinMeta([artist.artist_type, artist.email, artist.phone]),
            href: `/artists/${artist.id}`,
            type: "Artist",
          },
          term,
        ),
      );
    }),

    runSource("customers", async () => {
      if (!canViewCustomers(user.role)) return [];

      const { data, error } = await db
        .from("customers")
        .select("id,first_name,last_name,mobile,email,marketing_opt_in,created_at")
        .or(ilikeAny(["first_name", "last_name", "mobile", "email"], term))
        .order("created_at", { ascending: false })
        .limit(SOURCE_LIMIT);

      if (error) throw error;

      type CustomerRow = {
        id: string;
        first_name: string;
        last_name: string | null;
        mobile: string;
        email: string | null;
        marketing_opt_in: boolean;
      };

      return ((data ?? []) as CustomerRow[]).map((customer) =>
        result(
          {
            id: `customer-${customer.id}`,
            label: displayName(customer.first_name, customer.last_name),
            meta: joinMeta([customer.mobile, customer.email, customer.marketing_opt_in ? "Marketing opt-in" : null]),
            href: `/customers/${customer.id}`,
            type: "Customer",
          },
          term,
        ),
      );
    }),

    runSource("bookings", async () => {
      if (!canViewBookings(user.role)) return [];

      const { data, error } = await db
        .from("event_bookings")
        .select(
          `
          id,
          event_id,
          first_name,
          last_name,
          mobile,
          email,
          status,
          ticket_count,
          created_at,
          event:events!event_bookings_event_id_fkey(
            id,
            title,
            start_at,
            venue:venues!events_venue_id_fkey(name)
          )
        `,
        )
        .or(ilikeAny(["first_name", "last_name", "mobile", "email", "status"], term))
        .order("created_at", { ascending: false })
        .limit(SOURCE_LIMIT);

      if (error) throw error;

      type BookingRow = {
        id: string;
        event_id: string;
        first_name: string;
        last_name: string | null;
        mobile: string;
        email: string | null;
        status: string;
        ticket_count: number;
        event?: {
          title: string;
          start_at: string;
          venue?: { name: string | null } | Array<{ name: string | null }> | null;
        } | Array<{
          title: string;
          start_at: string;
          venue?: { name: string | null } | Array<{ name: string | null }> | null;
        }> | null;
      };

      return ((data ?? []) as BookingRow[]).map((booking) => {
        const event = single(booking.event);
        return result(
          {
            id: `booking-${booking.id}`,
            label: displayName(booking.first_name, booking.last_name),
            meta: joinMeta([
              event?.title,
              single(event?.venue)?.name,
              `${booking.ticket_count} ticket${booking.ticket_count === 1 ? "" : "s"}`,
              booking.status,
            ]),
            href: `/events/${booking.event_id}/bookings`,
            type: "Booking",
          },
          term,
        );
      });
    }),

    runSource("short-links", async () => {
      const { data, error } = await db
        .from("short_links")
        .select("id,name,code,destination,link_type,clicks")
        .or(ilikeAny(["name", "code", "destination", "link_type"], term))
        .order("created_at", { ascending: false })
        .limit(SOURCE_LIMIT);

      if (error) throw error;

      type LinkRow = {
        id: string;
        name: string;
        code: string;
        destination: string;
        link_type: string;
        clicks: number;
      };

      return ((data ?? []) as LinkRow[]).map((link) =>
        result(
          {
            id: `link-${link.id}`,
            label: link.name,
            meta: joinMeta([link.code, link.link_type, `${link.clicks} click${link.clicks === 1 ? "" : "s"}`, nullableText(link.destination)]),
            href: "/links",
            type: "Link",
          },
          term,
        ),
      );
    }),
  ]);

  return sortAndLimit(sources.flat(), limit);
}
