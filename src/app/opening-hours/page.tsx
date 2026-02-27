import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listVenues } from "@/lib/venues";
import { listServiceTypes, listAllVenueOpeningHours, listOpeningOverrides } from "@/lib/opening-hours";
import { OpeningHoursPageShell } from "@/components/opening-hours/opening-hours-page-shell";

export const metadata = {
  title: "Opening Hours · EventHub",
  description: "Manage standard weekly hours and date-specific changes across all venues."
};

export default async function OpeningHoursPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") redirect("/");

  const [venues, serviceTypes, allHours, overrides] = await Promise.all([
    listVenues(),
    listServiceTypes(),
    listAllVenueOpeningHours(),
    listOpeningOverrides()
  ]);

  return (
    <OpeningHoursPageShell
      venues={venues.map((v) => ({ id: v.id, name: v.name }))}
      serviceTypes={serviceTypes}
      allHours={allHours}
      overrides={overrides}
    />
  );
}
