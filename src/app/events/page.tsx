import Link from "next/link";
import { Fragment } from "react";
import { submitEventDraftAction } from "@/actions/events";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { EventForm } from "@/components/events/event-form";
import {
  buildPlanningFeed,
  detectVenueConflicts,
  summariseStatusCounts,
  type EventSummary,
} from "@/lib/events/analytics";
import { diffSnapshot } from "@/lib/events/diff";

const workstreams = [
  {
    title: "Draft creation",
    description:
      "Multi-step form capturing event basics, promotions, talent, and financial expectations.",
    items: [
      "Server actions with Zod validation for create/update drafts.",
      "Autosave on step transition with optimistic UI feedback.",
      "Goal selector pulling from Supabase `goals` table.",
    ],
  },
  {
    title: "Submission workflow",
    description:
      "Transition drafts to `submitted` state, lock key fields, and queue for reviewer assignment.",
    items: [
      "State machine enforcing allowed status transitions.",
      "Timeline component surfacing submission and feedback events.",
      "Audit logging helper invoked on all status changes.",
    ],
  },
  {
    title: "Version history",
    description:
      "Persist each submission revision for traceability and AI enrichment context.",
    items: [
      "Supabase `event_versions` table populated via server action.",
      "Expose read-only history within event detail view.",
      "Flag diffs to highlight what changed between revisions.",
    ],
  },
];

type EventVersion = {
  version: number;
  created_at: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  payload: Record<string, unknown> | null;
  submitter?: {
    full_name: string | null;
    email: string | null;
  } | null;
};

type AuditEntry = {
  id: string;
  action: string;
  entity_id: string;
  details: Record<string, unknown> | null;
  created_at: string | null;
  actor?: {
    full_name: string | null;
    email: string | null;
  } | null;
};

type EventRow = {
  id: string;
  title: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  created_by: string;
  venue_id: string | null;
  venue_space: string | null;
  venue?: {
    name: string | null;
  } | null;
  versions?: EventVersion[];
};

type VenueOption = {
  id: string;
  name: string;
};

const fallbackErrorHelper =
  "Run Supabase migrations (`npm run supabase:migrate`) to ensure the events/versions tables exist.";

async function fetchEvents(): Promise<{
  data: EventRow[];
  error: string | null;
}> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      `
        id,
        title,
        status,
        start_at,
        end_at,
        created_by,
        venue_id,
        venue_space,
        venue:venues!events_venue_id_fkey(name),
        versions:event_versions(
          version,
          created_at,
          submitted_at,
          submitted_by,
          payload,
          submitter:users!event_versions_submitted_by_fkey(full_name,email)
        )
      `
    )
    .order("start_at", { ascending: true })
    .order("version", { foreignTable: "event_versions", ascending: false });

  if (error) {
    const message =
      error.code === "42P01"
        ? "The events table is missing."
        : error.message ?? "Unable to load events.";

    return {
      data: [],
      error: `${message} ${fallbackErrorHelper}`,
    };
  }

  type RawEvent = {
    venue?: { name: string | null } | { name: string | null }[] | null;
    versions?: RawVersion[] | RawVersion | null;
    [key: string]: unknown;
  };

  type RawVersion = {
    version: number;
    created_at: string | null;
    submitted_at: string | null;
    submitted_by: string | null;
    payload: Record<string, unknown> | null;
    submitter?:
      | { full_name: string | null; email: string | null }
      | Array<{ full_name: string | null; email: string | null }>
      | null;
  };

  const normalized = (data ?? []).map((event) => {
    const raw = event as unknown as RawEvent;
    const venueValue = Array.isArray(raw.venue)
      ? raw.venue[0] ?? null
      : raw.venue ?? null;
    const versionsRaw = Array.isArray(raw.versions)
      ? raw.versions
      : raw.versions
        ? [raw.versions]
        : [];

    const versionsValue = versionsRaw.map((version) => {
      const submitterValue = Array.isArray(version.submitter)
        ? version.submitter[0] ?? null
        : version.submitter ?? null;

      return {
        ...version,
        submitter: submitterValue,
      } satisfies EventVersion;
    });

    return {
      ...(raw as Record<string, unknown>),
      venue: venueValue,
      versions: versionsValue,
    } as EventRow;
  });

  return {
    data: normalized as EventRow[],
    error: null,
  };
}

async function fetchVenuesForProfile(
  profileRole: string | null,
  venueId: string | null
): Promise<{ data: VenueOption[]; error: string | null }> {
  const supabase = createSupabaseServerClient();

  if (profileRole === "hq_planner") {
    const { data, error } = await supabase
      .from("venues")
      .select("id,name")
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
      data:
        data?.map((venue) => ({
          id: venue.id,
          name: venue.name ?? "Untitled venue",
        })) ?? [],
      error: null,
    };
  }

  if (profileRole === "venue_manager" && venueId) {
    const { data, error } = await supabase
      .from("venues")
      .select("id,name")
      .eq("id", venueId)
      .limit(1);

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
      data:
        data?.map((venue) => ({
          id: venue.id,
          name: venue.name ?? "Untitled venue",
        })) ?? [],
      error: null,
    };
  }

  return {
    data: [],
    error: null,
  };
}

const formatDateTime = (input: string | null) => {
  if (!input) return "—";
  try {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const formatDiffValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return value ?? "—";
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  needs_revisions: "Needs revisions",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  completed: "Completed",
};

const successMessages: Record<string, string> = {
  created: "Event draft created successfully.",
  submitted: "Event submitted for review.",
};

const versionActor = (version: EventVersion) =>
  version.submitter?.full_name ??
  version.submitter?.email ??
  (version.submitted_by ?? "Unknown");

const describeVersion = (
  version: EventVersion,
  previousPayload: Record<string, unknown> | null
) => {
  const base = version.submitted_at
    ? `Submitted for review on ${formatDateTime(version.submitted_at)}`
    : `Draft saved on ${formatDateTime(version.created_at)}`;

  if (!previousPayload || !version.payload) {
    return base;
  }

  const diff = diffSnapshot(previousPayload, version.payload, {
    sourceTag: "manual",
  });

  if (diff.length === 0) {
    return base;
  }

  const summary = diff
    .map(({ field, before, after }) => {
      const label = field.replace(/_/g, " ");
      return `${label}: ${formatDiffValue(before)} → ${formatDiffValue(after)}`;
    })
    .join("; ");

  return `${base} · ${summary}`;
};

const auditActionLabels: Record<string, string> = {
  "event.draft_created": "Draft created",
  "event.submitted": "Submitted for review",
  "event.reviewer_assigned": "Reviewer assigned",
  "event.approved": "Approved",
  "event.needs_revisions": "Needs revisions",
  "event.rejected": "Rejected",
};

const formatAuditAction = (action: string) =>
  auditActionLabels[action] ??
  action
    .split(".")
    .map((part) =>
      part
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    )
    .join(" · ");

const auditActor = (entry: AuditEntry) =>
  entry.actor?.full_name ??
  entry.actor?.email ??
  "System";

const summariseAuditDetails = (details: Record<string, unknown> | null) => {
  if (!details) return null;

  const entries = Object.entries(details);
  if (entries.length === 0) return null;

  return entries
    .map(([key, value]) => {
      const label = key.replace(/_/g, " ");
      if (typeof value === "object" && value !== null) {
        return `${label}: ${JSON.stringify(value)}`;
      }
      return `${label}: ${value ?? "—"}`;
    })
    .join("; ");
};

type EventsPageProps = {
  searchParams?: Promise<Record<string, string | string[]>>;
};

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const resolvedSearchParams =
    (searchParams ? await searchParams : undefined) ?? {};

  const searchParamsRecord =
    resolvedSearchParams as Record<string, string | string[]>;

  const profile = await getCurrentUserProfile();
  const canCreateDraft = profile
    ? ["venue_manager", "hq_planner"].includes(profile.role ?? "")
    : false;
  const isHQPlanner = profile?.role === "hq_planner";
  const isVenueManager = profile?.role === "venue_manager";

  const [{ data: events, error: eventError }, venuesResult] = await Promise.all([
    fetchEvents(),
    fetchVenuesForProfile(profile?.role ?? null, profile?.venue_id ?? null),
  ]);

  const venues = venuesResult.data;
  const venueFetchError = venuesResult.error;

  const auditByEvent = new Map<string, AuditEntry[]>();
  let auditError: string | null = null;

  if (events && events.length > 0) {
    const supabase = createSupabaseServerClient();
    const { data: auditData, error: auditFetchError } = await supabase
      .from("audit_log")
      .select(
        `
          id,
          action,
          entity_id,
          details,
          created_at,
          actor:users(full_name,email)
        `
      )
      .eq("entity_type", "event")
      .in(
        "entity_id",
        events.map((event) => event.id)
      )
      .order("created_at", { ascending: false });

    if (auditFetchError) {
      auditError = auditFetchError.message;
    } else if (auditData) {
      type RawAudit = {
        id: string;
        action: string;
        entity_id: string;
        details: Record<string, unknown> | null;
        created_at: string | null;
        actor?:
          | { full_name: string | null; email: string | null }
          | Array<{ full_name: string | null; email: string | null }>
          | null;
      };

      const normalizedAudit = (auditData as RawAudit[]).map((entry) => {
        const actorValue = Array.isArray(entry.actor)
          ? entry.actor[0] ?? null
          : entry.actor ?? null;

        return {
          ...entry,
          actor: actorValue,
        } as AuditEntry;
      });

      for (const entry of normalizedAudit) {
        const list = auditByEvent.get(entry.entity_id) ?? [];
        list.push(entry);
        auditByEvent.set(entry.entity_id, list);
      }
    }
  }

  const eventSummaries: EventSummary[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    status: event.status,
    startAt: event.start_at,
    endAt: event.end_at,
    venueId: event.venue_id,
    venueName: event.venue?.name ?? null,
    venueSpace: event.venue_space ?? null,
  }));

  const statusCounts = summariseStatusCounts(eventSummaries);

  const statusSummaryCards = [
    {
      label: "Total events",
      value: eventSummaries.length,
      tone: "text-black",
      detail: "All records in Supabase",
    },
    {
      label: "Drafts",
      value: statusCounts.draft ?? 0,
      tone: "text-black/70",
      detail: "Editable by venue managers",
    },
    {
      label: "Submitted",
      value: statusCounts.submitted ?? 0,
      tone: "text-amber-700",
      detail: "Awaiting reviewer assignment",
    },
    {
      label: "Needs revisions",
      value: statusCounts.needs_revisions ?? 0,
      tone: "text-rose-700",
      detail: "Returned for updates",
    },
    {
      label: "Approved",
      value: statusCounts.approved ?? 0,
      tone: "text-emerald-700",
      detail: "Cleared for publishing",
    },
  ];

  const conflictPairs = detectVenueConflicts(eventSummaries);
  const conflictDisplay = conflictPairs.slice(0, 5);

  const planningFeed = buildPlanningFeed(eventSummaries, 5);

  const toastMessage = searchParamsRecord?.status && typeof searchParamsRecord.status === "string"
    ? successMessages[searchParamsRecord.status]
    : null;

  return (
    <section className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Event pipeline</h1>
        <p className="max-w-2xl text-base text-black/70">
          This track implements the event draft schema, submission workflow, and
          reviewer hand-off mechanics that anchor the platform.
        </p>
        <div className="inline-flex flex-wrap items-center gap-3 text-sm text-black/70">
          <span className="rounded-full bg-black px-3 py-1 font-medium text-white">
            Milestone: EP-103 / EP-107
          </span>
          <span>
            Supabase models: <code>events</code>, <code>event_versions</code>
          </span>
          <span>
            Docs: <code>docs/PRD.md</code>
          </span>
        </div>
      </header>

      {toastMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {toastMessage}
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="grid gap-3 rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm sm:grid-cols-5">
          {statusSummaryCards.map((card) => (
            <div key={card.label} className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-black/50">
                {card.label}
              </span>
              <span className={`text-2xl font-semibold ${card.tone}`}>
                {card.value}
              </span>
              <span className="text-xs text-black/50">{card.detail}</span>
            </div>
          ))}
        </div>
      ) : null}

      {conflictDisplay.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold">Schedule conflicts detected</span>
            <span className="text-xs uppercase tracking-wide text-amber-700">
              {conflictPairs.length} overlap{conflictPairs.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {conflictDisplay.map((pair) => (
              <div key={pair.key} className="rounded-lg border border-amber-200 bg-white/70 px-3 py-2 text-sm text-amber-900">
                <div className="flex flex-col">
                  <span className="font-medium">{pair.venueName}</span>
                  <span className="text-xs text-amber-700">{pair.venueSpace}</span>
                </div>
                <span className="block text-xs text-amber-800">
                  {pair.first.title} ({formatDateTime(pair.first.startAt)}) overlaps with{" "}
                  {pair.second.title} ({formatDateTime(pair.second.startAt)})
                </span>
              </div>
            ))}
            {conflictPairs.length > conflictDisplay.length ? (
              <div className="text-xs text-amber-700">
                {conflictPairs.length - conflictDisplay.length} more potential conflict
                {conflictPairs.length - conflictDisplay.length === 1 ? "" : "s"} not shown.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {planningFeed.length > 0 ? (
        <div className="rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-black">Planning feed</h2>
              <p className="text-sm text-black/70">
                Next up events by start date with venue space context for conflict checks.
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide text-black/50">
              {planningFeed.length} upcoming
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {planningFeed.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/[0.06] bg-black/[0.015] px-3 py-2 text-sm text-black/80"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-black">{event.title}</span>
                  <span className="text-xs text-black/60">
                    {event.venueName ?? "Unknown venue"} · {event.venueSpace ?? "General space"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-black/60">
                    {formatDateTime(event.startAt)}
                  </span>
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-black/60">
                    {statusLabels[event.status] ?? event.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canCreateDraft ? (
        <>
          {venueFetchError ? (
            <div className="rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              {venueFetchError}
            </div>
          ) : venues.length === 0 ? (
            <div className="rounded-lg border border-dashed border-black/20 bg-white px-4 py-6 text-sm text-black/70">
              No venues available yet. HQ planners should add venues before
              creating event drafts.
            </div>
          ) : (
            <EventForm venues={venues as VenueOption[]} />
          )}
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-black/20 bg-white px-4 py-6 text-sm text-black/70">
          Event draft creation is limited to venue managers and HQ planners.
        </div>
      )}

      <div className="rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-black">
              Drafts &amp; upcoming events
            </h2>
            <p className="text-sm text-black/70">
              Live Supabase data sorted by start date. Use this list to monitor
              drafts before the full reviewer queue ships.
            </p>
          </div>
        </div>

        {eventError ? (
          <div className="mt-6 rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {eventError}
          </div>
        ) : events.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-black/70">
            No event drafts yet. Create your first draft above to see it listed
            here.
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-black/[0.08]">
          {auditError ? (
            <div className="mt-6 rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              {auditError}
            </div>
          ) : null}
            <table className="mt-6 min-w-full divide-y divide-black/[0.08]">
              <thead className="bg-black/[0.02]">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Title
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Venue
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Start
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    End
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Status
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Versions
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] bg-white">
                {events.map((event) => {
                  const versions = event.versions ?? [];
                  const auditsForEvent = auditByEvent.get(event.id) ?? [];

                  return (
                    <Fragment key={event.id}>
                  <tr id={`event-${event.id}`} className="text-sm text-black/80">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-black">
                      <Link
                        href={`/events/${event.id}`}
                        className="text-black hover:underline"
                      >
                        {event.title}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {event.venue?.name ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateTime(event.start_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateTime(event.end_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-black/60">
                      {statusLabels[event.status] ?? event.status}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-black/60">
                      {event.versions?.length ?? 0}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {["draft", "needs_revisions"].includes(event.status) &&
                      (isHQPlanner ||
                        (isVenueManager && event.created_by === profile?.id)) ? (
                        <form action={submitEventDraftAction} className="inline-flex">
                          <input type="hidden" name="eventId" value={event.id} />
                          <button
                            type="submit"
                            className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
                          >
                            Submit for review
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-black/40">—</span>
                      )}
                    </td>
                  </tr>
                  {(versions.length > 0 || auditsForEvent.length > 0) && (
                  <tr
                    className="bg-black/[0.02] text-xs text-black/70"
                  >
                    <td colSpan={7} className="px-4 py-3">
                      <div className="flex flex-col gap-4">
                        {versions.length > 0 ? (
                          <div className="flex flex-col gap-2">
                            <span className="font-semibold text-black">
                              Version history
                            </span>
                            <ul className="space-y-2">
                              {versions.map((version, index) => {
                                const payloadStatus =
                                  version.payload &&
                                  typeof (version.payload as { status?: unknown })
                                    .status === "string"
                                    ? (
                                        version.payload as { status?: string }
                                      ).status ?? undefined
                                    : undefined;
                                const statusLabel = payloadStatus
                                  ? statusLabels[payloadStatus] ?? payloadStatus
                                  : null;
                                const previousPayload =
                                  versions[index + 1]?.payload ?? null;

                                return (
                                  <li
                                    key={`${event.id}-version-${version.version}-${version.created_at}`}
                                    className="rounded-lg border border-black/[0.08] bg-white px-3 py-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-medium text-black">
                                        Version {version.version}
                                      </span>
                                      <span className="text-black/60">
                                        {describeVersion(
                                          version,
                                          previousPayload
                                        )}
                                      </span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-3 text-black/60">
                                      <span>By {versionActor(version)}</span>
                                      {statusLabel ? (
                                        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-black/60">
                                          {statusLabel}
                                        </span>
                                      ) : null}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}
                        {auditsForEvent.length > 0 ? (
                          <div className="flex flex-col gap-2">
                            <span className="font-semibold text-black">
                              Audit history
                            </span>
                            <ul className="space-y-2">
                              {auditsForEvent.map((entry) => {
                                const summary = summariseAuditDetails(entry.details);

                                return (
                                  <li
                                    key={entry.id}
                                    className="rounded-lg border border-black/[0.08] bg-white px-3 py-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-medium text-black">
                                        {formatAuditAction(entry.action)}
                                      </span>
                                      <span className="text-black/60">
                                        {formatDateTime(entry.created_at)}
                                      </span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-3 text-black/60">
                                      <span>By {auditActor(entry)}</span>
                                    </div>
                                    {summary ? (
                                      <p className="mt-2 text-black/70">{summary}</p>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-black/[0.08] bg-black/[0.02] px-4 py-3 text-xs text-black/60">
              Version history now tracks every draft submission and highlights
              field changes. Upcoming work adds reviewer timeline entries and SLA
              visuals.
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {workstreams.map((area) => (
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

      <footer className="rounded-xl border border-dashed border-black/20 bg-white/60 p-6 text-sm text-black/70">
        <p>
          Dependencies: authentication guardrails, venue assignments, and audit
          logging utilities must land first to keep submissions consistent with
          RLS policies.
        </p>
      </footer>
    </section>
  );
}
