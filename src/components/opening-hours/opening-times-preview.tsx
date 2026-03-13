"use client";

import { useState } from "react";
import { resolveOpeningTimes } from "@/lib/opening-hours-resolver";
import type { ResolvedVenueHours } from "@/lib/opening-hours-resolver";
// Input types are imported as type-only — erased at compile time, safe in client components.
import type { ServiceTypeRow, OpeningHoursRow, OpeningOverrideRow } from "@/lib/opening-hours";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type VenueOption = { id: string; name: string };

type OpeningTimesPreviewProps = {
  venues: VenueOption[];
  serviceTypes: ServiceTypeRow[];
  allHours: OpeningHoursRow[];
  overrides: OpeningOverrideRow[];
};

/** Returns today's date as YYYY-MM-DD in the Europe/London timezone. */
function getTodayLondon(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
  }).format(new Date());
}

/** Formats a YYYY-MM-DD date as "Fri 14 Mar" for display. */
function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const DAY_OPTIONS: { value: 7 | 30 | 90; label: string }[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

export function OpeningTimesPreview({
  venues,
  serviceTypes,
  allHours,
  overrides,
}: OpeningTimesPreviewProps) {
  const [selectedVenueId, setSelectedVenueId] = useState<string>(
    venues[0]?.id ?? ""
  );
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [result, setResult] = useState<ResolvedVenueHours | null>(null);
  const [hasQueried, setHasQueried] = useState(false);

  function handlePreview() {
    if (!selectedVenueId) return;

    const from = getTodayLondon();
    const resolved = resolveOpeningTimes({
      serviceTypes,
      weeklyHours: allHours,
      overrides,
      venues: venues.filter((v) => v.id === selectedVenueId),
      from,
      days,
    });

    // We pass a single-venue array so resolved.venues always has exactly one entry.
    setResult(resolved.venues[0] ?? null);
    setHasQueried(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview resolved times</CardTitle>
        <CardDescription>
          See the effective opening schedule for a venue over a date range —
          combines the standard weekly hours with any date-specific overrides.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-medium text-subtle"
              htmlFor="preview-venue"
            >
              Venue
            </label>
            <Select
              id="preview-venue"
              value={selectedVenueId}
              onChange={(e) => setSelectedVenueId(e.target.value)}
              className="w-48"
            >
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-subtle">Time window</span>
            <div className="flex overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
              {DAY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDays(opt.value)}
                  className={`border-r px-3 py-2 text-sm font-medium transition-colors last:border-r-0 border-[var(--color-border)] ${
                    days === opt.value
                      ? "bg-[var(--color-primary-700)] text-white"
                      : "bg-white text-[var(--color-text)] hover:bg-[var(--color-muted-surface)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            variant="primary"
            disabled={!selectedVenueId}
            onClick={handlePreview}
          >
            Preview
          </Button>
        </div>

        {/* Output */}
        {!hasQueried && (
          <p className="text-sm text-subtle">
            Select a venue and time window, then click Preview.
          </p>
        )}

        {hasQueried && result && result.days.length === 0 && (
          <p className="text-sm text-subtle">
            No opening hours are configured for this venue for the selected period.
          </p>
        )}

        {hasQueried && result && result.days.length > 0 && (
          <ResultsTable result={result} serviceTypes={serviceTypes} />
        )}
      </CardContent>
    </Card>
  );
}

function ResultsTable({
  result,
  serviceTypes,
}: {
  result: ResolvedVenueHours;
  serviceTypes: ServiceTypeRow[];
}) {
  // Only show columns for service types that appear at least once in the results.
  // serviceTypes is already ordered by display_order then name.
  const presentServiceTypeIds = new Set(
    result.days.flatMap((d) => d.services.map((s) => s.serviceTypeId))
  );
  const columns = serviceTypes.filter((st) => presentServiceTypeIds.has(st.id));

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-28 border-b border-[var(--color-border)] pb-2 pr-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-subtle">
              Date
            </th>
            {columns.map((col) => (
              <th
                key={col.id}
                className="min-w-[8rem] border-b border-[var(--color-border)] pb-2 px-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-subtle"
              >
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.days.map((day) => (
            <tr
              key={day.date}
              className="border-b border-[var(--color-border)] last:border-0"
            >
              <td className="py-2.5 pr-3 text-sm text-[var(--color-text)]">
                {formatDateLabel(day.date)}
              </td>
              {columns.map((col) => {
                const svc =
                  day.services.find((s) => s.serviceTypeId === col.id) ?? null;
                return (
                  <td key={col.id} className="px-2 py-2.5 text-center">
                    <ServiceCell service={svc} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServiceCell({
  service,
}: {
  service: {
    isOpen: boolean;
    openTime: string | null;
    closeTime: string | null;
    isOverride: boolean;
  } | null;
}) {
  if (!service) {
    return <span className="text-xs text-subtle">—</span>;
  }

  if (!service.isOpen) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-muted-surface)] px-2 py-1 text-xs text-subtle">
        {service.isOverride && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-primary-500)]"
            title="Date-specific override"
          />
        )}
        Closed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text)]">
      {service.isOverride && (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-primary-500)]"
          title="Date-specific override"
        />
      )}
      {service.openTime || "?"} – {service.closeTime || "?"}
    </span>
  );
}
