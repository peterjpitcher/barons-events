"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { upsertVenueOpeningHoursAction } from "@/actions/opening-hours";
import type { ServiceTypeRow, OpeningHoursRow, UpsertHoursInput } from "@/lib/opening-hours";
import { Button } from "@/components/ui/button";

// 0 = Monday … 6 = Sunday (ISO week, UK convention)
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type CellState = {
  open_time: string;
  close_time: string;
  is_closed: boolean;
};

type GridState = Record<string, Record<number, CellState>>;

function buildInitialState(
  serviceTypes: ServiceTypeRow[],
  openingHours: OpeningHoursRow[]
): GridState {
  const state: GridState = {};

  serviceTypes.forEach((st) => {
    state[st.id] = {};
    for (let day = 0; day < 7; day++) {
      state[st.id][day] = { open_time: "", close_time: "", is_closed: false };
    }
  });

  openingHours.forEach((row) => {
    if (state[row.service_type_id] && row.day_of_week >= 0 && row.day_of_week < 7) {
      state[row.service_type_id][row.day_of_week] = {
        open_time: row.open_time ?? "",
        close_time: row.close_time ?? "",
        is_closed: row.is_closed
      };
    }
  });

  return state;
}

type WeeklyHoursGridProps = {
  venueId: string;
  serviceTypes: ServiceTypeRow[];
  openingHours: OpeningHoursRow[];
  canEdit: boolean;
};

export function WeeklyHoursGrid({
  venueId,
  serviceTypes,
  openingHours,
  canEdit
}: WeeklyHoursGridProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [grid, setGrid] = useState<GridState>(() => buildInitialState(serviceTypes, openingHours));

  const updateCell = useCallback(
    (serviceTypeId: string, day: number, updates: Partial<CellState>) => {
      setGrid((prev) => ({
        ...prev,
        [serviceTypeId]: {
          ...prev[serviceTypeId],
          [day]: { ...prev[serviceTypeId][day], ...updates }
        }
      }));
    },
    []
  );

  function handleSave() {
    const rows: UpsertHoursInput[] = [];
    Object.entries(grid).forEach(([serviceTypeId, days]) => {
      Object.entries(days).forEach(([dayStr, cell]) => {
        rows.push({
          service_type_id: serviceTypeId,
          day_of_week: parseInt(dayStr, 10),
          open_time: cell.is_closed ? null : (cell.open_time || null),
          close_time: cell.is_closed ? null : (cell.close_time || null),
          is_closed: cell.is_closed
        });
      });
    });

    const formData = new FormData();
    formData.set("venueId", venueId);
    formData.set("rows", JSON.stringify(rows));

    startTransition(async () => {
      const result = await upsertVenueOpeningHoursAction(undefined, formData);
      if (result.success) {
        toast.success(result.message ?? "Opening hours saved.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not save opening hours.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-32 border-b border-[var(--color-border)] pb-2 pr-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-subtle">
                Service
              </th>
              {DAYS.map((day) => (
                <th
                  key={day}
                  className="min-w-[8rem] border-b border-[var(--color-border)] pb-2 px-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-subtle"
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {serviceTypes.map((st) => (
              <tr key={st.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-3 pr-3 text-sm font-semibold text-[var(--color-text)]">
                  {st.name}
                </td>
                {DAYS.map((_, dayIndex) => {
                  const cell = grid[st.id]?.[dayIndex] ?? {
                    open_time: "",
                    close_time: "",
                    is_closed: false
                  };
                  return (
                    <td key={dayIndex} className="px-2 py-3">
                      <HoursCell
                        cell={cell}
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
        <div className="flex justify-end">
          <Button
            type="button"
            variant="primary"
            disabled={isPending}
            onClick={handleSave}
          >
            {isPending ? "Saving…" : "Save weekly hours"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function HoursCell({
  cell,
  canEdit,
  onChange
}: {
  cell: CellState;
  canEdit: boolean;
  onChange: (updates: Partial<CellState>) => void;
}) {
  if (!canEdit) {
    if (cell.is_closed) {
      return (
        <span className="inline-flex items-center rounded-full bg-[var(--color-muted-surface)] px-2 py-1 text-xs text-subtle">
          Closed
        </span>
      );
    }
    if (!cell.open_time && !cell.close_time) {
      return <span className="text-xs text-subtle">—</span>;
    }
    return (
      <span className="text-xs text-[var(--color-text)]">
        {cell.open_time || "?"} – {cell.close_time || "?"}
      </span>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs text-subtle">
        <input
          type="checkbox"
          checked={cell.is_closed}
          onChange={(e) => onChange({ is_closed: e.target.checked })}
          className="h-3.5 w-3.5"
        />
        Closed
      </label>
      {!cell.is_closed ? (
        <>
          <input
            type="time"
            value={cell.open_time}
            onChange={(e) => onChange({ open_time: e.target.value })}
            placeholder="Open"
            aria-label="Opening time"
            className="block w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
          />
          <input
            type="time"
            value={cell.close_time}
            onChange={(e) => onChange({ close_time: e.target.value })}
            placeholder="Close"
            aria-label="Closing time"
            className="block w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
          />
        </>
      ) : null}
    </div>
  );
}
