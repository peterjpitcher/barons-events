import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { listVenues } from "@/lib/venues";
import { listServiceTypes, listVenueOpeningHours, listOpeningOverrides } from "@/lib/opening-hours";
import { OpeningHoursManager } from "@/components/opening-hours/opening-hours-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/design-primitives";

export async function generateMetadata({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  const venues = await listVenues();
  const venue = venues.find((v) => v.id === venueId);
  return {
    title: venue ? `Opening hours · ${venue.name}` : "Opening hours · BaronsHub 1.1"
  };
}

export default async function VenueOpeningHoursPage({
  params
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const venues = await listVenues();
  const venue = venues.find((v) => v.id === venueId);
  if (!venue) notFound();

  const canEdit = user.role === "administrator";

  const [serviceTypes, openingHours, overrides] = await Promise.all([
    listServiceTypes(),
    listVenueOpeningHours(venueId),
    listOpeningOverrides()
  ]);

  return (
    <div className="app-page">
      <Link
        href="/venues"
        className="inline-flex items-center gap-1 text-sm text-subtle transition-colors hover:text-[var(--ink)]"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Venues
      </Link>

      <PageHeader
        eyebrow="Opening hours"
        title={venue.name}
        description={`Manage standard weekly hours and date-specific changes for this venue.${!canEdit ? " Contact an administrator to make changes." : ""}`}
        meta={[`${serviceTypes.length} service types`, `${overrides.length} overrides`]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Service templates and exceptions</CardTitle>
          <CardDescription>Weekly coverage, bank holidays, closures, and special days.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-subtle">
            Set the standard template for each service type, then add overrides for bank holidays,
            closures, or special days below.
          </p>
        </CardContent>
      </Card>

      <OpeningHoursManager
        venueId={venueId}
        venueName={venue.name}
        venues={venues.map((v) => ({ id: v.id, name: v.name }))}
        serviceTypes={serviceTypes}
        openingHours={openingHours}
        overrides={overrides}
        canEdit={canEdit}
      />
    </div>
  );
}
