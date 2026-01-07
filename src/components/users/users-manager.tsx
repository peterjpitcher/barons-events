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
import { FieldError } from "@/components/ui/field-error";
import { useRouter } from "next/navigation";
import { Send, Save } from "lucide-react";

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

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function UsersManager({ users, venues }: UsersManagerProps) {
  return (
    <div className="space-y-6">
      <InviteUserForm venues={venues} />
      <div className="space-y-4">
        <div className="grid gap-4 md:hidden">
          {users.map((user) => (
            <UserCardMobile key={user.id} user={user} venues={venues} />
          ))}
          {users.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-subtle">No workspace users yet.</CardContent>
            </Card>
          ) : null}
        </div>
        <UserDesktopList users={users} venues={venues} />
      </div>
    </div>
  );
}

function InviteUserForm({ venues }: { venues: VenueRow[] }) {
  const [state, formAction] = useActionState(inviteUserAction, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const emailError = state?.fieldErrors?.email;
  const roleError = state?.fieldErrors?.role;

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      formRef.current?.reset();
      router.refresh();
    } else if (!state.fieldErrors) {
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
        <form ref={formRef} action={formAction} className="grid gap-4 md:grid-cols-2" noValidate>
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              placeholder="name@example.com"
              required
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "invite-email-error" : undefined}
              className={emailError ? errorInputClass : undefined}
            />
            <FieldError id="invite-email-error" message={emailError} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-name">Full name (optional)</Label>
            <Input id="invite-name" name="fullName" placeholder="Add their preferred name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              id="invite-role"
              name="role"
              defaultValue="venue_manager"
              required
              aria-invalid={Boolean(roleError)}
              aria-describedby={roleError ? "invite-role-error" : undefined}
              className={roleError ? errorInputClass : undefined}
            >
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <FieldError id="invite-role-error" message={roleError} />
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

function UserCardMobile({ user, venues }: { user: AppUserRow; venues: VenueRow[] }) {
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
          <div className="md:col-span-2 flex justify-end">
            <SubmitButton
              label="Save changes"
              pendingLabel="Saving..."
              icon={<Save className="h-4 w-4" aria-hidden="true" />}
              hideLabel
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function UserDesktopList({ users, venues }: UsersManagerProps) {
  if (users.length === 0) {
    return (
      <div className="hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-white py-8 text-center text-subtle md:block">
        No workspace users yet.
      </div>
    );
  }

  return (
    <div className="hidden overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-white md:block">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_auto] gap-4 border-b border-[var(--color-border)] bg-[var(--color-muted-surface)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-subtle">
        <div>Name</div>
        <div>Email</div>
        <div>Role</div>
        <div>Linked venue</div>
        <div className="text-right">Actions</div>
      </div>
      <ul>
        {users.map((user, index) => (
          <UserDesktopRow key={user.id} user={user} venues={venues} isFirst={index === 0} />
        ))}
      </ul>
    </div>
  );
}

function UserDesktopRow({ user, venues, isFirst }: { user: AppUserRow; venues: VenueRow[]; isFirst: boolean }) {
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
    <li
      className={`border-[var(--color-border)] px-5 py-4 ${
        isFirst ? "border-b" : "border-y"
      } hover:bg-[rgba(39,54,64,0.03)]`}
    >
      <form action={formAction} className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_auto] items-center gap-4">
        <input type="hidden" name="userId" value={user.id} />
        <div className="flex flex-col gap-1">
          <label className="sr-only" htmlFor={`desktop-fullName-${user.id}`}>
            Full name
          </label>
          <Input
            id={`desktop-fullName-${user.id}`}
            name="fullName"
            defaultValue={user.full_name ?? ""}
            placeholder="Full name"
          />
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-subtle">Email</span>
          <p className="truncate text-sm text-[var(--color-text)]">{user.email}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="sr-only" htmlFor={`desktop-role-${user.id}`}>
            Role
          </label>
          <Select id={`desktop-role-${user.id}`} name="role" defaultValue={user.role}>
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="sr-only" htmlFor={`desktop-venue-${user.id}`}>
            Linked venue
          </label>
          <Select id={`desktop-venue-${user.id}`} name="venueId" defaultValue={user.venue_id ?? ""}>
            <option value="">No linked venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end">
          <SubmitButton
            label="Save changes"
            pendingLabel="Saving..."
            className="min-w-[6rem]"
            icon={<Save className="h-4 w-4" aria-hidden="true" />}
            hideLabel
          />
        </div>
      </form>
    </li>
  );
}
