"use client";

import { useMemo } from "react";
import { useFormState } from "react-dom";
import {
  saveAiContentAction,
  updateAiContentPublicationAction,
  type PublishAiContentState,
  type SaveAiContentState,
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
  const sortedContent = useMemo(
    () =>
      [...content].sort((a, b) => {
        const first = b.generated_at ? new Date(b.generated_at).getTime() : 0;
        const second = a.generated_at ? new Date(a.generated_at).getTime() : 0;
        return first - second;
      }),
    [content]
  );

  return (
    <div className="space-y-4 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-black">AI metadata review</h2>
        <p className="text-sm text-black/70">
          Inspect generated content, refine wording where needed, and publish once it meets brand standards.
        </p>
      </header>

      {sortedContent.length === 0 ? (
        <p className="rounded-lg border border-dashed border-black/20 bg-white px-3 py-3 text-sm text-black/60">
          No AI metadata yet. Once events are approved the enrichment pipeline will populate this list.
        </p>
      ) : (
        <ul className="space-y-3">
          {sortedContent.map((record) => (
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
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isPublished ? "bg-emerald-100 text-emerald-700" : "bg-black/10 text-black/60"
          }`}
        >
          {isPublished ? "Published" : "Draft"}
        </span>
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
