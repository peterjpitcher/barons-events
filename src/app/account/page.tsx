import { redirect } from "next/navigation";
import { CommunicationPreferencesForm } from "@/components/account/communication-preferences-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="space-y-6">
      <div>
        <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">Account</h1>
        <p className="mt-1 max-w-2xl text-base text-subtle">
          Manage the operational emails sent to {user.email}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Communication Preferences</CardTitle>
          <CardDescription>Choose how often BaronsHub sends your open todo list.</CardDescription>
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
