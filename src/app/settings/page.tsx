import { redirect } from "next/navigation";
import { EventTypesManager } from "@/components/settings/event-types-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { listEventTypes } from "@/lib/event-types";

export const metadata = {
  title: "Settings · EventHub",
  description: "Manage event configuration and defaults."
};

export default async function SettingsPage() {
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
          <CardTitle>Settings</CardTitle>
          <CardDescription>Fine-tune the tools your teams use to plan events.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-subtle">
            Adjust picklists and defaults so requests stay consistent across the estate.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event types</CardTitle>
          <CardDescription>Keep this list focused on the programming that fits your pubs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <EventTypesManager eventTypes={eventTypes} />
        </CardContent>
      </Card>
    </div>
  );
}
