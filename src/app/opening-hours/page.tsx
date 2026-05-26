import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listVenues } from "@/lib/venues";
import { listServiceTypes, listAllVenueOpeningHours, listAllVenueServices, listOpeningOverrides } from "@/lib/opening-hours";
import { OpeningHoursPageShell } from "@/components/opening-hours/opening-hours-page-shell";

export const metadata = {
  title: "Opening Hours · BaronsHub 1.1",
  description: "Manage standard weekly hours and date-specific changes across all venues."
};

export default async function OpeningHoursPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "administrator") redirect("/unauthorized");

  const [venues, serviceTypes, venueServices, allHours, overrides] = await Promise.all([
    listVenues(),
    listServiceTypes(),
    listAllVenueServices(),
    listAllVenueOpeningHours(),
    listOpeningOverrides()
  ]);

  return (
    <OpeningHoursPageShell
      venues={venues.map((v) => ({ id: v.id, name: v.name }))}
      serviceTypes={serviceTypes}
      venueServices={venueServices}
      allHours={allHours}
      overrides={overrides}
    />
  );
}
