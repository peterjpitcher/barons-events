"use client";

import { useMemo, useState } from "react";
import type { ServiceTypeRow, OpeningHoursRow, OpeningOverrideRow, VenueServiceRow } from "@/lib/opening-hours";
import { WeeklyHoursGrid } from "@/components/opening-hours/weekly-hours-grid";
import { OverridesCalendar } from "@/components/opening-hours/overrides-calendar";
import { OpeningTimesPreview } from "@/components/opening-hours/opening-times-preview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader as AppPageHeader } from "@/components/ui/design-primitives";

type VenueOption = { id: string; name: string };

type OpeningHoursPageShellProps = {
  venues: VenueOption[];
  serviceTypes: ServiceTypeRow[];
  venueServices: VenueServiceRow[];
  allHours: OpeningHoursRow[];
  overrides: OpeningOverrideRow[];
};

export function OpeningHoursPageShell({
  venues,
  serviceTypes,
  venueServices,
  allHours,
  overrides
}: OpeningHoursPageShellProps) {
  // Venue filter: empty set = nothing selected (initial state)
  const [selectedVenueIds, setSelectedVenueIds] = useState<Set<string>>(() => new Set());

  // Overrides state lives here so the calendar can do optimistic updates
  const [localOverrides, setLocalOverrides] = useState<OpeningOverrideRow[]>(overrides);

  const selectedVenues = useMemo(
    () => venues.filter((v) => selectedVenueIds.has(v.id)),
    [venues, selectedVenueIds]
  );

  const resolvedActiveVenueId = selectedVenues[0]?.id ?? "";

  // Hours filtered to the active (tab) venue
  const activeVenueHours = useMemo(
    () => allHours.filter((h) => h.venue_id === resolvedActiveVenueId),
    [allHours, resolvedActiveVenueId]
  );

  // Overrides that include at least one selected venue.
  // When nothing (or everything) is selected, show all overrides.
  const filteredOverrides = useMemo(() => {
    if (selectedVenueIds.size === 0 || selectedVenueIds.size === venues.length) return localOverrides;
    return localOverrides.filter((ov) =>
      ov.venue_ids.some((id) => selectedVenueIds.has(id))
    );
  }, [localOverrides, selectedVenueIds, venues.length]);

  function toggleVenue(venueId: string) {
    setSelectedVenueIds((prev) => {
      const next = new Set(prev);
      if (next.has(venueId)) {
        next.delete(venueId);
      } else {
        next.add(venueId);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedVenueIds(new Set());
    } else {
      setSelectedVenueIds(new Set(venues.map((v) => v.id)));
    }
  }

  const allSelected = selectedVenueIds.size === venues.length;

  if (venues.length === 0) {
    return (
      <div className="app-page">
        <OpeningHoursHeader />
        <Card>
          <CardContent className="py-10 text-center text-subtle text-sm">
            No venues found. Add venues in the{" "}
            <a href="/venues" className="underline hover:text-[var(--navy)]">Venues</a>{" "}
            section first.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-page">
      <OpeningHoursHeader />

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
              onClick={toggleAll}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                allSelected
                  ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                  : "border-[var(--hair)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--slate)]"
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
                      ? "border-[var(--slate)] bg-[var(--slate-50)] text-[var(--navy-700)]"
                      : "border-[var(--hair)] bg-[var(--paper)] text-subtle hover:border-[var(--slate)] hover:text-[var(--ink)]"
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
              <a href="/settings" className="underline hover:text-[var(--navy)]">
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

      {/* ── Preview resolved times ────────────────────────────────────── */}
      <OpeningTimesPreview
        venues={venues}
        serviceTypes={serviceTypes}
        venueServices={venueServices}
        allHours={allHours}
        overrides={localOverrides}
      />
    </div>
  );
}

function OpeningHoursHeader() {
  return (
    <AppPageHeader
      eyebrow="Venue operations"
      title="Opening Hours"
      description="Set standard weekly hours and date-specific exceptions across your venues."
    />
  );
}
