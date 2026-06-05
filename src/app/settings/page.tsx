import { redirect } from "next/navigation";
import { ArchivedArtistsManager } from "@/components/settings/archived-artists-manager";
import { BusinessSettingsManager } from "@/components/settings/business-settings-manager";
import { EventTypesManager } from "@/components/settings/event-types-manager";
import { ServiceTypesManager } from "@/components/settings/service-types-manager";
import { SltMembersManager } from "@/components/settings/slt-members-manager";
import { SopTemplateEditor } from "@/components/settings/sop-template-editor";
import { SopBackfillButton } from "@/components/settings/sop-backfill-button";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { PageHeader } from "@/components/ui/design-primitives";
import { getCurrentUser } from "@/lib/auth";
import { listArchivedArtists } from "@/lib/artists";
import { listEventTypes } from "@/lib/event-types";
import { listServiceTypes } from "@/lib/opening-hours";
import { canViewSopTemplate } from "@/lib/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "Settings · BaronsHub 1.1",
  description: "Manage event configuration and defaults."
};

type SettingsPageProps = {
  searchParams?: Promise<{ tab?: string }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const canEdit = user.role === "administrator";
  const requestedParams: { tab?: string } = (await searchParams?.catch(() => ({}))) ?? {};
  const requestedTab = typeof requestedParams.tab === "string" ? requestedParams.tab : undefined;

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
  const accountantSalesReportEnabled = businessSettings?.accountant_sales_report_enabled !== false;
  const accountantSalesReportEmail =
    typeof businessSettings?.accountant_sales_report_email === "string" && businessSettings.accountant_sales_report_email
      ? businessSettings.accountant_sales_report_email
      : "julieware@hotmail.com";

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
      description: "Labour cost and other operational defaults used across BaronsHub 1.1.",
      content: (
        <BusinessSettingsManager
          labourRateGbp={labourRateGbp}
          accountantSalesReportEnabled={accountantSalesReportEnabled}
          accountantSalesReportEmail={accountantSalesReportEmail}
          updatedAt={businessSettings?.updated_at ?? null}
          updatedBy={businessSettings?.updated_by ?? null}
          canEdit={canEdit}
        />
      ),
    },
    {
      value: "slt",
      label: "SLT Distribution",
      description: "Senior leadership team members receive a BCC'd email whenever a debrief is submitted.",
      content: <SltMembersManager members={members} candidates={candidates} canEdit={canEdit} />,
    },
    {
      value: "event-types",
      label: "Event Types",
      description: "Keep this list focused on the programming that fits your pubs.",
      content: <EventTypesManager eventTypes={eventTypes} canEdit={canEdit} />,
    },
    {
      value: "service-types",
      label: "Service Types",
      description: "These categories appear as rows in the weekly opening hours grid for each venue.",
      content: <ServiceTypesManager serviceTypes={serviceTypes} canEdit={canEdit} />,
    },
    ...(canViewSopTemplate(user.role)
      ? [
          {
            value: "sop",
            label: "SOP Checklist",
            description: "Define the default checklist sections and tasks that get applied to each event and planning item.",
            content: (
              <div className="space-y-4">
                <SopTemplateEditor />
                {canEdit ? <SopBackfillButton /> : null}
              </div>
            ),
          },
        ]
      : []),
    {
      value: "archived-artists",
      label: "Archived Artists",
      description: "Archived artists are hidden from planning flows but can be restored here.",
      content: <ArchivedArtistsManager artists={archivedArtists} canEdit={canEdit} />,
    },
  ];

  return (
    <div className="app-page">
      <div className="hidden md:block">
        <PageHeader
          eyebrow="Configuration"
          title="Settings"
          description="Manage operational defaults, event taxonomies, SOP templates, and archived artist records."
          meta={<span>{tabs.length} sections</span>}
        />
      </div>
      <div className="md:hidden">
        <p className="mobile-eyebrow">Manage</p>
        <h1 className="mt-1 font-brand-serif text-[1.85rem] font-medium leading-tight text-[var(--navy)]">
          Settings
        </h1>
      </div>

      <SettingsTabs tabs={tabs} initialTab={requestedTab} />
    </div>
  );
}
