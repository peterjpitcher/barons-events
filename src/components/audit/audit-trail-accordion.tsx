"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

export type AuditTrailAccordionDetail = {
  label: string;
  value: string;
};

export type AuditTrailAccordionEntry = {
  id: string;
  actionLabel: string;
  actorName: string;
  timestampLabel: string;
  createdAtIso: string | null;
  contextLabel?: string | null;
  contextTypeLabel?: string | null;
  details: AuditTrailAccordionDetail[];
  feedback: string | null;
};

type AuditTrailAccordionProps = {
  entries: AuditTrailAccordionEntry[];
};

export function AuditTrailAccordion({ entries }: AuditTrailAccordionProps) {
  const allIds = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const openCount = allIds.filter((id) => openIds.has(id)).length;
  const allOpen = entries.length > 0 && openCount === entries.length;
  const noneOpen = openCount === 0;

  function toggleEntry(entryId: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--canvas-2)] disabled:cursor-not-allowed disabled:opacity-45"
          disabled={allOpen}
          onClick={() => setOpenIds(new Set(allIds))}
        >
          Expand all
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--canvas-2)] disabled:cursor-not-allowed disabled:opacity-45"
          disabled={noneOpen}
          onClick={() => setOpenIds(new Set())}
        >
          Collapse all
        </button>
      </div>

      <ol className="space-y-3">
        {entries.map((entry) => {
          const isOpen = openIds.has(entry.id);
          const panelId = `audit-entry-${entry.id}`;
          const hasBody = Boolean(entry.actorName) || entry.details.length > 0 || Boolean(entry.feedback);
          const isSystemEntry = entry.actorName.trim().toLowerCase() === "system";
          const primaryTextClass = isSystemEntry ? "text-subtle" : "text-[var(--ink)]";
          const secondaryTextClass = isSystemEntry ? "text-[var(--ink-soft)]" : "text-subtle";

          return (
            <li
              key={entry.id}
              className={`overflow-hidden rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] text-sm ${primaryTextClass}`}
            >
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-[var(--canvas-2)]"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggleEntry(entry.id)}
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 flex-none text-[var(--ink-muted)] transition-transform ${
                    isOpen ? "rotate-90" : ""
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0">
                      <span className={`block font-semibold ${primaryTextClass}`}>{entry.actionLabel}</span>
                      <span className={`mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-normal ${secondaryTextClass}`}>
                        <span className={isSystemEntry ? "text-subtle" : "text-[var(--ink-muted)]"}>{entry.actorName}</span>
                        {entry.contextLabel ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="min-w-0 truncate">
                              {entry.contextTypeLabel ? `${entry.contextTypeLabel}: ` : ""}
                              {entry.contextLabel}
                            </span>
                          </>
                        ) : null}
                        </span>
                    </span>
                    <time dateTime={entry.createdAtIso ?? undefined} className="text-xs text-subtle">
                      {entry.timestampLabel}
                    </time>
                  </span>
                </span>
              </button>

              {isOpen ? (
                <div id={panelId} className="border-t border-[var(--hair)] px-4 pb-4 pl-9 pt-3">
                  {entry.actorName || entry.details.length > 0 ? (
                    <ul className="space-y-1 text-xs">
                      {entry.actorName ? (
                        <li className="flex items-start gap-2">
                          <span
                            className={`mt-[0.35rem] h-1.5 w-1.5 flex-none rounded-full ${
                              isSystemEntry ? "bg-[var(--ink-muted)]" : "bg-[var(--slate)]"
                            }`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 break-words">
                            <span className={`font-semibold ${primaryTextClass}`}>By:</span>{" "}
                            <span>{entry.actorName}</span>
                          </span>
                        </li>
                      ) : null}
                      {entry.details.map((detail, index) => (
                        <li key={`${entry.id}-${detail.label}-${index}`} className="flex items-start gap-2">
                          <span
                            className="mt-[0.35rem] h-1.5 w-1.5 flex-none rounded-full bg-[var(--slate)]"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 break-words">
                            <span className="font-semibold text-[var(--ink)]">{detail.label}:</span>{" "}
                            <span>{detail.value}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {entry.feedback ? (
                    <p className="mt-3 rounded-[var(--radius)] bg-[var(--paper-tint)] p-3 text-sm leading-relaxed text-[var(--ink)]">
                      {entry.feedback}
                    </p>
                  ) : null}
                  {!hasBody ? (
                    <p className="text-xs text-subtle">No additional details.</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
