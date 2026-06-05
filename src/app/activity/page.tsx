import Link from "next/link";
import { redirect } from "next/navigation";
import { AuditTrailAccordion } from "@/components/audit/audit-trail-accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/design-primitives";
import { getCurrentUser } from "@/lib/auth";
import { getActivityFeed, type ActivityFeedFilters } from "@/lib/dashboard";

type ActivitySearchParams = {
  type?: string;
  actor?: string;
  action?: string;
  q?: string;
  from?: string;
  to?: string;
};

type ActivityPageProps = {
  searchParams?: Promise<ActivitySearchParams>;
};

function normaliseType(value: string | undefined): ActivityFeedFilters["type"] {
  return value === "event" || value === "planning" ? value : "all";
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export default async function ActivityPage({ searchParams }: ActivityPageProps): Promise<React.ReactNode> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "administrator") {
    redirect("/unauthorized");
  }

  const params: ActivitySearchParams = (await searchParams?.catch(() => ({} as ActivitySearchParams))) ?? {};
  const filters: ActivityFeedFilters = {
    type: normaliseType(params.type),
    actorId: clean(params.actor),
    action: clean(params.action),
    q: clean(params.q),
    from: clean(params.from),
    to: clean(params.to),
    limit: 100
  };
  const feed = await getActivityFeed(filters);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Audit"
        title="Activity"
        description="Latest event, planning, SOP, attachment, booking, and note audit entries across the workspace."
        actions={
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--canvas-2)]"
          >
            Dashboard
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto_auto]">
            <label className="space-y-1 text-xs font-semibold text-[var(--ink)]">
              <span>Type</span>
              <select
                name="type"
                defaultValue={filters.type ?? "all"}
                className="h-10 w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm font-normal text-[var(--ink)]"
              >
                <option value="all">All types</option>
                <option value="event">Events</option>
                <option value="planning">Planning</option>
              </select>
            </label>

            <label className="space-y-1 text-xs font-semibold text-[var(--ink)]">
              <span>Person</span>
              <select
                name="actor"
                defaultValue={filters.actorId ?? ""}
                className="h-10 w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm font-normal text-[var(--ink)]"
              >
                <option value="">Everyone</option>
                {feed.filterOptions.actors.map((actor) => (
                  <option key={actor.value} value={actor.value}>
                    {actor.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs font-semibold text-[var(--ink)]">
              <span>Action</span>
              <select
                name="action"
                defaultValue={filters.action ?? ""}
                className="h-10 w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm font-normal text-[var(--ink)]"
              >
                <option value="">All actions</option>
                {feed.filterOptions.actions.map((action) => (
                  <option key={action.value} value={action.value}>
                    {action.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs font-semibold text-[var(--ink)]">
              <span>From</span>
              <input
                name="from"
                type="date"
                defaultValue={filters.from ?? ""}
                className="h-10 w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm font-normal text-[var(--ink)]"
              />
            </label>

            <label className="space-y-1 text-xs font-semibold text-[var(--ink)]">
              <span>To</span>
              <input
                name="to"
                type="date"
                defaultValue={filters.to ?? ""}
                className="h-10 w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm font-normal text-[var(--ink)]"
              />
            </label>

            <label className="space-y-1 text-xs font-semibold text-[var(--ink)] lg:col-span-5">
              <span>Search</span>
              <input
                name="q"
                defaultValue={filters.q ?? ""}
                placeholder="Search activity, names, files, or item titles"
                className="h-10 w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm font-normal text-[var(--ink)]"
              />
            </label>

            <div className="flex items-end gap-2 lg:col-span-2">
              <button
                type="submit"
                className="inline-flex h-10 items-center rounded-[7px] bg-[var(--navy)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--navy-700)]"
              >
                Apply
              </button>
              <Link
                href="/activity"
                className="inline-flex h-10 items-center rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--canvas-2)]"
              >
                Clear
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm">All Activity</CardTitle>
          <span className="text-xs text-subtle">
            Showing {feed.entries.length} of {feed.matchingCount} matching entries, newest first
          </span>
        </CardHeader>
        <CardContent>
          {feed.entries.length === 0 ? (
            <p className="text-sm text-subtle">No activity matches these filters.</p>
          ) : (
            <AuditTrailAccordion entries={feed.entries} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
