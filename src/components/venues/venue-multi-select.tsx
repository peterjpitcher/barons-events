"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export type VenueOption = {
  id: string;
  name: string;
  category: "pub" | "cafe";
};

type VenueMultiSelectProps = {
  venues: VenueOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** HTML `name` for hidden inputs that carry the selection into a form action. Optional. */
  hiddenFieldName?: string;
};

/**
 * Reusable multi-select for venues with quick-select buttons and a category-
 * grouped checkbox list.
 *
 * - Categories grouped into "Pubs" and "Cafes".
 * - Quick actions: Select all, Select all pubs, Clear.
 * - Accessibility: each checkbox has a visible label; category headings use
 *   <h5> to preserve heading hierarchy.
 * - Colour-independent: quick-action counts and the "Selected N" summary use
 *   text, not colour.
 * - Optional hidden-input rendering (via `hiddenFieldName`) makes this usable
 *   inside native HTML forms using server actions.
 */
export function VenueMultiSelect({
  venues,
  selectedIds,
  onChange,
  disabled = false,
  hiddenFieldName
}: VenueMultiSelectProps) {
  const { pubs, cafes } = useMemo(() => {
    const sorted = [...venues].sort((a, b) => a.name.localeCompare(b.name));
    return {
      pubs: sorted.filter((v) => v.category === "pub"),
      cafes: sorted.filter((v) => v.category === "cafe")
    };
  }, [venues]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggle(id: string) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  function selectAll() {
    if (disabled) return;
    onChange(venues.map((v) => v.id));
  }

  function selectAllPubs() {
    if (disabled) return;
    onChange(pubs.map((v) => v.id));
  }

  function clear() {
    if (disabled) return;
    onChange([]);
  }

  function renderGroup(heading: string, group: VenueOption[]) {
    if (group.length === 0) return null;
    return (
      <div className="space-y-1">
        <h5 className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">
          {heading} ({group.length})
        </h5>
        <ul className="space-y-1">
          {group.map((venue) => {
            const isSelected = selected.has(venue.id);
            return (
              <li key={venue.id}>
                <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-ring)]">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={isSelected}
                    disabled={disabled}
                    onChange={() => toggle(venue.id)}
                  />
                  <span className="flex-1">{venue.name}</span>
                  {isSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={selectAll} disabled={disabled || venues.length === 0}>
          Select all ({venues.length})
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={selectAllPubs}
          disabled={disabled || pubs.length === 0}
        >
          Select all pubs ({pubs.length})
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={disabled || selected.size === 0}>
          Clear
        </Button>
        <span className="ml-auto text-xs text-subtle">Selected {selected.size}</span>
      </div>

      <div className="space-y-3">
        {renderGroup("Pubs", pubs)}
        {renderGroup("Cafes", cafes)}
        {venues.length === 0 ? (
          <p className="text-sm text-subtle">No venues configured.</p>
        ) : null}
      </div>

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
