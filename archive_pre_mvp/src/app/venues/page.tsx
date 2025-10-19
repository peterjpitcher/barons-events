import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ContentGrid, ContentSection } from "@/components/ui/layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { StatPill } from "@/components/ui/stat-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CollapsibleCard } from "@/components/ui/collapsible-card";

type VenueRow = {
  id: string;
  name: string | null;
  updated_at: string | null;
  capacity: number | null;
  areas: Array<{
    id: string;
    name: string | null;
    capacity: number | null;
  }>;
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

const humaniseAuditKey = (key: string) =>
  key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatAuditDetailValue = (value: unknown): string => {
  if (value === null || typeof value === "undefined") {
    return "Not specified";
  }

  if (typeof value === "number") {
    return value.toLocaleString("en-GB");
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          return Object.entries(item as Record<string, unknown>)
            .map(([key, val]) => `${humaniseAuditKey(key)}: ${formatAuditDetailValue(val)}`)
            .join(", ");
        }
        return formatAuditDetailValue(item);
      })
      .join("; ");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "None";
    return entries
      .map(([key, val]) => `${humaniseAuditKey(key)}: ${formatAuditDetailValue(val)}`)
      .join(", ");
  }

  return String(value);
};

const formatAuditDetails = (details: Record<string, unknown> | null): string[] => {
  if (!details) return [];

  return Object.entries(details).map(([key, value]) =>
    `${humaniseAuditKey(key)}: ${formatAuditDetailValue(value)}`
  );
};

const fallbackErrorHelper =
  "Run Supabase migrations (`supabase db reset --local` or `npm run supabase:migrate`) to seed the venues table before testing this view.";

async function fetchVenues(): Promise<{
  data: VenueRow[];
  error: string | null;
}> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("venues")
    .select("id,name,updated_at,capacity,areas:venue_areas(id,name,capacity)")
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

  const normalised = (data ?? []).map((venue) => {
    const areaValue = Array.isArray(venue.areas)
      ? venue.areas
      : venue.areas
        ? [venue.areas]
        : [];

    return {
      ...venue,
      areas: areaValue.map((area) => ({
        id: area.id,
        name: area.name ?? "Unnamed area",
        capacity: typeof area.capacity === "number" ? area.capacity : null,
      })),
    } satisfies VenueRow;
  });

  return {
    data: normalised as VenueRow[],
    error: null,
  };
}

const collectAreaStats = (venues: VenueRow[]) => {
  const venueWithCapacityCount = venues.filter((venue) =>
    venue.areas.some((area) => typeof area.capacity === "number" && area.capacity !== null)
  ).length;

  const capacityValues = venues
    .flatMap((venue) => venue.areas)
    .map((area) => area.capacity)
    .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));

  const averageCapacity = capacityValues.length
    ? Math.round(capacityValues.reduce((total, value) => total + value, 0) / capacityValues.length)
    : null;

  return {
    venueWithCapacityCount,
    averageCapacity,
  };
};

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
  const supabase = await createSupabaseServerClient();
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
  const isCentralPlanner = profile?.role === "central_planner";

  const { data: venues, error } = isCentralPlanner
    ? await fetchVenues()
    : { data: [], error: null };
  const { data: auditEntries, error: auditError } = isCentralPlanner
    ? await fetchVenueAuditLog()
    : { data: [], error: null };
  const toastMessage =
    typeof statusParam === "string"
    ? successMessages[statusParam]
    : null;

  const { venueWithCapacityCount, averageCapacity } = collectAreaStats(venues);

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Venues"
        title="Venue management hub"
        description="Manage venue records, reviewer assignments, and seed data that drives the rest of the planning workspace."
        actions={
          isCentralPlanner ? (
            <Button asChild>
              <Link href="/venues/new">New venue</Link>
            </Button>
          ) : undefined
        }
      >
        {isCentralPlanner ? (
          <ContentGrid columns={3}>
            <StatPill
              label="Total venues"
              value={venues.length}
              trendLabel="Includes seeded demo data"
              trendVariant="flat"
            />
            <StatPill
              label="Venues with capacity"
              value={venueWithCapacityCount}
              trendLabel={`${venues.length} total venues`}
              trendVariant={
                venues.length === 0
                  ? "flat"
                  : venueWithCapacityCount === venues.length
                  ? "up"
                  : "down"
              }
            />
            <StatPill
              label="Avg capacity"
              value={averageCapacity !== null ? `${averageCapacity.toLocaleString("en-GB")} guests` : "—"}
              trendLabel="Update via venue edit form"
              trendVariant={averageCapacity !== null ? "flat" : "down"}
            />
          </ContentGrid>
        ) : null}
      </PageHeader>

      {toastMessage ? (
        <Alert variant="success" title={toastMessage} className="border-[rgba(47,143,104,0.35)]" />
      ) : null}

      {isCentralPlanner ? (
        <div className="space-y-10">
          <ContentSection title="Venue directory" className="space-y-6">
            {error ? (
              <Alert
                variant="danger"
                title="Unable to load venues"
                description={error}
              />
            ) : venues.length === 0 ? (
              <Card className="border-dashed bg-white/80">
                <CardContent className="space-y-3">
                  <CardTitle>No venues found</CardTitle>
                  <CardDescription>
                    Seed data is missing locally. Run{" "}
                    <code className="rounded bg-black/10 px-1.5 py-0.5 text-xs">
                      npm run supabase:reset
                    </code>{" "}
                    to load the demo venues and audit triggers.
                  </CardDescription>
                </CardContent>
              </Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Venue</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {venues.map((venue) => {
                    const areasWithCapacity = (venue.areas ?? []).filter(
                      (area) => typeof area.capacity === "number" && area.capacity !== null
                    );
                    return (
                      <TableRow key={venue.id}>
                        <TableCell className="font-semibold text-[var(--color-primary-900)]">
                          <div className="flex flex-col gap-1">
                            <span>{venue.name ?? "Untitled venue"}</span>
                            {areasWithCapacity.length > 0 ? (
                              <span className="text-xs text-subtle">
                                Areas: {areasWithCapacity
                                  .map((area) =>
                                    `${area.name ?? "Unnamed area"} (${area.capacity?.toLocaleString("en-GB")})`
                                  )
                                  .join(" · ")}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                      <TableCell className="text-sm text-subtle">
                        {formatDate(venue.updated_at)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/venues/${venue.id}/edit`}
                          className="text-sm font-semibold text-[var(--color-primary-700)] underline underline-offset-4 hover:text-[var(--color-primary-900)]"
                        >
                          Edit
                        </Link>
                      </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </ContentSection>

          <ContentSection className="space-y-6">
            {auditError ? (
              <Alert
                variant="danger"
                title="Unable to load audit log"
                description={auditError}
              />
            ) : auditEntries.length === 0 ? (
              <Card className="border-dashed bg-white/80">
                <CardContent className="space-y-3">
                  <CardTitle>No audit entries yet</CardTitle>
                  <CardDescription>
                    Create or update a venue to see history appear here. Each change
                    records actor, timestamp, and payload details.
                  </CardDescription>
                </CardContent>
              </Card>
            ) : (
              <CollapsibleCard
                title="Audit log"
                description="Latest venue changes with actor and payload details."
              >
                <div className="space-y-4">
                  {auditEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-[var(--radius)] border border-[rgba(39,54,64,0.08)] bg-white/90 px-4 py-3 shadow-soft"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                        <span className="font-semibold text-[var(--color-primary-900)]">
                          {actionLabels[entry.action] ?? entry.action}
                        </span>
                        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-subtle">
                          {formatDateTime(entry.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-subtle">
                        {entry.actor?.full_name ?? entry.actor?.email ?? "System automation"}
                      </p>
                      {(() => {
                        const detailLines = formatAuditDetails(entry.details);
                        return detailLines.length > 0 ? (
                          <ul className="mt-3 space-y-1 text-xs text-[var(--color-primary-800)]">
                            {detailLines.map((line, index) => (
                              <li key={`${entry.id}-detail-${index}`}>{line}</li>
                            ))}
                          </ul>
                        ) : null;
                      })()}
                    </div>
                  ))}
                </div>
              </CollapsibleCard>
            )}
          </ContentSection>
        </div>
      ) : (
        <Alert
          variant="neutral"
          title="Central planner access required"
          description="Venue CRUD is restricted to Central planners. Request the appropriate role or continue with reviewer and venue manager views."
        />
      )}

    </div>
  );
}
