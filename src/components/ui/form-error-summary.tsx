"use client";

import { useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Plain-English names for keys a server action can return. */
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  typeLabel: "Planning type",
  description: "Description",
  targetDate: "Target date",
  venueId: "Venues",
  venueIds: "Venues",
  ownerId: "Owner",
  status: "Status",
  startAt: "Start",
  endAt: "End",
  startsOn: "Starts on",
  endsOn: "Ends on",
  recurrenceFrequency: "Repeats",
  recurrenceInterval: "Repeat every",
  recurrenceWeekdays: "Repeat on",
  recurrenceMonthday: "Day of month",
  sopNotRequiredTemplateIds: "SOP items marked N/A",
  taskTemplates: "Task templates"
};

type FormErrorSummaryProps = {
  id: string;
  errors: Record<string, string>;
  /** Keys already rendered beside their own input, so they are not repeated here. */
  handledKeys: readonly string[];
  className?: string;
};

/**
 * Shows any validation error that has no matching input on the form.
 *
 * Server actions key field errors by the full zod path, so an array failure
 * arrives as `sopNotRequiredTemplateIds.0` with an index that varies with the
 * user's selection. Without this component the form says "Check the highlighted
 * fields" and highlights nothing, which is exactly the dead end reported on
 * /planning/new. Matching is done on the segment before the first dot so an
 * indexed path is still recognised.
 *
 * The summary is announced and takes focus, and carries an icon plus text so it
 * never depends on colour alone.
 */
export function FormErrorSummary({ id, errors, handledKeys, className }: FormErrorSummaryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handled = new Set(handledKeys);
  const unmatched = Object.entries(errors).filter(([key]) => !handled.has(key.split(".")[0]));
  const unmatchedCount = unmatched.length;

  useEffect(() => {
    if (unmatchedCount > 0) {
      containerRef.current?.focus();
    }
  }, [unmatchedCount]);

  if (unmatchedCount === 0) return null;

  // Several array entries can fail at once and produce the same message; the
  // user only needs to be told once per field.
  const seen = new Set<string>();
  const lines = unmatched.flatMap(([key, message]) => {
    const field = key.split(".")[0];
    const label = FIELD_LABELS[field];
    const text = label ? `${label}: ${message}` : message;
    if (seen.has(text)) return [];
    seen.add(text);
    return [{ key, text }];
  });

  return (
    <div
      id={id}
      ref={containerRef}
      role="alert"
      tabIndex={-1}
      className={cn(
        "flex gap-2 rounded-[8px] border border-[var(--burgundy)] bg-[var(--paper)] p-3 text-sm text-[var(--ink)]",
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--burgundy)]" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-semibold">This could not be saved</p>
        <ul className="space-y-0.5">
          {lines.map((line) => (
            <li key={line.key}>{line.text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
