import type { ReactNode } from "react";
import { getCurrentUserProfile } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { NotificationPreferences } from "@/components/settings/notification-preferences";
import {
  UserManagementCard,
  type ManagedUser,
  type VenueOption,
} from "@/components/settings/user-management-card";

const aiMaintenanceRunbook =
  "https://github.com/peterjpitcher/barons-events/blob/main/docs/Runbooks/AiMetadataMaintenance.md";
const executiveCalendarRunbook =
  "https://github.com/peterjpitcher/barons-events/blob/main/docs/Runbooks/ExecutiveCalendar.md";

export default async function SettingsPage() {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    return (
      <div className="space-y-6">
        <Alert
          variant="danger"
          title="Profile unavailable"
          description="We couldn’t load your profile. Sign in again to manage your settings."
        />
      </div>
    );
  }

  const isCentralPlanner = profile.role === "central_planner";

  let managedUsers: ManagedUser[] = [];
  let managedVenues: VenueOption[] = [];
  let userManagementError: string | null = null;

  if (isCentralPlanner) {
    try {
      const supabase = await createSupabaseServerClient();
      const [usersResult, venuesResult] = await Promise.all([
        supabase
          .from("users")
          .select("id,email,full_name,role,created_at,venue:venues(id,name)")
          .order("created_at", { ascending: false }),
        supabase
          .from("venues")
          .select("id,name")
          .order("name", { ascending: true }),
      ]);

      if (usersResult.error) {
        userManagementError = usersResult.error.message ?? "Unable to load users.";
      } else {
        const rows = usersResult.data ?? [];
        managedUsers = rows.map((row) => {
          const typedRow = row as unknown as {
            id: string;
            email: string;
            full_name: string | null;
            role: string;
            created_at: string | null;
            venue:
              | null
              | { id: string; name: string | null }
              | Array<{ id: string; name: string | null }>;
          };

          const venueRelation = Array.isArray(typedRow.venue)
            ? typedRow.venue[0] ?? null
            : typedRow.venue ?? null;

          return {
            id: typedRow.id,
            email: typedRow.email,
            full_name: typedRow.full_name,
            role: typedRow.role,
            venue: venueRelation,
            created_at: typedRow.created_at,
          } satisfies ManagedUser;
        });
      }

      if (venuesResult.error) {
        userManagementError = venuesResult.error.message ?? "Unable to load venues.";
      } else {
        managedVenues = (venuesResult.data ?? []).map((venue) => {
          const typedVenue = venue as unknown as {
            id: string;
            name: string | null;
          };

          return {
            id: typedVenue.id,
            name: typedVenue.name ?? "Untitled venue",
          } satisfies VenueOption;
        });
      }
    } catch (error) {
      userManagementError =
        error instanceof Error ? error.message : "Unable to load user management data.";
    }
  }

  const notificationItems = [
    {
      id: "debrief_reminders",
      label: "Debrief reminders",
      helper:
        "Get a reminder the day after each event plus a follow-up if the debrief is still outstanding.",
      defaultValue: "email_in_app" as const,
      runbookHref:
        "https://github.com/peterjpitcher/barons-events/blob/main/docs/Runbooks/CronMonitoring.md",
    },
    {
      id: "reviewer_sla_alerts",
      label: "Reviewer response alerts",
      helper:
        "Ping when one of your reviews is about to miss its response deadline.",
      defaultValue: "email_in_app" as const,
      critical: true,
      runbookHref:
        "https://github.com/peterjpitcher/barons-events/blob/main/docs/Runbooks/CronMonitoring.md",
    },
    {
      id: "ai_metadata_ready",
      label: "AI copy notifications",
      helper:
        "Let the central planning team know when AI-generated copy finishes or needs a manual check.",
      defaultValue: "in_app" as const,
      runbookHref: aiMaintenanceRunbook,
    },
    {
      id: "digest_preview",
      label: "Weekly digest preview",
      helper:
        "Receive a heads-up before the executive digest sends so you can adjust highlights.",
      defaultValue: "off" as const,
      runbookHref: executiveCalendarRunbook,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account & preferences"
        title="Workspace settings"
        description="Manage your profile, notification preferences, and understand how roles collaborate across the EventHub workspace."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Fact label="Signed in as" value={profile.full_name ?? profile.email} helper={profile.email} />
          <Fact
            label="Role"
            value={formatRole(profile.role)}
            helper={
              profile.venue_id
                ? `Venue ID: ${profile.venue_id}`
                : "Reach out to central planning if this looks wrong."
            }
          />
          <Fact
            label="Support"
            value="peter@orangejelly.co.uk"
            helper="Contact Peter Pitcher for access updates or questions."
          />
        </div>
      </PageHeader>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,3fr),minmax(0,2fr)]">
        <section className="space-y-6">
          <ProfileSummaryCard
            fullName={profile.full_name ?? ""}
            email={profile.email}
            role={formatRole(profile.role)}
            venueId={profile.venue_id}
          />

          {isCentralPlanner ? (
            userManagementError ? (
              <Alert
                variant="danger"
                title="User management unavailable"
                description={userManagementError}
              />
            ) : (
              <UserManagementCard users={managedUsers} venues={managedVenues} />
            )
          ) : null}

          <Card className="bg-white/98">
            <CardHeader>
              <CardTitle>Notification preferences</CardTitle>
              <CardDescription>
                Choose how you’d like to hear about reminders and digests. Use “Send test alert” to confirm each channel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <NotificationPreferences items={notificationItems} />
              <Alert
                variant="neutral"
                title="AI copy upkeep guide"
                description="Open docs/Runbooks/AiMetadataMaintenance.md to keep AI copy notifications aligned with our publishing process."
              />
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-6">
          <RolesOverviewCard />
        </aside>
      </div>
    </div>
  );
}

type ProfileSummaryCardProps = {
  fullName: string;
  email: string;
  role: string;
  venueId: string | null;
};

function ProfileSummaryCard({
  fullName,
  email,
  role,
  venueId,
}: ProfileSummaryCardProps) {
  return (
    <Card className="bg-white/98">
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
        <CardDescription>
          These details come from our account records. Contact central planning ops for changes until self-service
          editing is available.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Full name">
          <Input defaultValue={fullName} readOnly />
        </Field>
        <Field label="Email">
          <Input defaultValue={email} readOnly />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Role">
            <Input defaultValue={role} readOnly />
          </Field>
          <Field label="Assigned venue">
            <Input defaultValue={venueId ?? "Not assigned"} readOnly />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <a href="mailto:peter@orangejelly.co.uk?subject=Profile%20update%20request">
              Request profile change
            </a>
          </Button>
          <span className="text-xs text-[var(--color-text-subtle)]">
            Central planning adjusts role or venue assignments within one business day.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function RolesOverviewCard() {
  const roles = [
    {
      id: "venue_manager",
      label: "Venue manager",
      description:
        "Creates events, addresses reviewer feedback, and submits post-event debriefs.",
    },
    {
      id: "reviewer",
      label: "Reviewer",
      description:
        "Reviews submissions, keeps response deadlines on track, and loops in central planning when something slips.",
    },
    {
      id: "central_planner",
      label: "Central planner",
      description:
        "Oversees planning dashboards, coordinates AI copy reviews, and shares weekly updates with leadership.",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team roles</CardTitle>
        <CardDescription>
          Each role gets tailored access to tools and dashboards. Share this overview with new teammates during onboarding.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {roles.map((role) => (
          <div
            key={role.id}
            className="rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.1)] bg-white/85 p-4 shadow-soft"
          >
            <Badge variant={roleBadgeTone(role.id)}>{role.label}</Badge>
            <p className="mt-2 text-sm text-muted leading-relaxed">{role.description}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type FieldProps = {
  label: string;
  children: ReactNode;
};

function Field({ label, children }: FieldProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--color-primary-500)]">
        {label}
      </label>
      {children}
    </div>
  );
}

type FactProps = {
  label: string;
  value: string | null;
  helper?: string | null;
};

function Fact({ label, value, helper }: FactProps) {
  return (
    <div className="rounded-[var(--radius)] border border-[rgba(42,79,168,0.18)] bg-white/95 px-4 py-3 shadow-soft">
      <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--color-primary-500)]">
        {label}
      </span>
      <p className="mt-1 text-base font-semibold text-[var(--color-primary-900)]">
        {value ?? "—"}
      </p>
      {helper ? (
        <p className="mt-1 text-xs text-[var(--color-text-subtle)] leading-relaxed">{helper}</p>
      ) : null}
    </div>
  );
}

function formatRole(role: string | null) {
  if (!role) return "Role pending";
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function roleBadgeTone(roleId: string): "info" | "warning" | "success" {
  switch (roleId) {
    case "central_planner":
      return "success";
    case "reviewer":
      return "warning";
    default:
      return "info";
  }
}
