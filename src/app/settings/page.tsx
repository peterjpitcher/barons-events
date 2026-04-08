import { redirect } from "next/navigation";
import { ArchivedArtistsManager } from "@/components/settings/archived-artists-manager";
import { EventTypesManager } from "@/components/settings/event-types-manager";
import { ServiceTypesManager } from "@/components/settings/service-types-manager";
import { SopTemplateEditor } from "@/components/settings/sop-template-editor";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { listArchivedArtists } from "@/lib/artists";
import { listEventTypes } from "@/lib/event-types";
import { listServiceTypes } from "@/lib/opening-hours";
import { canViewSopTemplate } from "@/lib/roles";

export const metadata = {
  title: "Settings · BaronsHub",
  description: "Manage event configuration and defaults."
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner") {
    redirect("/unauthorized");
  }

  const [eventTypes, archivedArtists, serviceTypes] = await Promise.all([
    listEventTypes(),
    listArchivedArtists(),
    listServiceTypes()
  ]);

  const tabs = [
    {
      value: "event-types",
      label: "Event Types",
      description: "Keep this list focused on the programming that fits your pubs.",
      content: <EventTypesManager eventTypes={eventTypes} />,
    },
    {
      value: "service-types",
      label: "Service Types",
      description: "These categories appear as rows in the weekly opening hours grid for each venue.",
      content: <ServiceTypesManager serviceTypes={serviceTypes} />,
    },
    ...(canViewSopTemplate(user.role)
      ? [
          {
            value: "sop",
            label: "SOP Checklist",
            description: "Define the default checklist sections and tasks that get applied to each event and planning item.",
            content: <SopTemplateEditor />,
          },
        ]
      : []),
    {
      value: "archived-artists",
      label: "Archived Artists",
      description: "Archived artists are hidden from planning flows but can be restored here.",
      content: <ArchivedArtistsManager artists={archivedArtists} />,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
      </Card>

      <SettingsTabs tabs={tabs} />
    </div>
  );
}
