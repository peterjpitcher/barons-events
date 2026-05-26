import { redirect } from "next/navigation";
import { CommunicationPreferencesForm } from "@/components/account/communication-preferences-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/design-primitives";
import { getCurrentUser } from "@/lib/auth";
import { normaliseTodoDigestFrequency } from "@/lib/communication-preferences";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";

export default async function AccountPage(): Promise<React.ReactNode> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const db = await createSupabaseReadonlyClient();
  const { data, error } = await db
    .from("users")
    .select("todo_digest_frequency, todo_digest_last_sent_on")
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
          <CardDescription>Choose how often BaronsHub 1.1 sends your open todo list.</CardDescription>
        </CardHeader>
        <CardContent>
          <CommunicationPreferencesForm
            todoDigestFrequency={normaliseTodoDigestFrequency(data?.todo_digest_frequency)}
            todoDigestLastSentOn={data?.todo_digest_last_sent_on ?? null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
