import { redirect } from "next/navigation";
import { ArchivedArtistsManager } from "@/components/settings/archived-artists-manager";
import { BusinessSettingsManager } from "@/components/settings/business-settings-manager";
import { EventTypesManager } from "@/components/settings/event-types-manager";
import { ServiceTypesManager } from "@/components/settings/service-types-manager";
import { SltMembersManager } from "@/components/settings/slt-members-manager";
import { SopTemplateEditor } from "@/components/settings/sop-template-editor";
import { SopBackfillButton } from "@/components/settings/sop-backfill-button";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { listArchivedArtists } from "@/lib/artists";
import { listEventTypes } from "@/lib/event-types";
import { listServiceTypes } from "@/lib/opening-hours";
import { canViewSopTemplate } from "@/lib/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "Settings · BaronsHub",
  description: "Manage event configuration and defaults."
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "administrator") {
    redirect("/unauthorized");
  }

  const db = createSupabaseAdminClient();

  const [eventTypes, archivedArtists, serviceTypes, businessSettings, sltRows, userRows] = await Promise.all([
    listEventTypes(),
    listArchivedArtists(),
    listServiceTypes(),
     
    (db as any).from("business_settings").select("*").eq("id", true).maybeSingle().then((r: any) => r.data),
     
    (db as any)
      .from("slt_members")
      .select("user_id, users:user_id(id, full_name, email, deactivated_at)")
      .then((r: any) => r.data ?? []),
     
    (db as any)
      .from("users")
      .select("id, full_name, email, deactivated_at")
      .is("deactivated_at", null)
      .order("full_name")
      .then((r: any) => r.data ?? [])
  ]);

  const labourRateGbp = Number(businessSettings?.labour_rate_gbp ?? 12.71);

  type SltRowShape = { users?: { id?: string; full_name?: string | null; email?: string | null; deactivated_at?: string | null } };
  const members = (sltRows as SltRowShape[])
    .filter((row) => row.users?.id && row.users?.email && !row.users?.deactivated_at)
    .map((row) => ({
      id: row.users!.id!,
      name: row.users!.full_name ?? row.users!.email!,
      email: row.users!.email!
    }));

  type UserRowShape = { id: string; full_name: string | null; email: string | null };
  const candidates = (userRows as UserRowShape[])
    .filter((u) => u.email)
    .map((u) => ({ id: u.id, name: u.full_name ?? u.email!, email: u.email! }));

  const tabs = [
    {
      value: "business",
      label: "Business",
      description: "Labour cost and other operational defaults used across BaronsHub.",
      content: (
        <BusinessSettingsManager
          labourRateGbp={labourRateGbp}
          updatedAt={businessSettings?.updated_at ?? null}
          updatedBy={businessSettings?.updated_by ?? null}
        />
      ),
    },
    {
      value: "slt",
      label: "SLT Distribution",
      description: "Senior leadership team members receive a BCC'd email whenever a debrief is submitted.",
      content: <SltMembersManager members={members} candidates={candidates} />,
    },
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
            content: (
              <div className="space-y-6">
                <SopTemplateEditor />
                <SopBackfillButton />
              </div>
            ),
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
