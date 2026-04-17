import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canManageEvents } from "@/lib/roles";
import { listVenues } from "@/lib/venues";
import { ProposeEventForm } from "@/components/events/propose-event-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { VenueOption } from "@/components/venues/venue-multi-select";

export const metadata = {
  title: "Propose an event · BaronsHub",
  description: "Submit a quick event proposal for admin approval before filling in the full details."
};

export default async function ProposeEventPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageEvents(user.role, user.venueId)) redirect("/unauthorized");

  const venueRows = await listVenues();
  const venues: VenueOption[] = venueRows.map((v) => ({
    id: v.id,
    name: v.name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    category: (((v as any).category ?? "pub") === "cafe" ? "cafe" : "pub") as "pub" | "cafe"
  }));

  // Office workers with a specific venue: pre-restrict to that venue only.
  const restrictedVenues =
    user.role === "office_worker" && user.venueId
      ? venues.filter((v) => v.id === user.venueId)
      : venues;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Propose an event</CardTitle>
          <CardDescription>
            Give just a title, date and short description. An administrator will review and — once approved —
            you can fill in the remaining details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProposeEventForm venues={restrictedVenues} />
          <p className="mt-4 text-xs text-subtle">
            Need to submit a fully-detailed event straight away? <Link className="underline" href="/events/new">Use the full event form.</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
