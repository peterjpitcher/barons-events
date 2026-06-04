import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canProposeEvents } from "@/lib/roles";
import { listVenues } from "@/lib/venues";
import { ProposeEventForm } from "@/components/events/propose-event-form";
import { PageHeader } from "@/components/ui/design-primitives";
import type { VenueOption } from "@/components/venues/venue-multi-select";

export const metadata = {
  title: "Propose an event · BaronsHub 1.1",
  description: "Submit a quick event proposal for admin approval before filling in the full details."
};

export default async function ProposeEventPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canProposeEvents(user.role)) redirect("/unauthorized");

  const venueRows = await listVenues();
  const venues: VenueOption[] = venueRows.map((v) => ({
    id: v.id,
    name: v.name,

    category: (((v as any).category ?? "pub") === "cafe" ? "cafe" : "pub") as "pub" | "cafe",
    isInternal: Boolean((v as any).is_internal)
  }));

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="New proposal"
        title="Propose an event"
        description="Give just a title, date and short description before the full event form is opened."
        meta={<span>{venues.length} available venue{venues.length === 1 ? "" : "s"}</span>}
      />
      <section className="rounded-[10px] border border-[var(--hair)] bg-[var(--paper)] p-4 shadow-card">
          <ProposeEventForm venues={venues} defaultVenueId={null} />
          <p className="mt-4 text-xs text-subtle">
            Need to submit a fully-detailed event straight away? <Link className="underline" href="/events/new">Use the full event form.</Link>
          </p>
      </section>
    </div>
  );
}
