import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/design-primitives";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";

export default async function AccountPage(): Promise<React.ReactNode> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const db = await createSupabaseReadonlyClient();
  const { data, error } = await db
    .from("users")
    .select("weekly_digest_last_sent_on")
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

      <Card>
        <CardHeader>
          <CardTitle>Communication Preferences</CardTitle>
          <CardDescription>The weekly BaronsHub update is sent every Tuesday morning.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-subtle">
          <p>
            This update is mandatory for active users and includes newly approved events, your to-dos due now or within 14 days, and recent debriefs.
          </p>
          {data?.weekly_digest_last_sent_on ? (
            <p>
              Last weekly update sent on {new Date(`${data.weekly_digest_last_sent_on}T00:00:00Z`).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
