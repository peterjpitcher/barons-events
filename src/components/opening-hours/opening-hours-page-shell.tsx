"use client";

import { useMemo, useState } from "react";
import type { ServiceTypeRow, OpeningHoursRow, OpeningOverrideRow } from "@/lib/opening-hours";
import { WeeklyHoursGrid } from "@/components/opening-hours/weekly-hours-grid";
import { OverridesCalendar } from "@/components/opening-hours/overrides-calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type VenueOption = { id: string; name: string };

type OpeningHoursPageShellProps = {
  venues: VenueOption[];
  serviceTypes: ServiceTypeRow[];
  allHours: OpeningHoursRow[];
  overrides: OpeningOverrideRow[];
};

export function OpeningHoursPageShell({
  venues,
  serviceTypes,
  allHours,
  overrides
}: OpeningHoursPageShellProps) {
  // Venue filter: null = all venues, otherwise a Set of selected venue IDs
  const [selectedVenueIds, setSelectedVenueIds] = useState<Set<string>>(
    () => new Set(venues.map((v) => v.id))
  );

  // Which venue's weekly grid is currently being edited (when multiple selected)
  const [activeVenueId, setActiveVenueId] = useState<string>(venues[0]?.id ?? "");

  // Overrides state lives here so the calendar can do optimistic updates
  const [localOverrides, setLocalOverrides] = useState<OpeningOverrideRow[]>(overrides);

  const selectedVenues = useMemo(
    () => venues.filter((v) => selectedVenueIds.has(v.id)),
    [venues, selectedVenueIds]
  );

  // Ensure activeVenueId is always within the current selection
  const resolvedActiveVenueId = useMemo(() => {
    if (selectedVenueIds.has(activeVenueId)) return activeVenueId;
    return selectedVenues[0]?.id ?? "";
  }, [activeVenueId, selectedVenueIds, selectedVenues]);

  // Hours filtered to the active (tab) venue
  const activeVenueHours = useMemo(
    () => allHours.filter((h) => h.venue_id === resolvedActiveVenueId),
    [allHours, resolvedActiveVenueId]
  );

  // Overrides that include at least one selected venue
  const filteredOverrides = useMemo(() => {
    if (selectedVenueIds.size === venues.length) return localOverrides;
    return localOverrides.filter((ov) =>
      ov.venue_ids.some((id) => selectedVenueIds.has(id))
    );
  }, [localOverrides, selectedVenueIds, venues.length]);

  function toggleVenue(venueId: string) {
    setSelectedVenueIds((prev) => {
      const next = new Set(prev);
      if (next.has(venueId)) {
        // Don't allow deselecting the last venue
        if (next.size === 1) return prev;
        next.delete(venueId);
      } else {
        next.add(venueId);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedVenueIds(new Set(venues.map((v) => v.id)));
  }

  const allSelected = selectedVenueIds.size === venues.length;

  if (venues.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <Card>
          <CardContent className="py-10 text-center text-subtle text-sm">
            No venues found. Add venues in the{" "}
            <a href="/venues" className="underline hover:text-[var(--color-primary-700)]">Venues</a>{" "}
            section first.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader />

      {/* ── Venue filter ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Venues</CardTitle>
          <CardDescription>
            Select which venues to view and edit. You can work with one, several, or all at once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                allSelected
                  ? "border-[var(--color-primary-700)] bg-[var(--color-primary-700)] text-white"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text)] hover:border-[var(--color-primary-500)]"
              }`}
            >
              All venues
            </button>
            {venues.map((venue) => {
              const active = selectedVenueIds.has(venue.id);
              return (
                <button
                  key={venue.id}
                  type="button"
                  onClick={() => toggleVenue(venue.id)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "border-[var(--color-primary-500)] bg-[var(--color-primary-100)] text-[var(--color-primary-800)]"
                      : "border-[var(--color-border)] bg-white text-subtle hover:border-[var(--color-primary-400)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {venue.name}
                </button>
              );
            })}
          </div>
          {!allSelected && (
            <p className="mt-2 text-xs text-subtle">
              Showing {selectedVenueIds.size} of {venues.length} venue{venues.length === 1 ? "" : "s"}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Weekly hours ──────────────────────────────────────────────── */}
      {serviceTypes.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Standard weekly hours</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-subtle">
              No service types configured. Add them in{" "}
              <a href="/settings" className="underline hover:text-[var(--color-primary-700)]">
                Settings → Opening hours service types
              </a>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Standard weekly hours</CardTitle>
            <CardDescription>
              Regular opening and closing times for each service by day of week — these repeat every week.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Venue tabs — only show when more than one venue is selected */}
            {selectedVenues.length > 1 && (
              <div className="flex flex-wrap gap-1.5 border-b border-[var(--color-border)] pb-3">
                {selectedVenues.map((venue) => (
                  <Button
                    key={venue.id}
                    type="button"
                    size="sm"
                    variant={venue.id === resolvedActiveVenueId ? "secondary" : "ghost"}
                    onClick={() => setActiveVenueId(venue.id)}
                  >
                    {venue.name}
                  </Button>
                ))}
              </div>
            )}

            {resolvedActiveVenueId ? (
              <WeeklyHoursGrid
                key={resolvedActiveVenueId}
                venueId={resolvedActiveVenueId}
                serviceTypes={serviceTypes}
                openingHours={activeVenueHours}
                canEdit
              />
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ── Overrides calendar ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Date-specific changes</CardTitle>
          <CardDescription>
            Override hours for specific dates — bank holidays, closures, extended hours, etc.
            One change can apply to multiple venues simultaneously.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OverridesCalendar
            venueId={resolvedActiveVenueId}
            venues={venues}
            serviceTypes={serviceTypes}
            overrides={filteredOverrides}
            onOverridesChange={setLocalOverrides}
            canEdit
            defaultSelectedVenueIds={selectedVenueIds}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PageHeader() {
  return (
    <header>
      <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">Opening Hours</h1>
      <p className="mt-1 text-subtle">
        Set standard weekly hours and date-specific exceptions across your venues.
      </p>
    </header>
  );
}
