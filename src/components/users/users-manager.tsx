"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { inviteUserAction, updateUserAction } from "@/actions/users";
import type { Database } from "@/lib/supabase/types";
import type { AppUserRow } from "@/lib/users";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { useRouter } from "next/navigation";

type VenueRow = Database["public"]["Tables"]["venues"]["Row"];

type UsersManagerProps = {
  users: AppUserRow[];
  venues: VenueRow[];
};

const roleLabels: Record<AppUserRow["role"], string> = {
  central_planner: "Central planner",
  venue_manager: "Venue manager",
  reviewer: "Reviewer",
  executive: "Executive"
};

export function UsersManager({ users, venues }: UsersManagerProps) {
  return (
    <div className="space-y-6">
      <InviteUserForm venues={venues} />
      <div className="grid gap-4">
        {users.map((user) => (
          <UserCard key={user.id} user={user} venues={venues} />
        ))}
        {users.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-subtle">No workspace users yet.</CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function InviteUserForm({ venues }: { venues: VenueRow[] }) {
  const [state, formAction] = useActionState(inviteUserAction, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      formRef.current?.reset();
      router.refresh();
    } else {
      toast.error(state.message);
    }
  }, [state, router]);

  return ( 
    <Card>
      <CardHeader>
        <CardTitle>Invite a new user</CardTitle>
        <CardDescription>Send an email invite and set their initial role and venue link.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" name="email" type="email" placeholder="name@example.com" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-name">Full name (optional)</Label>
            <Input id="invite-name" name="fullName" placeholder="Add their preferred name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select id="invite-role" name="role" defaultValue="venue_manager" required>
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-venue">Linked venue (optional)</Label>
            <Select id="invite-venue" name="venueId" defaultValue="">
              <option value="">No linked venue</option>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <SubmitButton label="Send invite" pendingLabel="Sending..." />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function UserCard({ user, venues }: { user: AppUserRow; venues: VenueRow[] }) {
  const [state, formAction] = useActionState(updateUserAction, undefined);
  const router = useRouter();

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      router.refresh();
    } else {
      toast.error(state.message);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle className="text-lg text-[var(--color-primary-700)]">{user.full_name ?? user.email}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </div>
        <p className="rounded-full bg-muted-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {roleLabels[user.role]}
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="userId" value={user.id} />
          <div className="space-y-2">
            <Label htmlFor={`fullName-${user.id}`}>Full name</Label>
            <Input
              id={`fullName-${user.id}`}
              name="fullName"
              defaultValue={user.full_name ?? ""}
              placeholder="Full name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`role-${user.id}`}>Role</Label>
            <Select id={`role-${user.id}`} name="role" defaultValue={user.role}>
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={`venue-${user.id}`}>Linked venue (optional)</Label>
            <Select id={`venue-${user.id}`} name="venueId" defaultValue={user.venue_id ?? ""}>
              <option value="">No linked venue</option>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <SubmitButton label="Save changes" pendingLabel="Saving..." />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
