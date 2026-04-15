import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listUsersWithAuthData } from "@/lib/users";
import { listVenues } from "@/lib/venues";
import { UsersManager } from "@/components/users/users-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Users · Barons Events",
  description: "Manage workspace access for planners, reviewers, and venue managers."
};

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "administrator") {
    redirect("/unauthorized");
  }

  const [users, venues] = await Promise.all([listUsersWithAuthData(), listVenues()]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace users</CardTitle>
          <CardDescription>Invite team members, adjust roles, and link venues in one place.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-[var(--color-text)]">
          <p className="text-subtle">
            Invites send through Supabase auth instantly; role tweaks apply as soon as you save.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white/80 p-3 shadow-soft">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Administrator</p>
              <p className="mt-2 text-sm">
                Full access to manage venues, users, and events. Can approve requests, review submissions, edit anything, and
                see every report. Use for the core planning team only.
              </p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white/80 p-3 shadow-soft">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Office Worker</p>
              <p className="mt-2 text-sm">
                Creates and edits their own venue&apos;s events, submits drafts, and completes debriefs. They can see feedback
                but not other venues or staffing info.
              </p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white/80 p-3 shadow-soft">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Executive</p>
              <p className="mt-2 text-sm">
                Read-only snapshot for leadership. They can browse the dashboard and timelines but can&apos;t edit events or leave
                decisions.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <UsersManager users={users} venues={venues} />
    </div>
  );
}
