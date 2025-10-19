import { redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { listVenuesWithAreas } from "@/lib/venues";
import { listReviewers } from "@/lib/reviewers";
import { listEventTypes } from "@/lib/event-types";

export default async function NewEventPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (user.role === "reviewer" || user.role === "executive") {
    redirect("/");
  }

  const [venues, reviewers, eventTypes] = await Promise.all([
    listVenuesWithAreas(),
    listReviewers(),
    listEventTypes()
  ]);
  const availableVenues = user.role === "venue_manager" ? venues.filter((venue) => venue.id === user.venueId) : venues;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a new event draft</CardTitle>
          <CardDescription>
            Share the essentials so reviewers can respond quickly—keep the language simple and cover timings, space, and any promos.
          </CardDescription>
        </CardHeader>
      </Card>
      <EventForm
        mode="create"
        venues={availableVenues}
        reviewers={reviewers}
        eventTypes={eventTypes.map((type) => type.label)}
        role={user.role}
        userVenueId={user.venueId}
      />
    </div>
  );
}
