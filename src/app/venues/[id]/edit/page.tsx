import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { VenueForm } from "@/components/venues/venue-form";
import { getCurrentUserProfile } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type EditVenuePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditVenuePage({ params }: EditVenuePageProps) {
  const resolvedParams = await params;
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "hq_planner") {
    redirect("/venues");
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("venues")
    .select("id,name,address,region,timezone,capacity")
    .eq("id", resolvedParams.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load venue: ${error.message}`);
  }

  if (!data) {
    notFound();
  }

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-black/50">
          <Link href="/venues" className="underline hover:text-black/70">
            Venues
          </Link>
          <span aria-hidden>›</span>
          <span className="font-medium text-black">{data.name}</span>
          <span aria-hidden>›</span>
          <span className="font-medium text-black">Edit</span>
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-black">
            Edit venue
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-black/70">
            Update venue details to keep reviewer assignments and capacity data
            accurate. Changes are instantly reflected for authenticated users.
          </p>
        </div>
      </div>

      <VenueForm
        mode="edit"
        initialValues={{
          venueId: data.id,
          name: data.name ?? "",
          address: data.address ?? "",
          region: data.region ?? "",
          timezone: data.timezone ?? "Europe/London",
          capacity: typeof data.capacity === "number" ? data.capacity : null,
        }}
      />
    </section>
  );
}
