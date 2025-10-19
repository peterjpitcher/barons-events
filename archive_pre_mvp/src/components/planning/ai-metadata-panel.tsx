"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  saveAiContentAction,
  updateAiContentPublicationAction,
  regenerateAiContentAction,
  type PublishAiContentState,
  type SaveAiContentState,
  type RegenerateAiContentState,
} from "@/actions/ai";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardSurface,
  CardFooter,
} from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";

const initialPublishState: PublishAiContentState = {};

type AiContentRecord = {
  id: string;
  event_id: string;
  version: number;
  synopsis: string | null;
  hero_copy: string | null;
  seo_keywords: unknown;
  audience_tags: unknown;
  talent_bios: unknown;
  generated_at: string | null;
  published_at: string | null;
  event?: {
    title: string | null;
    venue?: { name: string | null } | null;
  } | null;
};

export type AiMetadataPanelProps = {
  content: AiContentRecord[];
};

type AiMetadataFilter = "all" | "draft" | "published";

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
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

const toCommaSeparated = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
};

export function AiMetadataPanel({ content }: AiMetadataPanelProps) {
  const [filter, setFilter] = useState<AiMetadataFilter>("all");

  const sortedContent = useMemo(
    () =>
      [...content].sort((a, b) => {
        const first = b.generated_at ? new Date(b.generated_at).getTime() : 0;
        const second = a.generated_at ? new Date(a.generated_at).getTime() : 0;
        return first - second;
      }),
    [content]
  );

  const publishedCount = useMemo(
    () => sortedContent.filter((record) => Boolean(record.published_at)).length,
    [sortedContent]
  );
  const draftCount = sortedContent.length - publishedCount;

  const filteredContent = useMemo(() => {
    if (filter === "published") {
      return sortedContent.filter((record) => Boolean(record.published_at));
    }
    if (filter === "draft") {
      return sortedContent.filter((record) => !record.published_at);
    }
    return sortedContent;
  }, [filter, sortedContent]);

  const versionsByEvent = useMemo(() => {
    const map = new Map<string, AiContentRecord[]>();
    for (const record of sortedContent) {
      const list = map.get(record.event_id);
      if (list) {
        list.push(record);
      } else {
        map.set(record.event_id, [record]);
      }
    }
    map.forEach((records, key) => {
      records.sort((a, b) => b.version - a.version);
      map.set(key, records);
    });
    return map;
  }, [sortedContent]);

  const previousVersionMap = useMemo(() => {
    const map = new Map<string, AiContentRecord | null>();
    versionsByEvent.forEach((records) => {
      records.forEach((record, index) => {
        map.set(record.id, records[index + 1] ?? null);
      });
    });
    return map;
  }, [versionsByEvent]);

  const filterOptions: Array<{ value: AiMetadataFilter; label: string }> = [
    {
      value: "all",
      label: `All${sortedContent.length ? ` (${sortedContent.length})` : ""}`,
    },
    {
      value: "draft",
      label: `Draft${draftCount ? ` (${draftCount})` : ""}`,
    },
    {
      value: "published",
      label: `Published${publishedCount ? ` (${publishedCount})` : ""}`,
    },
  ];

  const emptyMessage =
    filter === "published"
      ? "No published AI copy yet. Publish a version once it feels ready for the team."
      : filter === "draft"
        ? "No AI drafts right now. Request a new version to generate fresh copy."
        : "AI copy will appear here after approved events finish processing.";

  return (
    <Card id="ai-metadata">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle>AI copy review</CardTitle>
            <CardDescription>
              Check the AI text, tidy it up, and publish once it matches the Barons voice.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {filterOptions.map(({ value, label }) => {
              const isActive = filter === value;
              return (
                <Button
                  key={value}
                  type="button"
                  variant={isActive ? "primary" : "outline"}
                  size="sm"
                  onClick={() => setFilter(value)}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filteredContent.length === 0 ? (
          <Alert
            variant="neutral"
            title="No AI copy yet"
            description={emptyMessage}
          />
        ) : (
          <div className="space-y-4">
            {filteredContent.map((record) => (
              <AiMetadataItem
                key={record.id}
                record={record}
                siblings={versionsByEvent.get(record.event_id) ?? []}
                previousVersion={previousVersionMap.get(record.id) ?? null}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type AiMetadataItemProps = {
  record: AiContentRecord;
  siblings: AiContentRecord[];
  previousVersion: AiContentRecord | null;
};

function AiMetadataItem({ record, siblings, previousVersion }: AiMetadataItemProps) {
  const isPublished = Boolean(record.published_at);
  const eventDetailHref = record.event_id
    ? `/events/${record.event_id}?source=ai&timeline=ai#timeline`
    : null;

  const [editState, editDispatch] = useActionState<SaveAiContentState, FormData>(
    async (state, formData) =>
      (await saveAiContentAction(state, formData)) ?? { success: false },
    {}
  );

  const [publishState, publishDispatch] = useActionState<PublishAiContentState, FormData>(
    async (state, formData) =>
      (await updateAiContentPublicationAction(state, formData)) ?? initialPublishState,
    initialPublishState
  );

  const [regenerateState, regenerateDispatch] = useActionState<
    RegenerateAiContentState,
    FormData
  >(
    async (state, formData) =>
      (await regenerateAiContentAction(state, formData)) ?? {},
    {}
  );

  const timelineLimit = 6;
  const timelineRecords = siblings.slice(0, timelineLimit);
  const remainingTimeline = Math.max(0, siblings.length - timelineRecords.length);

  const diffBadges: Array<{ label: string; variant: BadgeVariant }> = [];
  if (!previousVersion) {
    diffBadges.push({ label: "First version", variant: "info" });
  } else {
    const synopsisChanged =
      (previousVersion.synopsis ?? "") !== (record.synopsis ?? "");
    const heroChanged =
      (previousVersion.hero_copy ?? "") !== (record.hero_copy ?? "");
    const keywordsChanged =
      toCommaSeparated(previousVersion.seo_keywords) !==
      toCommaSeparated(record.seo_keywords);
    const audienceChanged =
      toCommaSeparated(previousVersion.audience_tags) !==
      toCommaSeparated(record.audience_tags);
    const talentChanged =
      toCommaSeparated(previousVersion.talent_bios) !==
      toCommaSeparated(record.talent_bios);

    if (synopsisChanged) diffBadges.push({ label: "Synopsis updated", variant: "info" });
    if (heroChanged) diffBadges.push({ label: "Hero copy updated", variant: "info" });
    if (keywordsChanged) diffBadges.push({ label: "SEO keywords updated", variant: "info" });
    if (audienceChanged) diffBadges.push({ label: "Audience tags updated", variant: "info" });
    if (talentChanged) diffBadges.push({ label: "Talent bios updated", variant: "info" });

    if (diffBadges.length === 0) {
      diffBadges.push({ label: "Matches previous version", variant: "neutral" });
    }
  }

  return (
    <CardSurface className="space-y-5 p-5 text-sm text-[var(--color-primary-800)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            {eventDetailHref ? (
              <Link
                href={eventDetailHref}
                className="text-base font-semibold text-[var(--color-primary-900)] underline-offset-2 hover:text-[var(--color-primary-700)] hover:underline"
              >
                {record.event?.title ?? "Untitled event"}
              </Link>
            ) : (
              <span className="text-base font-semibold text-[var(--color-primary-900)]">
                {record.event?.title ?? "Untitled event"}
              </span>
            )}
            <Badge variant="neutral">Version {record.version}</Badge>
            {eventDetailHref ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
              >
                <Link href={eventDetailHref}>View timeline</Link>
              </Button>
            ) : null}
          </div>
          <div className="text-xs text-[var(--color-primary-600)]">
            {record.event?.venue?.name ?? "Unknown venue"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isPublished ? "success" : "info"}>
            {isPublished ? "Published" : "Draft"}
          </Badge>
          {diffBadges.slice(0, 3).map((badge) => (
            <Badge key={`${record.id}-${badge.label}`} variant={badge.variant}>
              {badge.label}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-primary-600)]">
        {timelineRecords.map((item) => {
          const isActive = item.id === record.id;
          const variant: BadgeVariant = isActive
            ? item.published_at
              ? "success"
              : "info"
            : item.published_at
            ? "success"
            : "neutral";
          return (
            <Badge
              key={item.id}
              variant={variant}
              className={isActive ? "ring-2 ring-[rgba(78,130,142,0.35)]" : undefined}
            >
              V{item.version}
            </Badge>
          );
        })}
        {remainingTimeline > 0 ? (
          <Badge variant="neutral">+{remainingTimeline}</Badge>
        ) : null}
      </div>

      <form action={editDispatch} className="space-y-4">
        <input type="hidden" name="contentId" value={record.id} />

        <TextareaField
          id={`synopsis-${record.id}`}
          name="synopsis"
          label="Synopsis"
          rows={3}
          defaultValue={record.synopsis ?? ""}
          error={editState.fieldErrors?.synopsis}
        />

        <TextareaField
          id={`hero-${record.id}`}
          name="heroCopy"
          label="Hero copy"
          rows={2}
          defaultValue={record.hero_copy ?? ""}
          error={editState.fieldErrors?.heroCopy}
        />

        <div className="grid gap-3 md:grid-cols-3">
          <InputField
            id={`keywords-${record.id}`}
            name="seoKeywords"
            label="SEO keywords"
            defaultValue={toCommaSeparated(record.seo_keywords)}
            hint="Comma-separated"
            error={editState.fieldErrors?.seoKeywords}
          />
          <InputField
            id={`audience-${record.id}`}
            name="audienceTags"
            label="Audience tags"
            defaultValue={toCommaSeparated(record.audience_tags)}
            hint="Comma-separated"
            error={editState.fieldErrors?.audienceTags}
          />
          <InputField
            id={`talent-${record.id}`}
            name="talentBios"
            label="Talent bios"
            defaultValue={toCommaSeparated(record.talent_bios)}
            hint="Comma-separated"
            error={editState.fieldErrors?.talentBios}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" size="sm">
            Save changes
          </Button>
          {editState.success ? (
            <Badge variant="success">Changes saved</Badge>
          ) : editState.error ? (
            <Badge variant="danger">{editState.error}</Badge>
          ) : null}
        </div>
      </form>

      {publishState.error ? (
        <Alert variant="danger" title="Publish error" description={publishState.error} />
      ) : null}

      <CardFooter className="flex flex-wrap items-center justify-between gap-4 text-xs text-[var(--color-primary-600)]">
        <div className="space-y-1">
          <span>Generated {formatDateTime(record.generated_at)}</span>
          <span>Published {formatDateTime(record.published_at)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form action={publishDispatch} className="flex items-center gap-2">
            <input type="hidden" name="contentId" value={record.id} />
            <input type="hidden" name="intent" value={isPublished ? "retract" : "publish"} />
            <Button
              type="submit"
              variant={isPublished ? "outline" : "primary"}
              size="sm"
            >
              {isPublished ? "Retract copy" : "Publish copy"}
            </Button>
          </form>
          <form
            action={regenerateDispatch}
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="contentId" value={record.id} />
            <label className="sr-only" htmlFor={`reason-${record.id}`}>
              Reason for requesting a new version
            </label>
            <Input
              id={`reason-${record.id}`}
              name="reason"
              placeholder="Optional reason"
              className="h-8 max-w-[220px] text-xs"
            />
            <RegenerateButton />
          </form>
        </div>
      </CardFooter>
      {regenerateState.contentId === record.id ? (
        regenerateState.success ? (
          <Badge variant="success">New version requested</Badge>
        ) : regenerateState.error ? (
          <Badge variant="danger">{regenerateState.error}</Badge>
        ) : null
      ) : null}
    </CardSurface>
  );
}

type TextareaFieldProps = {
  id: string;
  name: string;
  label: string;
  rows: number;
  defaultValue: string;
  error?: string;
};

function TextareaField({ id, name, label, rows, defaultValue, error }: TextareaFieldProps) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary-600)]"
      >
        {label}
      </label>
      <Textarea id={id} name={name} rows={rows} defaultValue={defaultValue} />
      {error ? <p className="text-xs text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

type InputFieldProps = {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  hint?: string;
  error?: string;
};

function InputField({ id, name, label, defaultValue, hint, error }: InputFieldProps) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary-600)]"
      >
        {label}
      </label>
      <Input id={id} name={name} defaultValue={defaultValue} />
      {hint ? <p className="text-xs text-[var(--color-primary-500)]">{hint}</p> : null}
      {error ? <p className="text-xs text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

function RegenerateButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      className="h-8 border-dashed"
    >
      {pending ? "Sending…" : "Request new version"}
    </Button>
  );
}
