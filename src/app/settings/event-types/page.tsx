import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listEventTypes } from "@/lib/event-types";
import { EventTypesManager } from "@/components/settings/event-types-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Event types · EventHub",
  description: "Manage the picklist of event types available to venues."
};

export default async function EventTypesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner") {
    redirect("/");
  }

  const eventTypes = await listEventTypes();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Event types</CardTitle>
          <CardDescription>Keep this list tidy so venues log events consistently.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-subtle">
            Update the names when your programming changes. Removing a type doesn’t delete historical events—it just removes the option for new drafts.
          </p>
        </CardContent>
      </Card>
      <EventTypesManager eventTypes={eventTypes} />
    </div>
  );
}
