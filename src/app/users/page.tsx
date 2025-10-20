import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listUsers } from "@/lib/users";
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
  if (user.role !== "central_planner") {
    redirect("/");
  }

  const [users, venues] = await Promise.all([listUsers(), listVenues()]);

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
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white/80 p-3 shadow-soft">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Central planner</p>
              <p className="mt-2 text-sm">
                Full access to manage venues, users, and events. Can approve requests, edit anything, reassign reviewers, and
                see every report. Use for the core planning team only.
              </p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white/80 p-3 shadow-soft">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Reviewer</p>
              <p className="mt-2 text-sm">
                Sees events they&apos;re assigned once submitted. Can leave decisions and feedback but can&apos;t edit venue details or
                invite new users. Ideal for ops or senior managers who review programming.
              </p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white/80 p-3 shadow-soft">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Venue manager</p>
              <p className="mt-2 text-sm">
                Creates and edits their own venue&apos;s events, submits drafts, and completes debriefs. They can see reviewer feedback
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
