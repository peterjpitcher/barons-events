import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listUsersWithAuthData } from "@/lib/users";
import { listVenues } from "@/lib/venues";
import { UsersManager } from "@/components/users/users-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/design-primitives";

export const metadata = {
  title: "Users · BaronsHub 1.1",
  description: "Manage workspace access for administrators and office workers."
};

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const canEdit = user.role === "administrator";

  const [users, venues] = await Promise.all([listUsersWithAuthData(), listVenues()]);

  return (
    <div className="app-page">
      <div className="hidden md:block">
        <PageHeader
          eyebrow="Access"
          title="Workspace users"
          description="Invite team members, adjust roles, and link venues in one place."
          meta={<span>{users.length} user{users.length === 1 ? "" : "s"}</span>}
        />
      </div>
      <div className="md:hidden">
        <p className="mobile-eyebrow">Manage</p>
        <h1 className="mt-1 font-brand-serif text-[1.85rem] font-medium leading-tight text-[var(--navy)]">
          Users
        </h1>
      </div>
      <Card className="hidden overflow-hidden md:block">
        <CardHeader>
          <CardTitle>Role model</CardTitle>
          <CardDescription>Each role maps to the operational permissions used throughout BaronsHub 1.1.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-[var(--ink)]">
          <p className="text-subtle">
            Invites send through Supabase auth instantly; role tweaks apply as soon as you save.
          </p>
          <div className="grid overflow-hidden rounded-[var(--radius)] border border-[var(--hair)] bg-[var(--paper-tint)] md:grid-cols-2 md:divide-x md:divide-y-0 divide-y divide-[var(--hair)]">
            <div className="p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Administrator</p>
              <p className="mt-2 text-sm">
                Full access to manage venues, users, and events. Can approve requests, review submissions, edit anything, and
                see every report. Use for the core planning team only.
              </p>
            </div>
            <div className="p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Office Worker</p>
              <p className="mt-2 text-sm">
                Read access across the workspace. Event creation, event edits, and Operations/Manage edits require an
                administrator.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <UsersManager users={users} venues={venues} currentUserId={user.id} canEdit={canEdit} />
    </div>
  );
}
