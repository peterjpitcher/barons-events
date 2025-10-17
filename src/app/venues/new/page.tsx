import Link from "next/link";
import { redirect } from "next/navigation";
import { VenueForm } from "@/components/venues/venue-form";
import { getCurrentUserProfile } from "@/lib/profile";

export default async function NewVenuePage() {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "hq_planner") {
    redirect("/venues");
  }

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-black/50">
          <Link href="/venues" className="underline hover:text-black/70">
            Venues
          </Link>
          <span aria-hidden>›</span>
          <span className="font-medium text-black">New venue</span>
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-black">
            Create a venue
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-black/70">
            Add baseline venue details to unlock reviewer assignments, draft
            creation, and RLS-scoped access for venue managers.
          </p>
        </div>
      </div>

      <VenueForm mode="create" />
    </section>
  );
}
