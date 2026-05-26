"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe2, MapPin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  /** Label shown for an empty valid selection. */
  emptyLabel?: string;
  /** Helper copy for an empty valid selection. */
  emptyDescription?: string;
  /** Label shown before a required selection is made. */
  placeholder?: string;
  /** Marks the primary venue when the first selected venue drives downstream fields. */
  primaryVenueId?: string;
};

export function VenueMultiSelect({
  venues,
  selectedIds,
  onChange,
  disabled = false,
  hiddenFieldName,
  defaultExpanded,
  allowEmpty = true,
  emptyLabel = "Global",
  emptyDescription = "Applies across the whole business, not a specific venue.",
  placeholder = "Choose venues",
  primaryVenueId
}: VenueMultiSelectProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState<boolean>(() =>
    typeof defaultExpanded === "boolean" ? defaultExpanded : false
  );
  const [query, setQuery] = useState("");

  const sortedVenues = useMemo(
    () => [...venues].sort((a, b) => a.name.localeCompare(b.name)),
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

  const filteredVenues = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortedVenues.filter((venue) =>
      needle ? venue.name.toLowerCase().includes(needle) : true
    );
  }, [query, sortedVenues]);

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

  function remove(id: string) {
    if (disabled) return;
    emit(selectedIds.filter((selectedId) => selectedId !== id));
  }

  function clearSelection() {
    if (disabled) return;
    emit([]);
  }

  const summary = useMemo(() => {
    if (selectedVenues.length === 0) return allowEmpty ? emptyLabel : placeholder;
    if (selectedVenues.length === 1) return selectedVenues[0].name;
    return `${selectedVenues.length} venues selected`;
  }, [allowEmpty, emptyLabel, placeholder, selectedVenues]);

  const primaryId = primaryVenueId ?? selectedIds[0];
  const visibleChips = selectedVenues.slice(0, 5);
  const hiddenChipCount = Math.max(0, selectedVenues.length - visibleChips.length);
  const noMatches = venues.length > 0 && filteredVenues.length === 0;

  return (
    <div ref={rootRef} className="relative space-y-2">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={disabled}
        aria-haspopup="listbox"
        className={cn(
          "flex min-h-10 w-full items-center gap-2 rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-left text-sm transition hover:bg-[var(--paper-tint)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard)]",
          isOpen && "border-[var(--mustard)] ring-2 ring-[var(--mustard-tint)]",
          disabled && "cursor-not-allowed bg-[var(--canvas-2)] opacity-70"
        )}
      >
        {selectedVenues.length === 0 && allowEmpty ? (
          <Globe2 className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" aria-hidden="true" />
        ) : (
          <MapPin className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", selectedVenues.length === 0 && !allowEmpty ? "text-[var(--ink-soft)]" : "text-[var(--ink)]")}>
            {summary}
          </span>
          <span className="mt-0.5 block truncate text-xs text-subtle">
            {selectedVenues.length === 0
              ? allowEmpty ? emptyDescription : "Search and select one or more venues."
              : selectedVenues.length === venues.length ? "Every configured venue is selected." : "Open picker to adjust selection."}
          </span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-[var(--ink-soft)] transition-transform", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {selectedVenues.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {visibleChips.map((venue) => (
            <span
              key={venue.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--hair)] bg-[var(--paper-tint)] px-2 py-1 text-xs text-[var(--ink)]"
            >
              <span className="truncate">{venue.name}</span>
              {venue.id === primaryId ? (
                <span className="font-brand-mono text-[0.55rem] uppercase tracking-[0.06em] text-[var(--ink-soft)]">Host</span>
              ) : null}
              <button
                type="button"
                className="rounded-full p-0.5 text-[var(--ink-soft)] hover:bg-[var(--canvas-2)] hover:text-[var(--ink)]"
                onClick={() => remove(venue.id)}
                disabled={disabled}
                aria-label={`Remove ${venue.name}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {hiddenChipCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-[var(--hair)] bg-[var(--paper)] px-2 py-1 text-xs text-subtle">
              +{hiddenChipCount} more
            </span>
          ) : null}
        </div>
      ) : null}

      {isOpen ? (
        <div
          id={panelId}
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-[10px] border border-[var(--hair)] bg-[var(--paper)] shadow-card"
        >
          <div className="border-b border-[var(--hair)] p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-soft)]" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search venues"
                className="h-8 w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] pl-8 pr-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)] focus:border-[var(--mustard)] focus:ring-2 focus:ring-[var(--mustard-tint)]"
                disabled={disabled}
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto p-2.5">
            {allowEmpty && selectedIds.length === 0 ? (
              <div className="mb-2 rounded-[8px] border border-dashed border-[var(--hair)] bg-[var(--paper-tint)] px-3 py-2 text-xs text-subtle">
                <span className="font-medium text-[var(--ink)]">{emptyLabel}</span> is currently active.
              </div>
            ) : null}
            {filteredVenues.length > 0 ? (
              <ul className="space-y-1" role="listbox" aria-multiselectable="true">
                {filteredVenues.map((venue) => {
                  const isSelected = selected.has(venue.id);
                  const isPrimary = isSelected && venue.id === primaryId;
                  return (
                    <li key={venue.id} role="option" aria-selected={isSelected}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-[8px] border px-2.5 py-2 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--mustard)]",
                          isSelected
                            ? "border-[var(--mustard)] bg-[var(--mustard-tint)] text-[var(--ink)]"
                            : "border-[var(--hair)] bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--paper-tint)]",
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
                              : "border-[var(--hair-strong)] bg-white"
                          )}
                          aria-hidden="true"
                        >
                          {isSelected ? <Check className="h-3 w-3 text-[var(--ink-on-mustard)]" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{venue.name}</span>
                        {isPrimary ? (
                          <span className="rounded bg-[var(--paper)] px-1.5 py-0.5 font-brand-mono text-[0.58rem] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
                            Host
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {noMatches ? (
              <p className="rounded-[8px] border border-[var(--hair)] bg-[var(--paper-tint)] px-3 py-6 text-center text-sm text-subtle">
                No venues match that search.
              </p>
            ) : null}
            {venues.length === 0 ? (
              <p className="rounded-[8px] border border-[var(--hair)] bg-[var(--paper-tint)] px-3 py-6 text-center text-sm text-subtle">
                No venues configured.
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--hair)] bg-[var(--paper-tint)] px-2.5 py-2">
            <span className="font-brand-mono text-[0.63rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
              {selectedIds.length === 0 ? (allowEmpty ? emptyLabel : "None selected") : `${selectedIds.length} selected`}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                disabled={disabled || selectedIds.length === 0}
              >
                Clear
              </Button>
              <Button type="button" variant="subtle" size="sm" onClick={() => setIsOpen(false)}>
                Done
              </Button>
            </div>
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
