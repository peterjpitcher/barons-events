# Opening Hours UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confusing venue tabs from the weekly hours editor and add a client-side "Preview resolved times" card to the global opening hours page.

**Architecture:** Two independent changes to the global `/opening-hours` page. Change 1 is a pure subtraction — dead state and UI removed from the shell. Change 2 adds a new self-contained client component that calls the existing pure `resolveOpeningTimes()` function using already-loaded page data; no server action or network call needed.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS, Vitest. Key lib: `resolveOpeningTimes()` in `src/lib/opening-hours.ts`.

---

## Spec

`docs/superpowers/specs/2026-03-13-opening-hours-ux-improvements-design.md`

> **Note — spec divergence:** The spec references `getTodayIsoDate()` as an existing utility. This function does **not exist** in `src/lib/datetime.ts` or anywhere in the codebase. The plan instead uses `new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date())` inline, which produces the same `YYYY-MM-DD` result in the Europe/London timezone. Do not create a `getTodayIsoDate` helper — inline the one-liner as shown.

---

## Key Types (reference throughout)

From `src/lib/opening-hours.ts`:

```typescript
// resolveOpeningTimes() signature
resolveOpeningTimes(params: {
  serviceTypes: ServiceTypeRow[];
  weeklyHours: OpeningHoursRow[];
  overrides: OpeningOverrideRow[];
  venues: { id: string; name: string }[];
  from: string;   // YYYY-MM-DD start date (inclusive)
  days: number;   // number of days to cover
}): ResolvedOpeningTimes

type ResolvedOpeningTimes = {
  from: string;
  to: string;
  venues: ResolvedVenueHours[];
};

type ResolvedVenueHours = {
  venueId: string;
  venueName: string;
  days: ResolvedDay[];
};

type ResolvedDay = {
  date: string;       // YYYY-MM-DD
  dayOfWeek: string;  // "Monday" … "Sunday"
  services: ResolvedServiceHours[];
};

type ResolvedServiceHours = {
  serviceTypeId: string;
  serviceType: string;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  isOverride: boolean;  // true = from a date-specific override
  note: string | null;
};
```

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/components/opening-hours/opening-hours-page-shell.tsx` | Remove `activeVenueId` state + tab UI; add reference note; mount preview card |
| Create | `src/components/opening-hours/opening-times-preview.tsx` | Self-contained preview component |

---

## Chunk 1: Remove Venue Tabs from Weekly Hours Card

### Task 1: Simplify shell — remove tabs and dead state

**Files:**
- Modify: `src/components/opening-hours/opening-hours-page-shell.tsx`

**Context:** The shell has three things to change:
1. Remove `activeVenueId` state (only used for tabs)
2. Simplify `resolvedActiveVenueId` from a `useMemo` to a plain `const`
3. Replace the tab UI block with a one-line reference note

**Important — leave `activeVenueHours` alone:** The `activeVenueHours` useMemo references `resolvedActiveVenueId`. After this refactor, `resolvedActiveVenueId` becomes a plain `const` (not a reactive value), but `activeVenueHours` is still a valid `useMemo` — it will recompute whenever `allHours` changes, which is correct. Do not touch the `activeVenueHours` memo.

- [ ] **Step 1: Remove `activeVenueId` state and simplify `resolvedActiveVenueId`**

  **Remove** this line (near the top of the component, after `selectedVenueIds`):
  ```tsx
  const [activeVenueId, setActiveVenueId] = useState<string>(venues[0]?.id ?? "");
  ```

  **Remove** the `resolvedActiveVenueId` useMemo:
  ```tsx
  // Ensure activeVenueId is always within the current selection
  const resolvedActiveVenueId = useMemo(() => {
    if (selectedVenueIds.has(activeVenueId)) return activeVenueId;
    return selectedVenues[0]?.id ?? "";
  }, [activeVenueId, selectedVenueIds, selectedVenues]);
  ```

  **Replace both** with a single plain `const` placed immediately after the `selectedVenues` memo:
  ```tsx
  const resolvedActiveVenueId = selectedVenues[0]?.id ?? "";
  ```

  `useState` stays in the import — `localOverrides` still uses it.

- [ ] **Step 2: Remove the tab UI block and add the reference note**

  Find the `<CardContent className="space-y-4">` block inside the weekly hours card. Replace it entirely with:

  ```tsx
  <CardContent className="space-y-4">
    {selectedVenues.length === 0 ? (
      <p className="text-sm text-subtle">
        Select one or more venues above to view and edit their standard weekly hours.
      </p>
    ) : (
      <>
        {selectedVenues.length > 1 && (
          <p className="text-xs text-subtle">
            Showing {selectedVenues[0].name}&apos;s current hours as reference — save will apply to all {selectedVenues.length} selected venues.
          </p>
        )}

        <WeeklyHoursGrid
          key={resolvedActiveVenueId}
          venues={selectedVenues}
          serviceTypes={serviceTypes}
          openingHours={activeVenueHours}
          canEdit
        />
      </>
    )}
  </CardContent>
  ```

  Note: the `key={resolvedActiveVenueId}` prop on `WeeklyHoursGrid` is intentionally kept — it forces the grid to remount when the first selected venue changes, resetting its local state to that venue's saved hours.

- [ ] **Step 3: Remove the `Button` import**

  The `Button` component was only used for the tab buttons. It is no longer referenced. Remove this import:
  ```tsx
  import { Button } from "@/components/ui/button";
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: zero errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/opening-hours/opening-hours-page-shell.tsx
  git commit -m "refactor: remove redundant venue tabs from weekly hours card"
  ```

---

## Chunk 2: Opening Times Preview Card

### Task 2: Create the `OpeningTimesPreview` component

**Files:**
- Create: `src/components/opening-hours/opening-times-preview.tsx`

**Context:**

- `resolveOpeningTimes()` is synchronous — no `async/await`, no loading state.
- When the preview component calls `resolveOpeningTimes()`, it passes a single-venue array. Therefore `result.venues` will always have exactly one entry, so `result.venues[0]` is safe to access without a guard.
- `serviceTypes` arrives pre-sorted by `display_order` then `name` (from `listServiceTypes()`). No client-side sort needed.
- `Select` (`src/components/ui/select.tsx`) is a thin native `<select>` wrapper. Use it as: `<Select value={x} onChange={(e) => setX(e.target.value)}>`.
- `formatDateLabel` uses `new Date(date + "T00:00:00")` (local midnight, not UTC) so the weekday label is correct in the user's local browser timezone. This is display-only so browser locale is acceptable here.

- [ ] **Step 1: Create `src/components/opening-hours/opening-times-preview.tsx` with the following content**

  ```tsx
  "use client";

  import { useState } from "react";
  import { resolveOpeningTimes } from "@/lib/opening-hours";
  import type {
    ServiceTypeRow,
    OpeningHoursRow,
    OpeningOverrideRow,
    ResolvedVenueHours,
  } from "@/lib/opening-hours";
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

      // resolveOpeningTimes always returns exactly one entry per venue passed in;
      // since we pass a single-venue array, result.venues[0] is always defined.
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
              <span className="text-xs font-medium text-subtle">
                Time window
              </span>
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
              No opening hours are configured for this venue for the selected
              period.
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
    // Only show service type columns that appear at least once in the results.
    // serviceTypes is already ordered by display_order then name.
    const presentServiceTypeIds = new Set(
      result.days.flatMap((d) => d.services.map((s) => s.serviceTypeId))
    );
    const columns = serviceTypes.filter((st) =>
      presentServiceTypeIds.has(st.id)
    );

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
                    day.services.find((s) => s.serviceTypeId === col.id) ??
                    null;
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
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: zero errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/opening-hours/opening-times-preview.tsx
  git commit -m "feat: add OpeningTimesPreview component"
  ```

---

### Task 3: Wire the preview card into the shell

**Files:**
- Modify: `src/components/opening-hours/opening-hours-page-shell.tsx`

- [ ] **Step 1: Import the new component**

  Add to the imports at the top of `opening-hours-page-shell.tsx`:

  ```tsx
  import { OpeningTimesPreview } from "@/components/opening-hours/opening-times-preview";
  ```

- [ ] **Step 2: Mount the preview card at the bottom of the page**

  Find the closing `</div>` of the main `return` block (it follows the overrides calendar card). Add the preview card immediately before it:

  ```tsx
      {/* ── Preview resolved times ────────────────────────────────────── */}
      <OpeningTimesPreview
        venues={venues}
        serviceTypes={serviceTypes}
        allHours={allHours}
        overrides={localOverrides}
      />
    </div>
  ```

  **Important:** pass `localOverrides` (the shell's live state), **not** `filteredOverrides`. The preview has its own independent venue dropdown and needs all overrides regardless of the shell's current venue filter selection.

- [ ] **Step 3: Typecheck and build**

  ```bash
  npm run typecheck && npm run build
  ```
  Expected: zero errors, successful build.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/opening-hours/opening-hours-page-shell.tsx
  git commit -m "feat: wire OpeningTimesPreview into opening hours page"
  ```

---

## Verification Checklist

After all tasks complete, manually verify on `npm run dev`:

- [ ] `/opening-hours` page loads with no console errors
- [ ] With 2+ venues selected, the weekly hours card shows the reference note instead of tabs
- [ ] The "Preview resolved times" card appears at the bottom of the page
- [ ] Selecting a venue + time window and clicking Preview shows a results table
- [ ] Override cells show the coloured dot; weekly-template cells do not
- [ ] Selecting a venue with no hours configured shows the "no hours" message
- [ ] Clicking Preview again after changing venue or time window updates the results
- [ ] The preview shows overrides added in the current session (without a page reload)
