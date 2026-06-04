"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export type VenueOption = {
  id: string;
  name: string;
  category: "pub" | "cafe";
  isInternal?: boolean;
};

type VenueMultiSelectProps = {
  venues: VenueOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** HTML `name` for hidden inputs that carry the selection into a form action. Optional. */
  hiddenFieldName?: string;
  /** Initial open state. Defaults to collapsed so the picker behaves like a dropdown. */
  defaultExpanded?: boolean;
  /** Whether an empty selection is valid. Use for global planning items. */
  allowEmpty?: boolean;
  /** Optional global option. "empty" emits no venues; "all" emits every visible venue. */
  globalSelectionMode?: "empty" | "all" | false;
  /** Label shown for an empty valid selection. */
  emptyLabel?: string;
  /** Helper copy for an empty valid selection. */
  emptyDescription?: string;
  /** Label shown before a required selection is made. */
  placeholder?: string;
};

export function VenueMultiSelect({
  venues,
  selectedIds,
  onChange,
  disabled = false,
  hiddenFieldName,
  defaultExpanded,
  allowEmpty = true,
  globalSelectionMode,
  emptyLabel = "Global",
  emptyDescription = "Applies across the whole business, not a specific venue.",
  placeholder = "Choose venues"
}: VenueMultiSelectProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState<boolean>(() =>
    typeof defaultExpanded === "boolean" ? defaultExpanded : false
  );

  const sortedVenues = useMemo(
    () =>
      [...venues].sort((a, b) => {
        if (a.isInternal !== b.isInternal) return a.isInternal ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [venues]
  );
  const venueById = useMemo(
    () => new Map(sortedVenues.map((venue) => [venue.id, venue])),
    [sortedVenues]
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedVenues = useMemo(
    () => selectedIds.map((id) => venueById.get(id)).filter((venue): venue is VenueOption => Boolean(venue)),
    [selectedIds, venueById]
  );
  const allVenueIds = useMemo(() => sortedVenues.map((venue) => venue.id), [sortedVenues]);
  const globalMode = globalSelectionMode === undefined ? (allowEmpty ? "empty" : false) : globalSelectionMode;
  const allVenuesSelected =
    sortedVenues.length > 0 &&
    allVenueIds.every((id) => selected.has(id));
  const globalOptionActive =
    globalMode === "empty"
      ? selectedIds.length === 0
      : globalMode === "all"
        ? allVenuesSelected
        : false;

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  function emit(ids: string[]) {
    onChange(ids);
  }

  function toggle(id: string) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emit(Array.from(next));
  }

  function chooseGlobal() {
    if (disabled || !globalMode) return;
    emit(globalMode === "all" ? allVenueIds : []);
  }

  const summary = useMemo(() => {
    if (globalOptionActive) return emptyLabel;
    if (selectedVenues.length === 0) return allowEmpty ? emptyLabel : placeholder;
    if (selectedVenues.length === 1) return selectedVenues[0].name;
    return `${selectedVenues.length} venues selected`;
  }, [allowEmpty, emptyLabel, globalOptionActive, placeholder, selectedVenues]);

  const helperText =
    globalOptionActive
      ? emptyDescription
      : selectedVenues.length === 0
      ? allowEmpty ? emptyDescription : "Select one or more venues."
      : selectedVenues.length === venues.length ? "All venues selected." : "Click to change.";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={disabled}
        aria-haspopup="listbox"
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-left text-sm transition hover:bg-[var(--paper-tint)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard)]",
          isOpen && "border-[var(--mustard)] ring-2 ring-[var(--mustard-tint)]",
          disabled && "cursor-not-allowed bg-[var(--canvas-2)] opacity-70"
        )}
      >
        {globalOptionActive || (selectedVenues.length === 0 && allowEmpty) ? (
          <Globe2 className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" aria-hidden="true" />
        ) : (
          <MapPin className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", selectedVenues.length === 0 && !allowEmpty ? "text-[var(--ink-soft)]" : "text-[var(--ink)]")}>
            {summary}
          </span>
          <span className="sr-only">{helperText}</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-[var(--ink-soft)] transition-transform", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div
          id={panelId}
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] shadow-card"
        >
          <div className="max-h-72 overflow-y-auto p-1.5">
            {globalMode ? (
              <button
                type="button"
                disabled={disabled || (globalMode === "all" && allVenueIds.length === 0)}
                onClick={chooseGlobal}
                className={cn(
                  "mb-1 flex w-full items-start gap-2 rounded-[7px] px-2.5 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard)]",
                  globalOptionActive ? "bg-[var(--mustard-tint)] text-[var(--ink)]" : "text-[var(--ink)] hover:bg-[var(--paper-tint)]",
                  disabled && "cursor-not-allowed opacity-60"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    globalOptionActive
                      ? "border-[var(--mustard)] bg-[var(--mustard)]"
                      : "border-[var(--hair-strong)] bg-white"
                  )}
                  aria-hidden="true"
                >
                  {globalOptionActive ? <Check className="h-3 w-3 text-[var(--ink-on-mustard)]" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Globe2 className="h-3.5 w-3.5 text-[var(--ink-soft)]" aria-hidden="true" />
                    {emptyLabel}
                  </span>
                  <span className="mt-0.5 block text-xs text-subtle">{emptyDescription}</span>
                </span>
              </button>
            ) : null}
            {sortedVenues.length > 0 ? (
              <ul className="space-y-1" role="listbox" aria-multiselectable="true">
                {sortedVenues.map((venue) => {
                  const isSelected = selected.has(venue.id);
                  return (
                    <li key={venue.id} role="option" aria-selected={isSelected}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-[7px] px-2.5 py-2 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--mustard)]",
                          venue.isInternal
                            ? "bg-[var(--navy)] text-white hover:bg-[var(--navy-700)]"
                            : "text-[var(--ink)] hover:bg-[var(--paper-tint)]",
                          isSelected && !venue.isInternal && "bg-[var(--mustard-tint)]",
                          disabled && "cursor-not-allowed opacity-60"
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={isSelected}
                          disabled={disabled}
                          onChange={() => toggle(venue.id)}
                        />
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            isSelected
                              ? "border-[var(--mustard)] bg-[var(--mustard)]"
                              : venue.isInternal
                                ? "border-white/70 bg-white/10"
                                : "border-[var(--hair-strong)] bg-white"
                          )}
                          aria-hidden="true"
                        >
                          {isSelected ? <Check className="h-3 w-3 text-[var(--ink-on-mustard)]" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{venue.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {venues.length === 0 ? (
              <p className="rounded-[7px] bg-[var(--paper-tint)] px-3 py-6 text-center text-sm text-subtle">
                No venues configured.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {hiddenFieldName ? (
        <>
          {selectedIds.map((id) => (
            <input key={id} type="hidden" name={hiddenFieldName} value={id} />
          ))}
        </>
      ) : null}
    </div>
  );
}
