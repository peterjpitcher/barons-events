import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/design-primitives";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { CommunicationPreferencesForm } from "@/components/account/communication-preferences-form";
import { normaliseTodoDigestFrequency } from "@/lib/communication-preferences";

export default async function AccountPage(): Promise<React.ReactNode> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const db = await createSupabaseReadonlyClient();
  const { data, error } = await db
    .from("users")
    .select("weekly_digest_last_sent_on, todo_digest_frequency, todo_digest_last_sent_on")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load account preferences: ${error.message}`);
  }

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Profile"
        title="Account"
        description={`Manage the operational emails sent to ${user.email}.`}
      />

      <section className="mobile-card md:hidden">
        <p className="mobile-eyebrow text-[var(--ink-soft)]">Profile</p>
        <h1 className="mt-1 text-xl font-semibold text-[var(--navy)]">{user.fullName ?? user.email}</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">{user.email}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="neutral">{user.role.replace(/_/g, " ")}</Badge>
          <Badge variant="success">Active</Badge>
        </div>
      </section>

      <Card className="mobile-card md:rounded-[var(--radius-lg)]">
        <CardHeader>
          <CardTitle>Communication Preferences</CardTitle>
          <CardDescription>The weekly BaronsHub update is sent every Tuesday morning.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm text-subtle">
          <div className="rounded-[8px] border border-[var(--hair)] bg-[var(--canvas-2)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-[var(--ink)]">Weekly BaronsHub update</p>
                <p className="mt-1">
                  Mandatory for active users. Includes newly approved events, due to-dos, and recent debriefs.
                </p>
              </div>
              <Badge variant="success">Locked on</Badge>
            </div>
            {data?.weekly_digest_last_sent_on ? (
              <p className="mt-3 text-xs">
                Last weekly update sent on {new Date(`${data.weekly_digest_last_sent_on}T00:00:00Z`).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </p>
            ) : null}
          </div>
          <CommunicationPreferencesForm
            todoDigestFrequency={normaliseTodoDigestFrequency(data?.todo_digest_frequency)}
            todoDigestLastSentOn={data?.todo_digest_last_sent_on ?? null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
