"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { upsertMultiVenueOpeningHoursAction } from "@/actions/opening-hours";
import type { Availability, ServiceTypeRow, OpeningHoursRow, UpsertHoursInput } from "@/lib/opening-hours";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// 0 = Monday … 6 = Sunday (ISO week, UK convention)
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type CellState = {
  open_time: string;
  close_time: string;
  availability: Availability;
};

function rowAvailability(row: OpeningHoursRow): Availability {
  return row.availability ?? (row.is_closed ? "closed" : "open");
}

type ServiceState = {
  has_service: boolean;
  days: Record<number, CellState>;
};

type GridState = Record<string, ServiceState>;

function normaliseTimeForInput(value: string | null): string {
  if (!value) return "";
  const match = value.match(/^(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  return match ? match[1] : value;
}

function buildInitialState(
  serviceTypes: ServiceTypeRow[],
  openingHours: OpeningHoursRow[]
): GridState {
  const state: GridState = {};
  const offeredServiceIds = new Set(
    openingHours
      .filter((row) => {
        const openTime = normaliseTimeForInput(row.open_time);
        const closeTime = normaliseTimeForInput(row.close_time);
        return rowAvailability(row) === "open" && openTime && closeTime;
      })
      .map((row) => row.service_type_id)
  );

  serviceTypes.forEach((st) => {
    state[st.id] = {
      has_service: offeredServiceIds.has(st.id),
      days: {}
    };
    for (let day = 0; day < 7; day++) {
      state[st.id].days[day] = { open_time: "", close_time: "", availability: "closed" };
    }
  });

  openingHours.forEach((row) => {
    if (state[row.service_type_id] && row.day_of_week >= 0 && row.day_of_week < 7) {
      const openTime = normaliseTimeForInput(row.open_time);
      const closeTime = normaliseTimeForInput(row.close_time);
      const stored = rowAvailability(row);
      const availability: Availability =
        stored === "open" && (!openTime || !closeTime) ? "closed" : stored;
      state[row.service_type_id].days[row.day_of_week] = {
        open_time: openTime,
        close_time: closeTime,
        availability
      };
    }
  });

  return state;
}

type VenueOption = { id: string; name: string };

type WeeklyHoursGridProps = {
  venues: VenueOption[];
  serviceTypes: ServiceTypeRow[];
  openingHours: OpeningHoursRow[];
  canEdit: boolean;
};

export function WeeklyHoursGrid({
  venues,
  serviceTypes,
  openingHours,
  canEdit
}: WeeklyHoursGridProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [grid, setGrid] = useState<GridState>(() => buildInitialState(serviceTypes, openingHours));
  const [includedServiceTypeIds, setIncludedServiceTypeIds] = useState<Set<string>>(
    () => new Set(serviceTypes.map((serviceType) => serviceType.id))
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  const venueIds = venues.map((v) => v.id);

  const updateCell = useCallback(
    (serviceTypeId: string, day: number, updates: Partial<CellState>) => {
      setGrid((prev) => ({
        ...prev,
        [serviceTypeId]: {
          ...prev[serviceTypeId],
          days: {
            ...prev[serviceTypeId].days,
            [day]: { ...prev[serviceTypeId].days[day], ...updates }
          }
        }
      }));
    },
    []
  );

  const updateServiceAvailability = useCallback((serviceTypeId: string, hasService: boolean) => {
    setGrid((prev) => ({
      ...prev,
      [serviceTypeId]: {
        ...prev[serviceTypeId],
        has_service: hasService
      }
    }));
  }, []);

  const updateServiceIncluded = useCallback((serviceTypeId: string, included: boolean) => {
    setIncludedServiceTypeIds((prev) => {
      const next = new Set(prev);
      if (included) {
        next.add(serviceTypeId);
      } else {
        next.delete(serviceTypeId);
      }
      return next;
    });
  }, []);

  function handleSaveClick() {
    if (includedServiceTypeIds.size === 0) {
      toast.error("Select at least one service type to save.");
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirmedSave() {
    setConfirmOpen(false);

    const rows: UpsertHoursInput[] = [];
    Object.entries(grid).forEach(([serviceTypeId, service]) => {
      Object.entries(service.days).forEach(([dayStr, cell]) => {
        // Without service for this venue, force "closed". Empty time fields with
        // an "open" intent collapse to "closed". "Unavailable" is preserved.
        let availability: Availability = cell.availability;
        if (!service.has_service) availability = "closed";
        else if (availability === "open" && (!cell.open_time || !cell.close_time)) availability = "closed";
        const isOpen = availability === "open";
        rows.push({
          service_type_id: serviceTypeId,
          day_of_week: parseInt(dayStr, 10),
          open_time: isOpen ? cell.open_time : null,
          close_time: isOpen ? cell.close_time : null,
          availability,
          has_service: service.has_service
        });
      });
    });

    startTransition(async () => {
      const serviceTypeIds = serviceTypes
        .filter((serviceType) => includedServiceTypeIds.has(serviceType.id))
        .map((serviceType) => serviceType.id);
      const result = await upsertMultiVenueOpeningHoursAction(venueIds, rows, serviceTypeIds);
      if (result.success) {
        toast.success(result.message ?? "Opening hours saved.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not save opening hours.");
      }
    });
  }

  const includedServiceTypes = serviceTypes.filter((serviceType) => includedServiceTypeIds.has(serviceType.id));
  const confirmDescription = buildConfirmDescription(venues, includedServiceTypes.map((serviceType) => serviceType.name));

  return (
    <div className="space-y-4">
      <div className="space-y-2 md:hidden">
        {DAYS.map((day, dayIndex) => (
          <details key={day} className="mobile-card" open={dayIndex === 0}>
            <summary className="flex cursor-pointer items-center justify-between text-base font-semibold text-[var(--ink)]">
              <span>{day}</span>
              <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink-soft)]">Edit day</span>
            </summary>
            <div className="mt-4 space-y-3">
              {serviceTypes.map((st) => {
                const service = grid[st.id];
                const cell = service?.days[dayIndex] ?? {
                  open_time: "",
                  close_time: "",
                  availability: "closed" as Availability
                };
                const hasService = service?.has_service ?? false;
                return (
                  <div key={st.id} className="rounded-[8px] border border-[var(--hair)] bg-[var(--canvas-2)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--ink)]">{st.name}</p>
                        <label className="mt-2 flex min-h-8 items-center gap-2 text-sm text-[var(--ink-muted)]">
                          <input
                            type="checkbox"
                            checked={includedServiceTypeIds.has(st.id)}
                            disabled={!canEdit}
                            onChange={(event) => updateServiceIncluded(st.id, event.target.checked)}
                            className="h-4 w-4"
                          />
                          Include in save
                        </label>
                      </div>
                      {canEdit ? (
                        <button
                          type="button"
                          className="rounded-full bg-[var(--paper)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)]"
                          onClick={() => {
                            updateServiceAvailability(st.id, !hasService);
                            if (!hasService) updateCell(st.id, dayIndex, { availability: "open" });
                          }}
                        >
                          {hasService ? "Remove" : "Add service"}
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-3">
                      <HoursCell
                        cell={cell}
                        hasService={hasService}
                        canEdit={canEdit}
                        onChange={(updates) => updateCell(st.id, dayIndex, updates)}
                      />
                    </div>
                    {canEdit && hasService ? (
                      <button
                        type="button"
                        className="mt-3 text-xs font-semibold text-[var(--burgundy)]"
                        onClick={() => updateCell(st.id, dayIndex, { availability: "closed", open_time: "", close_time: "" })}
                      >
                        Mark closed
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>

      <div className="data-table-shell hidden md:block">
        <table className="data-table min-w-full">
          <thead>
            <tr>
              <th className="w-32 border-b border-[var(--hair)] pb-2 pr-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-subtle">
                Service
              </th>
              {DAYS.map((day) => (
                <th
                  key={day}
                  className="min-w-[8rem] border-b border-[var(--hair)] pb-2 px-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-subtle"
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {serviceTypes.map((st) => (
              <tr key={st.id} className="border-b border-[var(--hair)] last:border-0">
                <td className="py-3 pr-3 text-sm font-semibold text-[var(--ink)]">
                  <div className="space-y-1">
                    <div>{st.name}</div>
                    <label className="flex items-center gap-1.5 text-xs font-normal text-subtle">
                      <input
                        type="checkbox"
                        checked={grid[st.id]?.has_service ?? false}
                        disabled={!canEdit}
                        onChange={(e) => updateServiceAvailability(st.id, e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      Has service
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-normal text-subtle">
                      <input
                        type="checkbox"
                        checked={includedServiceTypeIds.has(st.id)}
                        disabled={!canEdit}
                        onChange={(e) => updateServiceIncluded(st.id, e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      Include in save
                    </label>
                  </div>
                </td>
                {DAYS.map((_, dayIndex) => {
                  const service = grid[st.id];
                  const cell = service?.days[dayIndex] ?? {
                    open_time: "",
                    close_time: "",
                    availability: "closed" as Availability
                  };
                  return (
                    <td key={dayIndex} className="px-2 py-3">
                      <HoursCell
                        cell={cell}
                        hasService={service?.has_service ?? false}
                        canEdit={canEdit}
                        onChange={(updates) => updateCell(st.id, dayIndex, updates)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className="hidden items-center justify-end gap-3 md:flex">
          {venues.length > 1 && (
            <p className="text-xs text-subtle">
              Will apply to all {venues.length} selected venues
            </p>
          )}
          <Button
            type="button"
            variant="primary"
            disabled={isPending || includedServiceTypeIds.size === 0}
            onClick={handleSaveClick}
          >
            {isPending ? "Saving…" : "Save weekly hours"}
          </Button>
        </div>
      ) : null}

      {canEdit ? (
        <div className="mobile-actionbar md:hidden">
          <Button
            type="button"
            variant="primary"
            className="h-12 flex-1"
            disabled={isPending || includedServiceTypeIds.size === 0}
            onClick={handleSaveClick}
          >
            {isPending ? "Saving..." : "Save weekly hours"}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Overwrite weekly hours?"
        description={confirmDescription}
        confirmLabel="Yes, overwrite"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmedSave}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function buildConfirmDescription(venues: VenueOption[], serviceTypeNames: string[]): string {
  const serviceScope =
    serviceTypeNames.length === 1
      ? serviceTypeNames[0]
      : serviceTypeNames.length === 2
        ? `${serviceTypeNames[0]} and ${serviceTypeNames[1]}`
        : `${serviceTypeNames.slice(0, -1).join(", ")}, and ${serviceTypeNames[serviceTypeNames.length - 1]}`;

  if (venues.length === 1) {
    return `This will permanently overwrite the ${serviceScope} standard weekly hours for ${venues[0].name}. Other service types will be left unchanged. This cannot be undone.`;
  }

  const names = venues.map((v) => v.name);
  const listed =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

  return `This will permanently overwrite the ${serviceScope} standard weekly hours for ${venues.length} venues: ${listed}. Other service types at those venues will be left unchanged. This cannot be undone.`;
}

function HoursCell({
  cell,
  hasService,
  canEdit,
  onChange
}: {
  cell: CellState;
  hasService: boolean;
  canEdit: boolean;
  onChange: (updates: Partial<CellState>) => void;
}) {
  const groupName = useId();

  if (!hasService) {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--canvas-2)] px-2 py-1 text-xs text-subtle">
        Not offered
      </span>
    );
  }

  if (!canEdit) {
    if (cell.availability === "unavailable") {
      return <span className="text-xs text-subtle">—</span>;
    }
    if (cell.availability === "closed") {
      return (
        <span className="inline-flex items-center rounded-full bg-[var(--canvas-2)] px-2 py-1 text-xs text-subtle">
          Closed
        </span>
      );
    }
    if (!cell.open_time && !cell.close_time) {
      return <span className="text-xs text-subtle">—</span>;
    }
    return (
      <span className="text-xs text-[var(--ink)]">
        {cell.open_time || "?"} – {cell.close_time || "?"}
      </span>
    );
  }

  return (
    <div className="space-y-1.5">
      <fieldset className="space-y-0.5 text-xs text-subtle">
        <legend className="sr-only">Availability</legend>
        {(["open", "closed", "unavailable"] as const).map((option) => (
          <label key={option} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={groupName}
              checked={cell.availability === option}
              onChange={() => onChange({ availability: option })}
              className="h-3 w-3"
            />
            <span className="capitalize">{option}</span>
          </label>
        ))}
      </fieldset>
      {cell.availability === "open" ? (
        <>
          <input
            type="time"
            value={cell.open_time}
            onChange={(e) => onChange({ open_time: e.target.value })}
            placeholder="Open"
            aria-label="Opening time"
            className="block h-11 w-full rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--paper)] px-2 py-1 text-[16px] focus:outline-none focus:ring-1 focus:ring-[var(--slate)] md:h-auto md:text-xs"
          />
          <input
            type="time"
            value={cell.close_time}
            onChange={(e) => onChange({ close_time: e.target.value })}
            placeholder="Close"
            aria-label="Closing time"
            className="block h-11 w-full rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--paper)] px-2 py-1 text-[16px] focus:outline-none focus:ring-1 focus:ring-[var(--slate)] md:h-auto md:text-xs"
          />
        </>
      ) : null}
    </div>
  );
}
