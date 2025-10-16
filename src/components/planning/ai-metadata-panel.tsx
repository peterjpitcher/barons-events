"use client";

import { useMemo } from "react";
import { useFormState } from "react-dom";
import {
  updateAiContentPublicationAction,
  type PublishAiContentState,
} from "@/actions/ai";

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

type AiMetadataPanelProps = {
  content: AiContentRecord[];
};

const initialState: PublishAiContentState = {};

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

const buildKeywords = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "keywords" in (value as Record<string, unknown>)
  ) {
    const keywords = (value as Record<string, unknown>).keywords;
    if (Array.isArray(keywords)) {
      return keywords.join(", ");
    }
  }
  return "—";
};

const buildAudienceTags = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return "—";
};

const buildTalent = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return "—";
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

  const [state, dispatch] = useFormState<PublishAiContentState, FormData>(
    async (_, formData) =>
      (await updateAiContentPublicationAction(_, formData)) ?? initialState,
    initialState
  );

  return (
    <div className="space-y-4 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-black">AI metadata review</h2>
        <p className="text-sm text-black/70">
          Inspect generated content, confirm it aligns with brand voice, and publish when ready.
        </p>
      </header>

      {state.error ? (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      {sortedContent.length === 0 ? (
        <p className="rounded-lg border border-dashed border-black/20 bg-white px-3 py-3 text-sm text-black/60">
          No AI metadata yet. Once events are approved the enrichment pipeline will populate this list.
        </p>
      ) : (
        <ul className="space-y-3">
          {sortedContent.map((record) => {
            const isPublished = Boolean(record.published_at);
            return (
              <li
                key={record.id}
                className="flex flex-col gap-3 rounded-lg border border-black/[0.06] bg-black/[0.015] p-4 text-sm text-black/80"
              >
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
                      isPublished
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-black/10 text-black/60"
                    }`}
                  >
                    {isPublished ? "Published" : "Draft"}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-black/60">
                      Synopsis
                    </h3>
                    <p className="rounded-md bg-white px-3 py-2 text-sm text-black/80">
                      {record.synopsis ?? "—"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-black/60">
                      Hero copy
                    </h3>
                    <p className="rounded-md bg-white px-3 py-2 text-sm text-black/80">
                      {record.hero_copy ?? "—"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <DetailBlock title="SEO keywords" value={buildKeywords(record.seo_keywords)} />
                  <DetailBlock title="Audience tags" value={buildAudienceTags(record.audience_tags)} />
                  <DetailBlock title="Talent bios" value={buildTalent(record.talent_bios)} />
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-black/60">
                  <span>Generated {formatDateTime(record.generated_at)}</span>
                  <span>Published {formatDateTime(record.published_at)}</span>
                </footer>

                <form action={dispatch} className="flex flex-wrap items-center gap-2 text-xs">
                  <input type="hidden" name="contentId" value={record.id} />
                  <input
                    type="hidden"
                    name="intent"
                    value={isPublished ? "retract" : "publish"}
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-lg border border-black/[0.12] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
                  >
                    {isPublished ? "Retract metadata" : "Publish metadata"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DetailBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-black/60">{title}</h4>
      <p className="rounded-md bg-white px-3 py-2 text-sm text-black/80">{value}</p>
    </div>
  );
}
