import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { AssignReviewerForm } from "@/components/reviews/assign-reviewer-form";
import { DecisionForm } from "@/components/reviews/decision-form";
import { ReviewFilterPersistence } from "@/components/reviews/review-filter-persistence";

const reviewFocus = [
  {
    title: "Reviewer queue",
    description:
      "Role-specific list of submissions awaiting a decision with SLA countdowns.",
    items: [
      "Server component fetching events filtered by reviewer assignment.",
      "Visual SLA indicators (on track, warning, breach).",
      "Bulk actions deferred; single-review flow targeted for Sprint 1.",
    ],
  },
  {
    title: "Decision workspace",
    description:
      "Detail view combining event summary, timeline, and decision controls.",
    items: [
      "Approve / Request changes / Reject actions hitting RPC (`set_event_status`).",
      "Feedback template picker plus rich-text notes.",
      "Attachment preview and version history sidebar.",
    ],
  },
  {
    title: "Notifications & audit",
    description:
      "Ensure reviewers trigger the right notifications and audit records.",
    items: [
      "Resend email template for feedback notifications.",
      "Audit log entry capturing decision, payload, and actor.",
      "Follow-up tasks for SLA escalations (future cron hook).",
    ],
  },
];

type ReviewsPageProps = {
  searchParams?: Promise<Record<string, string>>;
};

type ReviewEvent = {
  id: string;
  title: string;
  status: string;
  start_at: string | null;
  assigned_reviewer_id: string | null;
  venue?: {
    name: string | null;
  } | null;
  assigned_reviewer?: {
    full_name: string | null;
    email: string | null;
  } | null;
};

type ReviewerOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type ApprovalRecord = {
  id: string;
  event_id: string;
  decision: string;
  feedback_text: string | null;
  decided_at: string | null;
  event?: {
    title: string | null;
    venue?: { name: string | null } | null;
  } | null;
  reviewer?: {
    full_name: string | null;
    email: string | null;
  } | null;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  try {
    const date = new Date(value);
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

const slaToneStyles: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
  muted: "bg-black/5 text-black/50 border-black/10",
};

const slaRowToneStyles: Record<string, string> = {
  ok: "",
  warn: "bg-amber-50/[0.12]",
  overdue: "bg-red-50/[0.18]",
  muted: "",
};

const uuidRegex =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const getSlaStatus = (value: string | null) => {
  if (!value) {
    return {
      label: "No date",
      tone: "muted" as const,
      rowTone: slaRowToneStyles.muted,
      action: null,
    };
  }

  const start = new Date(value);
  if (Number.isNaN(start.getTime())) {
    return {
      label: "Invalid date",
      tone: "muted" as const,
      rowTone: slaRowToneStyles.muted,
      action: null,
    };
  }

  const diffMs = start.getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays >= 3) {
    return {
      label: `Due in ${diffDays} days`,
      tone: "ok" as const,
      rowTone: slaRowToneStyles.ok,
      action: null,
    };
  }

  if (diffDays >= 0) {
    const imminenceLabel =
      diffDays === 0 ? "Decision due today" : "Follow up within 24h";

    return {
      label: `Due in ${diffDays} day${diffDays === 1 ? "" : "s"}`,
      tone: "warn" as const,
      rowTone: slaRowToneStyles.warn,
      action: imminenceLabel,
    };
  }

  return {
    label: `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"}`,
    tone: "overdue" as const,
    rowTone: slaRowToneStyles.overdue,
    action: "Escalate to HQ planner",
  };
};

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const resolvedSearchParams =
    (searchParams ? await searchParams : undefined) ?? {};
  const flashParam = resolvedSearchParams.flash;
  const filterParamInput = resolvedSearchParams.filter;
  const reviewerParamInput = resolvedSearchParams.reviewer;

  const profile = await getCurrentUserProfile();
  const supabase = createSupabaseServerClient();

  if (!profile) {
    return (
      <section className="space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">
            Reviewer flow
          </h1>
        </header>
        <div className="rounded-lg border border-dashed border-black/20 bg-white px-4 py-6 text-sm text-black/70">
          Please sign in to manage reviewer queues.
        </div>
      </section>
    );
  }

  const isReviewer = profile.role === "reviewer";
  const isHQPlanner = profile.role === "hq_planner";

  const rawFilter = filterParamInput ?? "active";
  const allowedFilters = new Set([
    "active",
    "submitted",
    "needs_revisions",
    "approved",
    "all",
  ]);
  const filterParam = allowedFilters.has(rawFilter) ? rawFilter : "active";

  const statusFilter =
    filterParam === "active"
      ? ["submitted", "needs_revisions"]
      : filterParam === "all"
        ? [
            "draft",
            "submitted",
            "needs_revisions",
            "approved",
            "rejected",
            "published",
            "completed",
          ]
        : [filterParam];

  const reviewerFilterRaw =
    typeof reviewerParamInput === "string" ? reviewerParamInput : "all";
  const reviewerFilter =
    isHQPlanner && reviewerFilterRaw === "unassigned"
      ? "unassigned"
      : isHQPlanner && reviewerFilterRaw && uuidRegex.test(reviewerFilterRaw)
        ? reviewerFilterRaw
        : "all";
  const hasFilterParam = typeof filterParamInput === "string";
  const hasReviewerParam = typeof reviewerParamInput === "string";
  const shouldRestoreFilters =
    profile &&
    !hasFilterParam &&
    (!isHQPlanner || !hasReviewerParam);

  const eventsQuery = supabase
    .from("events")
    .select(
      "id,title,status,start_at,assigned_reviewer_id,venue:venues(name),assigned_reviewer:users!events_assigned_reviewer_id_fkey(full_name,email)"
    )
    .in("status", statusFilter)
    .order("start_at", { ascending: true });

  if (isReviewer) {
    eventsQuery.eq("assigned_reviewer_id", profile.id);
  } else if (isHQPlanner) {
    if (reviewerFilter === "unassigned") {
      eventsQuery.is("assigned_reviewer_id", null);
    } else if (reviewerFilter !== "all") {
      eventsQuery.eq("assigned_reviewer_id", reviewerFilter);
    }
  }

  const [
    { data: eventsData, error: eventsError },
    reviewersResult,
    decisionsResult,
  ] = await Promise.all([
    eventsQuery,
    isHQPlanner
      ? supabase
          .from("users")
          .select("id,full_name,email")
          .in("role", ["reviewer", "hq_planner"])
          .order("full_name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    isReviewer || isHQPlanner
      ? supabase
          .from("approvals")
          .select(
            `
              id,
              event_id,
              decision,
              feedback_text,
              decided_at,
              event:events(
                title,
                venue:venues(name)
              ),
              reviewer:users(full_name,email)
            `
          )
          .order("decided_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);

  type RawReviewEvent = {
    id: string;
    title: string;
    status: string;
    start_at: string | null;
    assigned_reviewer_id: string | null;
    venue?: { name: string | null } | { name: string | null }[] | null;
    assigned_reviewer?:
      | { full_name: string | null; email: string | null }
      | Array<{ full_name: string | null; email: string | null }>
      | null;
  };

  const events = (eventsData ?? []).map((event) => {
    const raw = event as unknown as RawReviewEvent;
    const venueValue = Array.isArray(raw.venue)
      ? raw.venue[0] ?? null
      : raw.venue ?? null;
    const reviewerValue = Array.isArray(raw.assigned_reviewer)
      ? raw.assigned_reviewer[0] ?? null
      : raw.assigned_reviewer ?? null;

    return {
      id: raw.id,
      title: raw.title,
      status: raw.status,
      start_at: raw.start_at,
      assigned_reviewer_id: raw.assigned_reviewer_id,
      venue: venueValue,
      assigned_reviewer: reviewerValue,
    } as ReviewEvent;
  });
  const reviewers = (reviewersResult?.data ?? []) as ReviewerOption[];
  const reviewerFetchError = reviewersResult?.error?.message ?? null;
  const assignableEvents = events.map((event) => ({
    id: event.id,
    label: event.title,
  }));
  const assignableReviewers = reviewers.map((reviewer) => ({
    id: reviewer.id,
    label:
      reviewer.full_name ??
      reviewer.email ??
      "Unnamed reviewer",
  }));
  type RawApproval = {
    id: string;
    event_id: string;
    decision: string;
    feedback_text: string | null;
    decided_at: string | null;
    event?:
      | {
          title: string | null;
          venue?: { name: string | null } | { name: string | null }[] | null;
        }
      | Array<{
          title: string | null;
          venue?: { name: string | null } | { name: string | null }[] | null;
        }>
      | null;
    reviewer?:
      | { full_name: string | null; email: string | null }
      | Array<{ full_name: string | null; email: string | null }>
      | null;
  };

  const approvals = (decisionsResult?.data ?? []).map((record) => {
    const raw = record as unknown as RawApproval;
    const eventValue = Array.isArray(raw.event)
      ? raw.event[0] ?? null
      : raw.event ?? null;
    const venueValue = eventValue
      ? Array.isArray(eventValue.venue)
        ? eventValue.venue[0] ?? null
        : eventValue.venue ?? null
      : null;
    const reviewerValue = Array.isArray(raw.reviewer)
      ? raw.reviewer[0] ?? null
      : raw.reviewer ?? null;

    return {
      id: raw.id,
      event_id: raw.event_id,
      decision: raw.decision,
      feedback_text: raw.feedback_text ?? null,
      decided_at: raw.decided_at ?? null,
      event: eventValue
        ? {
            title: eventValue.title ?? null,
            venue: venueValue,
          }
        : null,
      reviewer: reviewerValue,
    } as ApprovalRecord;
  });
  const approvalsError = decisionsResult?.error?.message ?? null;

  const activeForSummary = events.filter((event) =>
    ["submitted", "needs_revisions"].includes(event.status)
  );

  const queueSummary = activeForSummary.reduce(
    (acc, event) => {
      const sla = getSlaStatus(event.start_at);
      acc.total += 1;

      switch (sla.tone) {
        case "ok":
          acc.onTrack += 1;
          break;
        case "warn":
          acc.dueSoon += 1;
          break;
        case "overdue":
          acc.overdue += 1;
          break;
        default:
          acc.undated += 1;
          break;
      }

      return acc;
    },
    { total: 0, onTrack: 0, dueSoon: 0, overdue: 0, undated: 0 }
  );

  const summaryCards = [
    {
      label: "Total active",
      value: queueSummary.total,
      tone: "text-black",
      detail: "Submitted & needs revisions",
    },
    {
      label: "On track",
      value: queueSummary.onTrack,
      tone: "text-emerald-700",
      detail: "≥3 days until start",
    },
    {
      label: "Due soon",
      value: queueSummary.dueSoon,
      tone: "text-amber-700",
      detail: "Decision due in ≤2 days",
    },
    {
      label: "Overdue",
      value: queueSummary.overdue,
      tone: "text-red-700",
      detail: "Start date in the past",
    },
    {
      label: "Missing date",
      value: queueSummary.undated,
      tone: "text-black/60",
      detail: "No start time recorded",
    },
  ];

  const successMessage =
    flashParam === "assigned"
      ? "Reviewer assigned successfully."
      : flashParam === "decided"
        ? "Decision recorded."
        : null;

  return (
    <section className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Reviewer flow</h1>
        <p className="max-w-2xl text-base text-black/70">
          Reviewer functionality is scoped for Sprint 2 but we are designing the
          interfaces now to keep schema and audit needs aligned.
        </p>
        <div className="inline-flex flex-wrap items-center gap-3 text-sm text-black/70">
          <span className="rounded-full bg-black px-3 py-1 font-medium text-white">
            Milestone: EP-104 / EP-107 (Sprint 2)
          </span>
          <span>
            Dependencies: <code>auth</code>, <code>events</code>,{" "}
            <code>audit_log</code>
          </span>
          <span>
            UX reference: <code>docs/UXFlowNotes.md</code>
          </span>
        </div>
      </header>

      {successMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      <div className="rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-black">
              Review queue snapshot
            </h2>
            <p className="text-sm text-black/70">
              Events pending reviewer action. Filtered to your assignments if
              you are a reviewer.
            </p>
          </div>
        </div>

        {queueSummary.total > 0 ? (
          <div className="mt-4 grid gap-3 rounded-lg border border-black/[0.08] bg-white px-4 py-4 shadow-sm sm:grid-cols-5">
            {summaryCards.map((card) => (
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

        {profile ? (
          <ReviewFilterPersistence
            formId="reviews-filters-form"
            shouldRestore={Boolean(shouldRestoreFilters)}
            filterValue={filterParam}
            reviewerValue={
              isHQPlanner ? reviewerFilter : "all"
            }
          />
        ) : null}

        <form
          id="reviews-filters-form"
          method="get"
          className="mt-4 grid gap-3 rounded-lg border border-black/[0.08] bg-white px-4 py-3 text-sm text-black/70 sm:grid-cols-[1fr_auto] sm:items-end"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="filter"
                className="text-xs font-semibold uppercase tracking-wide text-black/50"
              >
                Status filter
              </label>
              <select
                id="filter"
                name="filter"
                defaultValue={filterParam}
                className="rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
              >
                <option value="active">Active (pending)</option>
                <option value="submitted">Submitted</option>
                <option value="needs_revisions">Needs revisions</option>
                <option value="approved">Approved</option>
                <option value="all">All statuses</option>
              </select>
            </div>

            {isHQPlanner ? (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="reviewer"
                  className="text-xs font-semibold uppercase tracking-wide text-black/50"
                >
                  Reviewer filter
                </label>
                <select
                  id="reviewer"
                  name="reviewer"
                  defaultValue={reviewerFilter}
                  className="rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
                >
                  <option value="all">All reviewers</option>
                  <option value="unassigned">Unassigned drafts</option>
                  {reviewers.map((reviewer) => (
                    <option key={reviewer.id} value={reviewer.id}>
                      {reviewer.full_name ?? reviewer.email ?? "Unnamed reviewer"}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          >
            Apply filters
          </button>
        </form>

        {eventsError ? (
          <div className="mt-6 rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {eventsError.message}
          </div>
        ) : events.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-black/70">
            {isReviewer
              ? "No submissions are currently assigned to you."
              : "No submissions are awaiting review yet. Once drafts are submitted, they will appear here."}
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-black/[0.08]">
            <table className="min-w-full divide-y divide-black/[0.08]">
              <thead className="bg-black/[0.02]">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Event
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Venue
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Start
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    SLA
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Status
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-black/60">
                    Assigned reviewer
                  </th>
                  {isReviewer || isHQPlanner ? (
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-black/60">
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] bg-white">
                {events.map((event) => {
                  const sla = getSlaStatus(event.start_at);

                  return (
                    <tr
                      key={event.id}
                      className={`text-sm text-black/80 transition ${sla.rowTone}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-black">
                        {event.title}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {event.venue?.name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatDateTime(event.start_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${slaToneStyles[sla.tone]}`}
                          >
                            {sla.label}
                          </span>
                          {sla.action ? (
                            <>
                              <span className="text-[10px] font-medium uppercase tracking-wide text-black/50">
                                {sla.action}
                              </span>
                              <Link
                                href="/reviews?filter=submitted"
                                className="text-[10px] font-semibold text-amber-700 hover:underline"
                              >
                                Open queue
                              </Link>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-black/60">
                        {event.status.replace("_", " ")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-black/70">
                        {event.assigned_reviewer?.full_name ??
                          event.assigned_reviewer?.email ??
                          "Unassigned"}
                      </td>
                      {isReviewer || isHQPlanner ? (
                        <td className="px-4 py-3 align-top">
                          {["submitted", "needs_revisions"].includes(event.status) ? (
                            <DecisionForm eventId={event.id} />
                          ) : (
                            <span className="text-xs text-black/40">—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isHQPlanner ? (
        <div className="rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-black">
              Assign or reassign reviewer
            </h2>
            <p className="text-sm text-black/70">
              Use the Supabase-powered `assign_reviewer` RPC to hand off
              submissions. Once reviewer data is seeded, this form can drive the
              queue workflow.
            </p>
          </div>

          {reviewerFetchError ? (
            <div className="mt-4 rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              {reviewerFetchError}
            </div>
          ) : (
            <AssignReviewerForm
              events={assignableEvents}
              reviewers={assignableReviewers}
            />
          )}
        </div>
      ) : null}

      {(isReviewer || isHQPlanner) && (
        <div className="rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-black">
              Recent decisions
            </h2>
            <p className="text-sm text-black/70">
              Latest reviewer decisions captured in Supabase approvals. This feed
              will power the detailed timeline views in upcoming iterations.
            </p>
          </div>

          {approvalsError ? (
            <div className="mt-6 rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              {approvalsError}
            </div>
          ) : approvals.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-black/70">
              No decisions logged yet.
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {approvals.map((record) => (
                <li
                  key={record.id}
                  className="rounded-lg border border-black/[0.08] bg-white px-4 py-3 text-sm text-black/80 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-black">
                      {record.event?.title ?? "Untitled event"}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-black/50">
                      {formatDateTime(record.decided_at)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-black/60">
                    {record.event?.venue?.name ?? "Unknown venue"}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-black/60">
                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-black/60">
                      {record.decision.replace("_", " ")}
                    </span>
                    <span>
                      By{" "}
                      {record.reviewer?.full_name ??
                        record.reviewer?.email ??
                        "Reviewer"}
                    </span>
                  </div>
                  {record.feedback_text ? (
                    <p className="mt-2 text-xs text-black/70">
                      “{record.feedback_text}”
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {reviewFocus.map((area) => (
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
