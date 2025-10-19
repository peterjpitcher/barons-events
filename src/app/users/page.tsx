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
        <CardContent>
          <p className="text-sm text-subtle">Invites send through Supabase auth instantly; role tweaks apply as soon as you save.</p>
        </CardContent>
      </Card>
      <UsersManager users={users} venues={venues} />
    </div>
  );
}
