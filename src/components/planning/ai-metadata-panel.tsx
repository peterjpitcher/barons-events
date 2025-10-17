"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  saveAiContentAction,
  updateAiContentPublicationAction,
  regenerateAiContentAction,
  type PublishAiContentState,
  type SaveAiContentState,
  type RegenerateAiContentState,
} from "@/actions/ai";

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
      ? "No published AI metadata yet. Publish a version once it meets your standards."
      : filter === "draft"
        ? "No draft AI metadata at the moment. Request a regeneration to capture a fresh version."
        : "No AI metadata yet. Once events are approved the enrichment pipeline will populate this list.";

  return (
    <div
      id="ai-metadata"
      className="space-y-4 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-black">AI metadata review</h2>
          <p className="text-sm text-black/70">
            Inspect generated content, refine wording where needed, and publish once it meets brand standards.
          </p>
        </header>
        <div className="inline-flex flex-wrap items-center gap-2">
          {filterOptions.map(({ value, label }) => {
            const isActive = filter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40 ${
                  isActive
                    ? "bg-black text-white"
                    : "border border-black/20 text-black hover:bg-black hover:text-white"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {filteredContent.length === 0 ? (
        <p className="rounded-lg border border-dashed border-black/20 bg-white px-3 py-3 text-sm text-black/60">
          {emptyMessage}
        </p>
      ) : (
        <ul className="space-y-3">
          {filteredContent.map((record) => (
            <AiMetadataItem key={record.id} record={record} />
          ))}
        </ul>
      )}
    </div>
  );
}

type AiMetadataItemProps = {
  record: AiContentRecord;
};

function AiMetadataItem({ record }: AiMetadataItemProps) {
  const isPublished = Boolean(record.published_at);
  const eventDetailHref = record.event_id
    ? `/events/${record.event_id}?source=ai&timeline=ai#timeline`
    : null;

  const [editState, editDispatch] = useFormState<SaveAiContentState, FormData>(
    async (state, formData) =>
      (await saveAiContentAction(state, formData)) ?? { success: false },
    {}
  );

  const [publishState, publishDispatch] = useFormState<PublishAiContentState, FormData>(
    async (state, formData) =>
      (await updateAiContentPublicationAction(state, formData)) ?? initialPublishState,
    initialPublishState
  );

  const [regenerateState, regenerateDispatch] = useFormState<
    RegenerateAiContentState,
    FormData
  >(
    async (state, formData) =>
      (await regenerateAiContentAction(state, formData)) ?? {},
    {}
  );

  return (
    <li className="flex flex-col gap-4 rounded-lg border border-black/[0.06] bg-black/[0.015] p-4 text-sm text-black/80">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-black">
            {record.event?.title ?? "Untitled event"}
          </p>
          <p className="text-xs text-black/60">
            {record.event?.venue?.name ?? "Unknown venue"} · Version {record.version}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {eventDetailHref ? (
            <Link
              href={eventDetailHref}
              className="inline-flex items-center justify-center rounded-full border border-black/[0.12] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-black transition hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
            >
              View timeline
            </Link>
          ) : null}
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              isPublished ? "bg-emerald-100 text-emerald-700" : "bg-black/10 text-black/60"
            }`}
          >
            {isPublished ? "Published" : "Draft"}
          </span>
        </div>
      </div>

      <form action={editDispatch} className="space-y-3">
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
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          >
            Save changes
          </button>
          {editState.success ? (
            <span className="text-xs text-emerald-600">Changes saved.</span>
          ) : editState.error ? (
            <span className="text-xs text-red-600">{editState.error}</span>
          ) : null}
        </div>
      </form>

      <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-black/60">
        <span>Generated {formatDateTime(record.generated_at)}</span>
        <span>Published {formatDateTime(record.published_at)}</span>
      </footer>

      {publishState.error ? (
        <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {publishState.error}
        </div>
      ) : null}

      <form action={publishDispatch} className="flex flex-wrap items-center gap-2 text-xs">
        <input type="hidden" name="contentId" value={record.id} />
        <input type="hidden" name="intent" value={isPublished ? "retract" : "publish"} />
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg border border-black/[0.12] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
        >
          {isPublished ? "Retract metadata" : "Publish metadata"}
        </button>
      </form>
      <form action={regenerateDispatch} className="flex flex-wrap items-center gap-2 text-xs">
        <input type="hidden" name="contentId" value={record.id} />
        <label className="sr-only" htmlFor={`reason-${record.id}`}>
          Regeneration reason
        </label>
        <input
          id={`reason-${record.id}`}
          name="reason"
          placeholder="Optional reason"
          className="w-full max-w-[220px] rounded-lg border border-black/10 px-3 py-1.5 text-xs text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
        />
        <RegenerateButton />
      </form>
      {regenerateState.contentId === record.id ? (
        regenerateState.success ? (
          <span className="text-xs text-emerald-600">Regeneration requested.</span>
        ) : regenerateState.error ? (
          <span className="text-xs text-red-600">{regenerateState.error}</span>
        ) : null
      ) : null}
    </li>
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
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-black/60">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
      />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
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
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-black/60">
        {label}
      </label>
      <input
        id={id}
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
      />
      {hint ? <p className="text-xs text-black/50">{hint}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function RegenerateButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-lg border border-dashed border-black/[0.2] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Requesting…" : "Request regenerate"}
    </button>
  );
}
