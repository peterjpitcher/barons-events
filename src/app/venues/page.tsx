import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";

type VenueRow = {
  id: string;
  name: string | null;
  region: string | null;
  timezone: string | null;
  updated_at: string | null;
  capacity: number | null;
};

type AuditEntry = {
  id: string;
  action: string;
  entity_id: string | null;
  created_at: string | null;
  details: Record<string, unknown> | null;
  actor: {
    id: string | null;
    email: string | null;
    full_name: string | null;
  } | null;
};

const focusAreas = [
  {
    title: "Venue directory",
    description:
      "List, search, and filter venues with region context for reviewer routing.",
    items: [
      "Table view with region/timezone chips and quick filters.",
      "Role-aware create/edit form gated to HQ planners.",
      "Inline audit trail showing latest updates.",
    ],
  },
  {
    title: "Assignments & roles",
    description:
      "Maintain the mapping between venues, venue managers, and reviewers.",
    items: [
      "Assign primary and backup reviewers per venue.",
      "Surface venue managers with last login metadata.",
      "Flag venues missing reviewer coverage.",
    ],
  },
  {
    title: "Seed data & migrations",
    description:
      "Introduce baseline venues and helper scripts for environment setup.",
    items: [
      "Supabase migration for `venues` table with indexes and triggers.",
      "Seed script for core venues and HQ planners (see Supabase schema doc).",
      "Document local setup workflow in README.",
    ],
  },
];

const fallbackErrorHelper =
  "Run Supabase migrations (`supabase db reset --local` or `npm run supabase:migrate`) to seed the venues table before testing this view.";

async function fetchVenues(): Promise<{
  data: VenueRow[];
  error: string | null;
}> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("venues")
    .select("id,name,region,timezone,updated_at,capacity")
    .order("name", { ascending: true });

  if (error) {
    const message =
      error.code === "42P01"
        ? "The venues table is missing."
        : error.message ?? "Unable to load venues.";

    return {
      data: [],
      error: `${message} ${fallbackErrorHelper}`,
    };
  }

  return {
    data: data ?? [],
    error: null,
  };
}

const formatDate = (input: string | null) => {
  if (!input) return "—";
  try {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
};

const formatDateTime = (input: string | null) => {
  if (!input) return "Unknown";
  try {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }

    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Unknown";
  }
};

async function fetchVenueAuditLog(): Promise<{
  data: AuditEntry[];
  error: string | null;
}> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select(
      "id, action, entity_id, details, created_at, actor:users!audit_log_actor_id_fkey(id,email,full_name)"
    )
    .eq("entity_type", "venue")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    const message =
      error.code === "42P01"
        ? "The audit_log table is missing."
        : error.message ?? "Unable to load audit log.";

    return {
      data: [],
      error: `${message} Run the latest migrations to enable audit history.`,
    };
  }

  const normalized = (data ?? []).map((entry) => {
    const actorValue = Array.isArray(entry.actor)
      ? entry.actor[0] ?? null
      : entry.actor ?? null;

    return {
      id: entry.id,
      action: entry.action,
      entity_id: entry.entity_id ?? null,
      created_at: entry.created_at ?? null,
      details: entry.details ?? null,
      actor: actorValue
        ? {
            id: actorValue.id ?? null,
            email: actorValue.email ?? null,
            full_name: actorValue.full_name ?? null,
          }
        : null,
    } satisfies AuditEntry;
  });

  return {
    data: normalized,
    error: null,
  };
}

const actionLabels: Record<string, string> = {
  "venue.created": "Venue created",
  "venue.updated": "Venue updated",
};

const successMessages: Record<string, string> = {
  created: "Venue created successfully.",
  updated: "Venue updated successfully.",
};

type VenuesPageProps = {
  searchParams?: Promise<Record<string, string>>;
};

export default async function VenuesPage({ searchParams }: VenuesPageProps) {
  const resolvedSearchParams =
    (searchParams ? await searchParams : undefined) ?? {};
  const statusParam = resolvedSearchParams.status;

  const profile = await getCurrentUserProfile();
  const isHQPlanner = profile?.role === "hq_planner";

  const { data: venues, error } = isHQPlanner
    ? await fetchVenues()
    : { data: [], error: null };
  const { data: auditEntries, error: auditError } = isHQPlanner
    ? await fetchVenueAuditLog()
    : { data: [], error: null };
  const toastMessage =
    typeof statusParam === "string"
    ? successMessages[statusParam]
    : null;

  return (
    <section className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Venue hub</h1>
        <p className="max-w-2xl text-base text-black/70">
          Foundations for venue management land in Sprint 1. HQ planners get the
          first CRUD flows; venue managers inherit read access via Supabase RLS.
        </p>
        <div className="inline-flex flex-wrap items-center gap-3 text-sm text-black/70">
          <span className="rounded-full bg-black px-3 py-1 font-medium text-white">
            Milestone: EP-105 / EP-106
          </span>
          <span>
            Docs: <code>docs/Sprint1Plan.md</code>
          </span>
          <span>
            Schema: <code>docs/SupabaseSchema.md</code>
          </span>
        </div>
      </header>

      {isHQPlanner ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-black">
                  Venue directory snapshot
                </h2>
                <p className="text-sm text-black/70">
                  Live Supabase data scoped to HQ planners. Migrations seed
                  example venues; add CRUD forms next.
                </p>
              </div>
              <Link
                href="/venues/new"
                className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
              >
                New venue
              </Link>
            </div>

            {toastMessage ? (
              <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {toastMessage}
              </div>
            ) : null}

            {error ? (
              <div className="mt-6 rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : venues.length === 0 ? (
              <div className="mt-6 rounded-lg border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-black/70">
                No venues found yet. Once migrations run, seed data will appear
                here for CRUD testing.
              </div>
            ) : (
              <div className="mt-6 overflow-hidden rounded-lg border border-black/[0.08]">
                <table className="min-w-full divide-y divide-black/[0.08]">
                  <thead className="bg-black/[0.02]">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                        Venue
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                        Region
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                        Timezone
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                        Updated
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                        Capacity
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06] bg-white">
                    {venues.map((venue) => (
                      <tr key={venue.id} className="text-sm text-black/80">
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-black">
                          {venue.name ?? "Untitled venue"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {venue.region ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {venue.timezone ?? "Europe/London"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-black/60">
                          {formatDate(venue.updated_at)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {typeof venue.capacity === "number"
                            ? venue.capacity
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Link
                            href={`/venues/${venue.id}/edit`}
                            className="text-sm font-medium text-black underline underline-offset-4 hover:text-black/70"
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-black">
                  Recent venue activity
                </h2>
                <p className="text-sm text-black/70">
                  Latest changes captured via audit logging. Migrations must be up
                  to date to populate this feed.
                </p>
              </div>
            </div>

            {auditError ? (
              <div className="mt-6 rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {auditError}
              </div>
            ) : auditEntries.length === 0 ? (
              <div className="mt-6 rounded-lg border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-black/70">
                No audit entries yet. Create or update a venue to see history.
              </div>
            ) : (
              <ul className="mt-6 space-y-4">
                {auditEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-lg border border-black/[0.08] bg-white px-4 py-3 text-sm text-black/80 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-black">
                        {actionLabels[entry.action] ?? entry.action}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-black/50">
                        {formatDateTime(entry.created_at)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-black/60">
                      {entry.actor?.full_name ?? entry.actor?.email ?? "System"}
                    </div>
                    {entry.details ? (
                      <pre className="mt-3 rounded bg-black/[0.04] px-3 py-2 text-xs text-black/70">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-black/20 bg-white/40 p-6 text-sm text-black/70">
          Venue CRUD is restricted to HQ planners. Ask an administrator to grant
          the appropriate role or continue building the reviewer/venue manager
          views.
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {focusAreas.map((area) => (
          <div
            key={area.title}
            className="flex h-full flex-col rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm"
          >
            <div className="space-y-3">
              <h2 className="text-lg font-medium text-black">{area.title}</h2>
              <p className="text-sm text-black/70">{area.description}</p>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-black/80">
              {area.items.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span aria-hidden className="mt-1 h-1.5 w-1.5 rounded-full bg-black/40" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
