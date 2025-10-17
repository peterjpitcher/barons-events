import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { diffSnapshot, type DraftDiff } from "@/lib/events/diff";

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
        venue:venues(name),
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

  const venueRecord = Array.isArray(data.venue)
    ? data.venue[0] ?? null
    : data.venue ?? null;

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
    reviewer?: { full_name: string | null; email: string | null } | null;
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
      version: raw.version ?? null,
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
    } satisfies AiMetadataRecord;
  });

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
        (record.reviewed_by ? "HQ planner" : null);

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

  return (
    <section className="space-y-6">
      {focusedFromConflict ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Opened from the planning conflict feed. Review the{" "}
          <a href="#timeline" className="font-semibold underline">
            timeline
          </a>{" "}
          to coordinate venue space adjustments.
        </div>
      ) : focusedFromAi ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          Jumped here from the AI metadata workspace. The{" "}
          <a href="#timeline" className="font-semibold underline">
            event timeline
          </a>{" "}
          can help you verify approved details before publishing.
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-black/60">Event detail</p>
          <h1 className="text-3xl font-semibold text-black">{data.title}</h1>
          <p className="text-sm text-black/60">
            {venueRecord?.name ?? "Unknown venue"} · {formatDateTime(data.start_at)}
          </p>
        </div>
        <Link
          href="/events"
          className="rounded-full border border-black/[0.12] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-black hover:bg-black hover:text-white"
        >
          Back to events
        </Link>
      </div>

      <dl className="grid gap-3 rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm sm:grid-cols-4">
        <Item label="Status" value={data.status.replace("_", " ")} />
        <Item label="Starts" value={formatDateTime(data.start_at)} />
        <Item label="Ends" value={formatDateTime(data.end_at)} />
        <Item
          label="Approvals"
          value={`${approvals.length} decision${approvals.length === 1 ? "" : "s"}`}
        />
      </dl>

      <div
        id="timeline"
        className="space-y-4 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-black">Timeline</h2>
            <p className="text-xs text-black/60">
              Compare manual submissions alongside AI metadata revisions.
            </p>
          </div>
          <div className="inline-flex flex-wrap items-center gap-2">
            {timelineOptions.map(({ value, label }) => {
              const isActive = timelineFilter === value;
              return (
                <Link
                  key={value}
                  href={buildTimelineHref(value)}
                  scroll={false}
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40 ${
                    isActive
                      ? "bg-black text-white"
                      : "border border-black/20 text-black hover:bg-black hover:text-white"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
        {filteredTimelineEntries.length === 0 ? (
          <p className="text-sm text-black/60">
            {timelineFilter === "ai"
              ? "No AI metadata revisions yet. Regenerate content from the planning workspace to populate this section."
              : "No manual submissions captured yet."}
          </p>
        ) : (
          <ol className="space-y-3">
            {filteredTimelineEntries.map((entry) => (
              <li
                key={entry.id}
                className={`rounded-lg border p-4 ${
                  entry.kind === "ai"
                    ? "border-indigo-200 bg-indigo-50"
                    : "border-black/[0.08] bg-black/[0.015]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-black">
                    {entry.kind === "manual"
                      ? `Version ${entry.version}`
                      : `AI version ${entry.version}`}
                  </span>
                  <span className="text-xs text-black/60">
                    {formatDateTime(entry.occurredAt)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-black/60">
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      entry.kind === "manual"
                        ? "border border-rose-200 bg-rose-100 text-rose-800"
                        : "border border-indigo-200 bg-indigo-100 text-indigo-800"
                    }`}
                  >
                    {entry.kind === "manual" ? "Manual" : "AI"}
                  </span>
                  {entry.kind === "manual" && entry.statusLabel ? (
                    <span className="rounded-full bg-black/5 px-2 py-0.5">
                      {entry.statusLabel}
                    </span>
                  ) : null}
                  {entry.kind === "ai" && entry.publishedAt ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                      Published
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-black/60">
                  {entry.kind === "manual"
                    ? `By ${entry.actor}`
                    : [
                        entry.reviewerName ? `Reviewed by ${entry.reviewerName}` : null,
                        entry.generatedBy ? `Generated via ${entry.generatedBy}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Generated by AI"}
                </p>
                {entry.changes.length === 0 ? (
                  <p className="mt-2 text-sm text-black/70">
                    {entry.kind === "ai"
                      ? "Initial AI metadata captured."
                      : "No field changes captured."}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {entry.changes.map((change) => {
                      const source = change.source ?? entry.kind;
                      const isAiChange = source === "ai";
                      const badgeClasses = isAiChange
                        ? "border border-indigo-200 bg-indigo-100 text-indigo-800"
                        : "border border-rose-200 bg-rose-100 text-rose-800";
                      const badgeLabel = isAiChange ? "AI" : "Manual";
                      const label = change.field.replace(/_/g, " ");

                      return (
                        <li
                          key={`${entry.id}-${change.field}`}
                          className="flex items-start gap-2 text-sm text-black/80"
                        >
                          <span
                            className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClasses}`}
                          >
                            {badgeLabel}
                          </span>
                          <span>
                            <span className="font-semibold">{label}</span>:{" "}
                            {formatDiffValue(change.before)} → {formatDiffValue(change.after)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {entry.kind === "ai" && timelineFilter !== "manual" ? (
                  <div className="mt-3 space-y-1 text-sm text-black/70">
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
              </li>
            ))}
          </ol>
        )}
      </div>

      <div
        id="decisions"
        className="space-y-3 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-black">Decisions</h2>
        {approvals.length === 0 ? (
          <p className="text-sm text-black/60">No reviewer decisions yet.</p>
        ) : (
          <ul className="space-y-2">
            {approvals.map((approval) => (
              <li key={`${approval.decision}-${approval.decided_at}`} className="rounded-lg border border-black/[0.05] bg-black/[0.015] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-black">{approval.decision.replace("_", " ")}</span>
                  <span className="text-xs text-black/60">{formatDateTime(approval.decided_at)}</span>
                </div>
                <p className="text-xs text-black/60">
                  By {approval.reviewer?.full_name ?? approval.reviewer?.email ?? "Unknown"}
                </p>
                {approval.feedback_text ? (
                  <p className="mt-2 text-sm text-black/70">{approval.feedback_text}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-black/50">{label}</span>
      <span className="text-sm text-black/80">{value}</span>
    </div>
  );
}
