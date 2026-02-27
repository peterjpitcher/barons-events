"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  createOpeningOverrideAction,
  updateOpeningOverrideAction,
  deleteOpeningOverrideAction
} from "@/actions/opening-hours";
import type { ServiceTypeRow, OpeningOverrideRow } from "@/lib/opening-hours";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type VenueOption = { id: string; name: string };

type OverridesCalendarProps = {
  venueId: string;
  venues: VenueOption[];
  serviceTypes: ServiceTypeRow[];
  overrides: OpeningOverrideRow[];
  onOverridesChange: (overrides: OpeningOverrideRow[]) => void;
  canEdit: boolean;
  /** Pre-selected venue IDs to tick by default when opening the Add override form */
  defaultSelectedVenueIds?: Set<string>;
};

function startOfIsoWeek(date: Date): Date {
  const day = date.getDay(); // 0=Sun … 6=Sat
  const diff = (day + 6) % 7; // shift so Mon=0
  const monday = new Date(date);
  monday.setDate(date.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function isoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, n: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + n);
  return next;
}

function formatDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatTime(t: string | null): string {
  if (!t) return "?";
  return t.slice(0, 5);
}

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function OverridesCalendar({
  venueId,
  venues,
  serviceTypes,
  overrides,
  onOverridesChange,
  canEdit,
  defaultSelectedVenueIds
}: OverridesCalendarProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [monthCursor, setMonthCursor] = useState<Date>(() => {
    const d = new Date(today);
    d.setDate(1);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingOverride, setEditingOverride] = useState<OpeningOverrideRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const overridesByDate = useMemo(() => {
    const map = new Map<string, OpeningOverrideRow[]>();
    overrides.forEach((ov) => {
      const bucket = map.get(ov.override_date) ?? [];
      bucket.push(ov);
      map.set(ov.override_date, bucket);
    });
    return map;
  }, [overrides]);

  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    const lastOfMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
    const start = startOfIsoWeek(firstOfMonth);
    const endBase = startOfIsoWeek(lastOfMonth);
    const end = addDays(endBase, 6);
    const days: Date[] = [];
    let cursor = start;
    while (cursor <= end) {
      days.push(new Date(cursor));
      cursor = addDays(cursor, 1);
    }
    return days;
  }, [monthCursor]);

  const monthLabel = monthCursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const todayKey = isoDateKey(today);
  const selectedDateOverrides = selectedDate ? (overridesByDate.get(selectedDate) ?? []) : [];
  const serviceName = (id: string) =>
    serviceTypes.find((st) => st.id === id)?.name ?? "Unknown";

  function openCreateForm(date: string) {
    setSelectedDate(date);
    setEditingOverride(null);
    setShowForm(true);
  }

  function openEditForm(ov: OpeningOverrideRow) {
    setEditingOverride(ov);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingOverride(null);
  }

  function handleDelete(ov: OpeningOverrideRow) {
    if (!window.confirm("Remove this override?")) return;
    startTransition(async () => {
      const result = await deleteOpeningOverrideAction(ov.id);
      if (result.success) {
        toast.success(result.message ?? "Override removed.");
        onOverridesChange(overrides.filter((o) => o.id !== ov.id));
      } else {
        toast.error(result.message ?? "Could not remove override.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
        </Button>
        <span className="text-sm font-semibold text-[var(--color-text)]">{monthLabel}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setMonthCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
        >
          Today
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
        >
          Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {/* Calendar grid */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white overflow-hidden">
        <div className="grid grid-cols-7 border-b border-[var(--color-border)] bg-[var(--color-muted-surface)] text-center text-xs font-semibold uppercase tracking-[0.1em] text-subtle">
          {DAYS_SHORT.map((d) => (
            <div key={d} className="px-2 py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-[var(--color-border)]">
          {calendarDays.map((day) => {
            const key = isoDateKey(day);
            const isCurrentMonth = day.getMonth() === monthCursor.getMonth();
            const isToday = key === todayKey;
            const isSelected = key === selectedDate;
            const dayOverrides = overridesByDate.get(key) ?? [];
            const hasOverrides = dayOverrides.length > 0;

            return (
              <div
                key={key}
                className={`min-h-[5rem] cursor-pointer bg-white p-1.5 transition-colors hover:bg-[var(--color-muted-surface)] ${
                  isSelected ? "ring-2 ring-inset ring-[var(--color-primary-500)]" : ""
                }`}
                onClick={() => setSelectedDate(key === selectedDate ? null : key)}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                      isToday
                        ? "bg-[var(--color-primary-700)] text-white"
                        : isCurrentMonth
                          ? "text-[var(--color-text)]"
                          : "text-subtle"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openCreateForm(key);
                      }}
                      className="rounded p-0.5 text-subtle opacity-0 transition-opacity hover:text-[var(--color-primary-700)] group-hover:opacity-100 focus:opacity-100"
                      aria-label={`Add override for ${key}`}
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                {hasOverrides ? (
                  <div className="mt-1 space-y-0.5">
                    {dayOverrides.slice(0, 3).map((ov) => (
                      <div
                        key={ov.id}
                        className={`truncate rounded px-1 py-0.5 text-[0.65rem] font-medium ${
                          ov.is_closed
                            ? "bg-[var(--color-danger)] bg-opacity-15 text-[var(--color-danger)]"
                            : "bg-[var(--color-primary-100)] text-[var(--color-primary-700)]"
                        }`}
                      >
                        {serviceName(ov.service_type_id)}
                        {ov.is_closed ? " · Closed" : ` · ${formatTime(ov.open_time)}–${formatTime(ov.close_time)}`}
                      </div>
                    ))}
                    {dayOverrides.length > 3 ? (
                      <div className="text-[0.6rem] text-subtle">+{dayOverrides.length - 3} more</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDate ? (
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-[var(--color-text)]">
              Overrides for {formatDisplayDate(selectedDate)}
            </p>
            <div className="flex items-center gap-2">
              {canEdit ? (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => openCreateForm(selectedDate)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Add override
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelectedDate(null)}
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          {selectedDateOverrides.length === 0 ? (
            <p className="text-sm text-subtle">No overrides on this date.</p>
          ) : (
            <ul className="space-y-2">
              {selectedDateOverrides.map((ov) => (
                <li
                  key={ov.id}
                  className="flex items-start justify-between gap-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm"
                >
                  <div className="space-y-0.5">
                    <p className="font-medium text-[var(--color-text)]">
                      {serviceName(ov.service_type_id)}
                    </p>
                    <p className="text-xs text-subtle">
                      {ov.is_closed
                        ? "Closed"
                        : `${formatTime(ov.open_time)} – ${formatTime(ov.close_time)}`}
                      {ov.note ? ` · ${ov.note}` : ""}
                    </p>
                    <p className="text-xs text-subtle">
                      Applies to: {ov.venue_ids.length === 0
                        ? "no venues"
                        : ov.venue_ids.length === venues.length
                          ? "all venues"
                          : `${ov.venue_ids.length} venue${ov.venue_ids.length === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => openEditForm(ov)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => handleDelete(ov)}
                        aria-label="Delete override"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* Override form modal */}
      {showForm ? (
        <OverrideFormModal
          initialDate={selectedDate ?? ""}
          editingOverride={editingOverride}
          venues={venues}
          serviceTypes={serviceTypes}
          defaultVenueId={venueId}
          defaultSelectedVenueIds={defaultSelectedVenueIds}
          onClose={closeForm}
          onSaved={(newOrUpdated) => {
            if (editingOverride) {
              onOverridesChange(
                overrides.map((o) => (o.id === newOrUpdated.id ? newOrUpdated : o))
              );
            } else {
              onOverridesChange([...overrides, newOrUpdated]);
            }
            closeForm();
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Override Form Modal ──────────────────────────────────────────────────────

type OverrideFormModalProps = {
  initialDate: string;
  editingOverride: OpeningOverrideRow | null;
  venues: VenueOption[];
  serviceTypes: ServiceTypeRow[];
  defaultVenueId: string;
  defaultSelectedVenueIds?: Set<string>;
  onClose: () => void;
  onSaved: (ov: OpeningOverrideRow) => void;
};

function OverrideFormModal({
  initialDate,
  editingOverride,
  venues,
  serviceTypes,
  defaultVenueId,
  defaultSelectedVenueIds,
  onClose,
  onSaved
}: OverrideFormModalProps) {
  const isEditing = Boolean(editingOverride);
  const [isPending, startTransition] = useTransition();

  const [date, setDate] = useState(editingOverride?.override_date ?? initialDate);
  const [serviceTypeId, setServiceTypeId] = useState(
    editingOverride?.service_type_id ?? (serviceTypes[0]?.id ?? "")
  );
  const [isClosed, setIsClosed] = useState(editingOverride?.is_closed ?? false);
  const [openTime, setOpenTime] = useState(editingOverride?.open_time ?? "");
  const [closeTime, setCloseTime] = useState(editingOverride?.close_time ?? "");
  const [note, setNote] = useState(editingOverride?.note ?? "");
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>(
    editingOverride?.venue_ids ??
      (defaultSelectedVenueIds ? Array.from(defaultSelectedVenueIds) : [defaultVenueId])
  );
  const [error, setError] = useState<string | null>(null);

  function toggleVenue(venueId: string) {
    setSelectedVenueIds((prev) =>
      prev.includes(venueId) ? prev.filter((id) => id !== venueId) : [...prev, venueId]
    );
  }

  function handleSubmit() {
    if (!date || !serviceTypeId) {
      setError("Date and service type are required.");
      return;
    }
    if (selectedVenueIds.length === 0) {
      setError("Select at least one venue.");
      return;
    }
    setError(null);

    const payload = {
      override_date: date,
      service_type_id: serviceTypeId,
      open_time: isClosed ? null : (openTime || null),
      close_time: isClosed ? null : (closeTime || null),
      is_closed: isClosed,
      note: note.trim() || null,
      venue_ids: selectedVenueIds
    };

    startTransition(async () => {
      let result;
      if (isEditing && editingOverride) {
        result = await updateOpeningOverrideAction(editingOverride.id, payload);
      } else {
        result = await createOpeningOverrideAction(payload);
      }

      if (result.success) {
        toast.success(result.message ?? (isEditing ? "Override updated." : "Override added."));
        // Build a local copy for optimistic update
        const saved: OpeningOverrideRow = {
          id: editingOverride?.id ?? crypto.randomUUID(),
          override_date: payload.override_date,
          service_type_id: payload.service_type_id,
          open_time: payload.open_time ?? null,
          close_time: payload.close_time ?? null,
          is_closed: payload.is_closed,
          note: payload.note ?? null,
          created_by: editingOverride?.created_by ?? null,
          created_at: editingOverride?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
          venue_ids: payload.venue_ids
        };
        onSaved(saved);
      } else {
        toast.error(result.message ?? "Could not save override.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="font-semibold text-[var(--color-text)]">
            {isEditing ? "Edit override" : "Add opening time override"}
          </h2>
          <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {error ? (
            <p className="rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="override-date">Date</Label>
            <Input
              id="override-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="override-service-type">Service type</Label>
            <Select
              id="override-service-type"
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
            >
              {serviceTypes.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={isClosed}
              onChange={(e) => setIsClosed(e.target.checked)}
              className="h-4 w-4"
            />
            Fully closed on this date
          </label>

          {!isClosed ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="override-open">Opens at</Label>
                <Input
                  id="override-open"
                  type="time"
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="override-close">Closes at</Label>
                <Input
                  id="override-close"
                  type="time"
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="override-note">Note (optional)</Label>
            <Input
              id="override-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Bank holiday, private event"
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label>Apply to venues</Label>
            <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
              {venues.map((venue) => (
                <label key={venue.id} className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                  <input
                    type="checkbox"
                    checked={selectedVenueIds.includes(venue.id)}
                    onChange={() => toggleVenue(venue.id)}
                    className="h-4 w-4"
                  />
                  {venue.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-subtle">
              Tick all venues this override applies to — you can apply one change to multiple venues at once.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--color-border)] px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={isPending} onClick={handleSubmit}>
            {isPending ? "Saving…" : isEditing ? "Update override" : "Add override"}
          </Button>
        </div>
      </div>
    </div>
  );
}
