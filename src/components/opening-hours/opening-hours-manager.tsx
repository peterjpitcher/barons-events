"use client";

import { useState } from "react";
import type { ServiceTypeRow, OpeningHoursRow, OpeningOverrideRow } from "@/lib/opening-hours";
import { WeeklyHoursGrid } from "@/components/opening-hours/weekly-hours-grid";
import { OverridesCalendar } from "@/components/opening-hours/overrides-calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type VenueOption = { id: string; name: string };

type OpeningHoursManagerProps = {
  venueId: string;
  venueName: string;
  venues: VenueOption[];
  serviceTypes: ServiceTypeRow[];
  openingHours: OpeningHoursRow[];
  overrides: OpeningOverrideRow[];
  canEdit: boolean;
};

export function OpeningHoursManager({
  venueId,
  venueName,
  venues,
  serviceTypes,
  openingHours,
  overrides,
  canEdit
}: OpeningHoursManagerProps) {
  const [localOverrides, setLocalOverrides] = useState<OpeningOverrideRow[]>(overrides);

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Standard weekly hours</CardTitle>
          <CardDescription>
            Set regular opening and closing times for each service by day of week. These repeat every week.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {serviceTypes.length === 0 ? (
            <p className="text-sm text-subtle">
              No service types configured. Add some in{" "}
              <a href="/settings" className="underline hover:text-[var(--color-primary-700)]">
                Settings → Opening hours service types
              </a>
              .
            </p>
          ) : (
            <WeeklyHoursGrid
              venues={[{ id: venueId, name: venueName }]}
              serviceTypes={serviceTypes}
              openingHours={openingHours}
              canEdit={canEdit}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Date-specific changes</CardTitle>
          <CardDescription>
            Override hours for specific dates — bank holidays, closures, extended hours, etc. One change can apply to multiple venues.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OverridesCalendar
            venueId={venueId}
            venues={venues}
            serviceTypes={serviceTypes}
            overrides={localOverrides}
            onOverridesChange={setLocalOverrides}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
