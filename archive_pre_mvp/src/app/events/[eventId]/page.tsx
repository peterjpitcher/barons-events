import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { diffSnapshot, type DraftDiff } from "@/lib/events/diff";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { ContentSection, ContentGrid } from "@/components/ui/layout";
import { AiMetadataPanel } from "@/components/planning/ai-metadata-panel";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";

type TimelineFilter = "all" | "manual" | "ai";

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDiffValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (value === null || value === undefined) {
    return "—";
  }
  return String(value);
};

const normaliseStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0);
      }
    } catch {
      // Not JSON – fall back to comma-separated parsing
    }

    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
};

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const profile = await getCurrentUserProfile();

  const supabase = await createSupabaseServerClient();
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
        venue:venues(name),
        areas:event_areas(
          venue_area:venue_areas(id,name,capacity)
        ),
        versions:event_versions(
          version,
          created_at,
          submitted_at,
          submitted_by,
          payload,
          submitter:users(full_name,email)
        ),
        approvals:approvals(
          decision,
          decided_at,
          reviewer:users(full_name,email),
          feedback_text
        ),
        metadata:ai_content(
          id,
          event_id,
          version,
          synopsis,
          hero_copy,
          seo_keywords,
          audience_tags,
          talent_bios,
          generated_at,
          generated_by,
          published_at,
          reviewed_by,
          reviewer:users!ai_content_reviewed_by_fkey(full_name,email)
        )
      `
    )
    .eq("id", resolvedParams.eventId)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const canEdit = Boolean(
    profile &&
      ["draft", "needs_revisions"].includes(data.status ?? "") &&
      (profile.role === "central_planner" ||
        (profile.role === "venue_manager" && profile.id === data.created_by))
  );

  const venueRecord = Array.isArray(data.venue)
    ? data.venue[0] ?? null
    : data.venue ?? null;

  const rawAreaEntries = data.areas ?? [];
  const areaEntries = Array.isArray(rawAreaEntries)
    ? rawAreaEntries
    : rawAreaEntries
      ? [rawAreaEntries]
      : [];

  const eventAreas = areaEntries
    .map((entry) => {
      const raw = entry as unknown as {
        venue_area?:
          | { id: string; name: string | null; capacity: number | null }
          | Array<{ id: string; name: string | null; capacity: number | null }>
          | null;
      };

      const relation = Array.isArray(raw.venue_area)
        ? raw.venue_area[0] ?? null
        : raw.venue_area ?? null;

      if (!relation) {
        return null;
      }

      return {
        id: relation.id,
        name: relation.name ?? "Unnamed area",
        capacity: typeof relation.capacity === "number" ? relation.capacity : null,
      };
    })
    .filter((area): area is { id: string; name: string; capacity: number | null } => Boolean(area));

  const areaLabel =
    eventAreas.length > 0
      ? eventAreas.map((area) => area.name).join(", ")
      : "Not selected";

  const versions = (data.versions ?? []).map((version) => ({
    ...version,
    submitter: Array.isArray(version.submitter)
      ? version.submitter[0] ?? null
      : version.submitter ?? null,
  }));

  const approvals = (data.approvals ?? []).map((approval) => ({
    ...approval,
    reviewer: Array.isArray(approval.reviewer)
      ? approval.reviewer[0] ?? null
      : approval.reviewer ?? null,
  }));

  type AiMetadataRecord = {
    id: string;
    event_id: string;
    version: number;
    synopsis: string | null;
    hero_copy: string | null;
    seo_keywords: unknown;
    audience_tags: unknown;
    talent_bios: unknown;
    generated_at: string | null;
    generated_by: string | null;
    published_at: string | null;
    reviewed_by: string | null;
    reviewer?: { full_name: string | null; email: string | null } | null;
    event: {
      title: string | null;
      venue?: { name: string | null } | null;
    } | null;
  };

  const metadataRaw = data.metadata ?? [];
  const metadataEntries = Array.isArray(metadataRaw)
    ? metadataRaw
    : metadataRaw
      ? [metadataRaw]
      : [];
  const aiContent = metadataEntries.map((record) => {
    const raw = record as unknown as {
      id: string;
      event_id: string | null;
      version: number | null;
      synopsis: string | null;
      hero_copy: string | null;
      seo_keywords: unknown;
      audience_tags: unknown;
      talent_bios: unknown;
      generated_at: string | null;
      generated_by: string | null;
      published_at: string | null;
      reviewed_by: string | null;
      reviewer?:
        | { full_name: string | null; email: string | null }
        | Array<{ full_name: string | null; email: string | null }>
        | null;
    };

    const reviewerValue = Array.isArray(raw.reviewer)
      ? raw.reviewer[0] ?? null
      : raw.reviewer ?? null;

    return {
      id: raw.id,
      event_id: raw.event_id ?? data.id,
      version: raw.version ?? 1,
      synopsis: raw.synopsis ?? null,
      hero_copy: raw.hero_copy ?? null,
      seo_keywords: raw.seo_keywords,
      audience_tags: raw.audience_tags,
      talent_bios: raw.talent_bios,
      generated_at: raw.generated_at ?? null,
      generated_by: raw.generated_by ?? null,
      published_at: raw.published_at ?? null,
      reviewed_by: raw.reviewed_by ?? null,
      reviewer: reviewerValue ?? null,
      event: {
        title: data.title ?? null,
        venue: venueRecord ? { name: venueRecord.name ?? null } : null,
      },
    } satisfies AiMetadataRecord;
  });

  const aiPanelContent = aiContent.map((record) => ({
    id: record.id,
    event_id: record.event_id,
    version: record.version,
    synopsis: record.synopsis,
    hero_copy: record.hero_copy,
    seo_keywords: record.seo_keywords,
    audience_tags: record.audience_tags,
    talent_bios: record.talent_bios,
    generated_at: record.generated_at,
    published_at: record.published_at,
    event: record.event,
  }));
  const timelineParamRaw = resolvedSearchParams?.timeline;
  const timelineParam = Array.isArray(timelineParamRaw)
    ? timelineParamRaw[0]
    : typeof timelineParamRaw === "string"
      ? timelineParamRaw
      : null;
  const timelineFilter: TimelineFilter =
    timelineParam === "manual" || timelineParam === "ai" ? timelineParam : "all";

  const searchParamRecord = resolvedSearchParams ?? {};

  const sourceParam =
    typeof resolvedSearchParams?.source === "string"
      ? resolvedSearchParams.source
      : null;
  const focusedFromConflict = sourceParam === "conflict";
  const focusedFromAi = sourceParam === "ai";

  const statusLabels: Record<string, string> = {
    draft: "Draft",
    submitted: "Submitted",
    needs_revisions: "Needs revisions",
    approved: "Approved",
    rejected: "Rejected",
    published: "Published",
    completed: "Completed",
  };

  const statusVariantMap: Record<string, BadgeVariant> = {
    draft: "neutral",
    submitted: "info",
    needs_revisions: "warning",
    approved: "success",
    rejected: "danger",
    published: "success",
    completed: "success",
  };

  type ManualTimelineEntry = {
    kind: "manual";
    id: string;
    version: number;
    occurredAt: string | null;
    actor: string;
    statusLabel: string | null;
    changes: DraftDiff;
  };

  type AiTimelineEntry = {
    kind: "ai";
    id: string;
    version: number;
    occurredAt: string | null;
    generatedBy: string | null;
    reviewerName: string | null;
    publishedAt: string | null;
    changes: DraftDiff;
    snapshot: {
      synopsis: string | null;
      hero_copy: string | null;
      seo_keywords: string[];
      audience_tags: string[];
      talent_bios: string[];
    };
  };

  type TimelineEntry = ManualTimelineEntry | AiTimelineEntry;

  const manualEntries: ManualTimelineEntry[] = [...versions]
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
    .map((version, index, array) => {
      const previousPayload = array[index + 1]?.payload ?? null;
      const diff = diffSnapshot(previousPayload, version.payload, {
        sourceTag: "manual",
      });

      const payloadStatus =
        version.payload &&
        typeof version.payload === "object" &&
        typeof (version.payload as { status?: unknown }).status === "string"
          ? ((version.payload as { status?: string }).status ?? null)
          : null;

      return {
        kind: "manual" as const,
        id: `manual-${version.version ?? index}-${version.created_at ?? version.submitted_at ?? index}`,
        version: version.version ?? 0,
        occurredAt: version.created_at ?? version.submitted_at ?? null,
        actor: version.submitter?.full_name ?? version.submitter?.email ?? "Unknown",
        statusLabel: payloadStatus ? statusLabels[payloadStatus] ?? payloadStatus : null,
        changes: diff,
      };
    });

  const aiEntries: AiTimelineEntry[] = [...aiContent]
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
    .map((record, index, array) => {
      const snapshot = {
        synopsis: record.synopsis,
        hero_copy: record.hero_copy,
        seo_keywords: normaliseStringList(record.seo_keywords),
        audience_tags: normaliseStringList(record.audience_tags),
        talent_bios: normaliseStringList(record.talent_bios),
      };

      const previousRecord = array[index + 1];
      const previousSnapshot = previousRecord
        ? {
            synopsis: previousRecord.synopsis,
            hero_copy: previousRecord.hero_copy,
            seo_keywords: normaliseStringList(previousRecord.seo_keywords),
            audience_tags: normaliseStringList(previousRecord.audience_tags),
            talent_bios: normaliseStringList(previousRecord.talent_bios),
          }
        : null;

      const diff = diffSnapshot(previousSnapshot, snapshot, {
        sourceTag: "ai",
      });

      const reviewerName =
        record.reviewer?.full_name ??
        record.reviewer?.email ??
        (record.reviewed_by ? "Central planner" : null);

      return {
        kind: "ai" as const,
        id: `ai-${record.id}`,
        version: record.version ?? 0,
        occurredAt: record.generated_at ?? null,
        generatedBy: record.generated_by ?? null,
        reviewerName,
        publishedAt: record.published_at ?? null,
        changes: diff,
        snapshot,
      };
    });

  const eventStatusLabel =
    statusLabels[data.status] ?? data.status.replace(/_/g, " ");
  const statusBadgeVariant =
    statusVariantMap[data.status] ?? "neutral";
  const startLabel = formatDateTime(data.start_at);
  const endLabel = formatDateTime(data.end_at);
  const approvalsLabel = `${approvals.length} decision${
    approvals.length === 1 ? "" : "s"
  }`;

  const timelineEntries: TimelineEntry[] = [...manualEntries, ...aiEntries].sort((left, right) => {
    const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
    const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return right.version - left.version;
  });

  const filteredTimelineEntries =
    timelineFilter === "all"
      ? timelineEntries
      : timelineEntries.filter((entry) => entry.kind === timelineFilter);

  const manualCount = manualEntries.length;
  const aiCount = aiEntries.length;
  const basePath = `/events/${resolvedParams.eventId}`;

  const buildTimelineHref = (target: TimelineFilter) => {
    const query = new URLSearchParams();

    for (const [key, rawValue] of Object.entries(searchParamRecord)) {
      if (key === "timeline" || rawValue === undefined) continue;
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        if (typeof value === "string") {
          query.append(key, value);
        }
      }
    }

    if (target !== "all") {
      query.set("timeline", target);
    }

    const queryString = query.toString();
    return queryString.length > 0 ? `${basePath}?${queryString}` : basePath;
  };

  const timelineOptions: Array<{ value: TimelineFilter; label: string }> = [
    { value: "all", label: "All updates" },
    { value: "manual", label: `Manual edits${manualCount ? ` (${manualCount})` : ""}` },
    { value: "ai", label: `AI metadata${aiCount ? ` (${aiCount})` : ""}` },
  ];

  const decisionVariantMap: Record<string, BadgeVariant> = {
    approved: "success",
    rejected: "danger",
    needs_revisions: "warning",
    submitted: "info",
  };

  return (
    <div className="space-y-10">
      {focusedFromConflict ? (
        <Alert variant="warning" title="Conflict follow-up required">
          <p className="mt-2 text-sm text-[var(--color-text)]">
            Opened from the planning conflict feed. Review the{" "}
            <Link href="#timeline" className="font-semibold underline">
              timeline
            </Link>{" "}
            to coordinate venue space adjustments.
          </p>
        </Alert>
      ) : null}
      {focusedFromAi ? (
        <Alert variant="info" title="AI metadata context">
          <p className="mt-2 text-sm text-[var(--color-text)]">
            Jumped here from the AI workspace. Check the{" "}
            <Link href="#timeline" className="font-semibold underline">
              timeline
            </Link>{" "}
            to confirm approved details before publishing.
          </p>
        </Alert>
      ) : null}

      <PageHeader
        eyebrow="Event detail"
        title={data.title}
        description={`${venueRecord?.name ?? "Unknown venue"} · ${startLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button asChild>
                <Link href={`/events/${resolvedParams.eventId}/edit`}>Edit draft</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href="/events">Back to events</Link>
            </Button>
          </div>
        }
      >
        <ContentGrid columns={4}>
          <Card>
            <CardContent className="space-y-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                Status
              </CardTitle>
              <Badge variant={statusBadgeVariant}>{eventStatusLabel}</Badge>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                Starts
              </CardTitle>
              <CardDescription className="text-sm text-[var(--color-text)]">
                {startLabel}
              </CardDescription>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                Ends
              </CardTitle>
              <CardDescription className="text-sm text-[var(--color-text)]">
                {endLabel}
              </CardDescription>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                  Reserved areas
                </CardTitle>
                <CardDescription className="text-sm text-[var(--color-text)]">
                  {areaLabel}
                </CardDescription>
                {eventAreas.length > 0 ? (
                  <div className="space-y-1 text-xs text-subtle">
                    {eventAreas.map((area) => (
                      <div key={area.id} className="flex items-center justify-between gap-3">
                        <span>{area.name}</span>
                        <span>
                          {typeof area.capacity === "number"
                            ? `${area.capacity} capacity`
                            : "Capacity n/a"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                  Decisions
                </p>
                <CardDescription className="text-sm text-[var(--color-text)]">
                  {approvalsLabel}
                </CardDescription>
              </div>
            </CardContent>
          </Card>
        </ContentGrid>
      </PageHeader>

      <ContentSection
        id="ai-copy"
        title="AI copy review"
        description="Tidy the AI-generated synopsis, hero copy, and keywords before sharing wider."
      >
        <AiMetadataPanel content={aiPanelContent} />
      </ContentSection>
      <ContentSection
        id="decisions"
        title="Reviewer decisions"
        description="Log of approvals, rejections, and revision requests for this event."
      >
        <Card>
          <CardContent className="space-y-4">
            {approvals.length === 0 ? (
              <CardDescription>No reviewer decisions yet.</CardDescription>
            ) : (
              <div className="space-y-3">
                {approvals.map((approval) => {
                  const decisionLabel = approval.decision.replace(/_/g, " ");
                  const decisionVariant =
                    decisionVariantMap[approval.decision] ?? "neutral";
                  const reviewerName =
                    approval.reviewer?.full_name ??
                    approval.reviewer?.email ??
                    "Unknown";
                  return (
                    <Card
                      key={`${approval.decision}-${approval.decided_at}`}
                      className="border-[rgba(39,54,64,0.1)] bg-white"
                    >
                      <CardContent className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-base font-semibold text-[var(--color-primary-900)]">
                              {decisionLabel}
                            </CardTitle>
                            <Badge variant={decisionVariant}>{decisionLabel}</Badge>
                          </div>
                          <span className="text-xs text-subtle">
                            {formatDateTime(approval.decided_at)}
                          </span>
                        </div>
                        <CardDescription>By {reviewerName}</CardDescription>
                        {approval.feedback_text ? (
                          <p className="text-sm text-[var(--color-text)]">
                            {approval.feedback_text}
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </ContentSection>

      <ContentSection
        id="timeline"
        title="Timeline"
        description="Compare manual submissions alongside AI metadata revisions."
        className="space-y-6"
      >
        <CollapsibleCard
          title="Event history"
          description="Switch between manual updates or AI revisions to inspect changes."
          defaultOpen={focusedFromAi || focusedFromConflict || timelineFilter !== "all"}
        >
          <div className="flex flex-wrap items-center gap-2">
            {timelineOptions.map(({ value, label }) => {
              const isActive = timelineFilter === value;
              return (
                <Button
                  key={value}
                  asChild
                  size="sm"
                  variant={isActive ? "primary" : "outline"}
                >
                  <Link href={buildTimelineHref(value)} scroll={false}>
                    {label}
                  </Link>
                </Button>
              );
            })}
          </div>

          {filteredTimelineEntries.length === 0 ? (
            <CardDescription className="text-sm">
              {timelineFilter === "ai"
                ? "No AI metadata revisions yet. Regenerate content to populate this section."
                : "No manual submissions captured yet."}
            </CardDescription>
          ) : (
            <ol className="space-y-4">
              {filteredTimelineEntries.map((entry) => {
                const isAiEntry = entry.kind === "ai";
                const entryVariantClass = isAiEntry
                  ? "border-[rgba(78,130,142,0.35)] bg-[rgba(78,130,142,0.08)]"
                  : "border-[rgba(196,125,78,0.35)] bg-[rgba(196,125,78,0.08)]";
                return (
                  <li key={entry.id}>
                    <Card className={entryVariantClass}>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-base font-semibold text-[var(--color-primary-900)]">
                              {isAiEntry ? `AI version ${entry.version}` : `Version ${entry.version}`}
                            </CardTitle>
                            <Badge variant={isAiEntry ? "info" : "warning"}>
                              {isAiEntry ? "AI" : "Manual"}
                            </Badge>
                            {!isAiEntry && entry.statusLabel ? (
                              <Badge variant="neutral">{entry.statusLabel}</Badge>
                            ) : null}
                            {isAiEntry && entry.publishedAt ? (
                              <Badge variant="success">Published</Badge>
                            ) : null}
                          </div>
                          <span className="text-xs text-subtle">
                            {formatDateTime(entry.occurredAt)}
                          </span>
                        </div>
                        <p className="text-xs text-subtle">
                          {isAiEntry
                            ? [
                                entry.reviewerName ? `Reviewed by ${entry.reviewerName}` : null,
                                entry.generatedBy ? `Generated via ${entry.generatedBy}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Generated by AI"
                            : `By ${entry.actor}`}
                        </p>
                        {entry.changes.length === 0 ? (
                          <CardDescription className="text-sm">
                            {isAiEntry
                              ? "Initial AI metadata captured."
                              : "No field changes detected."}
                          </CardDescription>
                        ) : (
                          <div className="space-y-2">
                            {entry.changes.map((change) => {
                              const source = change.source ?? entry.kind;
                              const isAiChange = source === "ai";
                              const badgeVariant = isAiChange ? "info" : "warning";
                              const badgeLabel = isAiChange ? "AI" : "Manual";
                              const label = change.field.replace(/_/g, " ");
                              return (
                                <div
                                  key={`${entry.id}-${change.field}`}
                                  className="flex flex-wrap items-start gap-2 text-sm text-[var(--color-text)]"
                                >
                                  <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                                  <span className="leading-relaxed">
                                    <span className="font-semibold">{label}</span>:{" "}
                                    {formatDiffValue(change.before)} →{" "}
                                    {formatDiffValue(change.after)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {isAiEntry && timelineFilter !== "manual" ? (
                          <div className="grid gap-2 rounded-[var(--radius)] border border-white/40 bg-white/40 px-4 py-3 text-sm text-[var(--color-text)]">
                            <p>
                              <span className="font-semibold">Synopsis</span>:{" "}
                              {entry.snapshot.synopsis ?? "—"}
                            </p>
                            <p>
                              <span className="font-semibold">Hero copy</span>:{" "}
                              {entry.snapshot.hero_copy ?? "—"}
                            </p>
                            <p>
                              <span className="font-semibold">SEO keywords</span>:{" "}
                              {entry.snapshot.seo_keywords.length
                                ? entry.snapshot.seo_keywords.join(", ")
                                : "—"}
                            </p>
                            <p>
                              <span className="font-semibold">Audience tags</span>:{" "}
                              {entry.snapshot.audience_tags.length
                                ? entry.snapshot.audience_tags.join(", ")
                                : "—"}
                            </p>
                            {entry.snapshot.talent_bios.length ? (
                              <p>
                                <span className="font-semibold">Talent bios</span>:{" "}
                                {entry.snapshot.talent_bios.join(", ")}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
        </CollapsibleCard>
      </ContentSection>
    </div>
  );
}
