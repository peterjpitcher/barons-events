"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { inviteUserAction, updateUserAction } from "@/actions/users";
import type { Database } from "@/lib/supabase/types";
import type { AppUserRow, EnrichedUser } from "@/lib/users";
import { formatRelativeTime } from "@/lib/datetime";
import { ResendInviteButton } from "@/components/users/resend-invite-button";
import { UserActionsMenu } from "@/components/users/user-actions-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError } from "@/components/ui/field-error";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";

type VenueRow = Database["public"]["Tables"]["venues"]["Row"];

type UsersManagerProps = {
  users: EnrichedUser[];
  venues: VenueRow[];
  currentUserId: string;
  canEdit: boolean;
};

const roleLabels: Record<AppUserRow["role"], string> = {
  administrator: "Administrator",
  office_worker: "Office Worker",
  executive: "Executive"
};

const errorInputClass = "!border-[var(--burgundy)] focus-visible:!border-[var(--burgundy)]";
const desktopUserGridClass =
  "grid-cols-[minmax(13rem,1.45fr)_minmax(13rem,1.25fr)_minmax(11rem,0.9fr)_minmax(13rem,1.15fr)_minmax(6rem,0.55fr)_minmax(7.5rem,auto)]";

function formatUserActivity(user: EnrichedUser): string {
  if (user.lastActiveAt) return `Last active ${formatRelativeTime(user.lastActiveAt)}`;
  if (user.lastSignInAt) return `Last sign-in ${formatRelativeTime(user.lastSignInAt)}`;
  return "No activity yet";
}

export function UsersManager({ users, venues, currentUserId, canEdit }: UsersManagerProps) {
  return (
    <div className="space-y-5">
      {canEdit ? <InviteUserForm venues={venues} /> : null}
      <div className="space-y-4">
        <div className="grid gap-4 md:hidden">
          {users.map((user) => (
            <UserCardMobile key={user.id} user={user} venues={venues} currentUserId={currentUserId} canEdit={canEdit} />
          ))}
          {users.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-subtle">No workspace users yet.</CardContent>
            </Card>
          ) : null}
        </div>
        <UserDesktopList users={users} venues={venues} currentUserId={currentUserId} canEdit={canEdit} />
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
  const fullNameError = state?.fieldErrors?.fullName;
  const venueIdError = state?.fieldErrors?.venueId;

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
        <form
          ref={formRef}
          action={formAction}
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(11rem,0.75fr)_minmax(14rem,1fr)_auto] xl:items-start"
          noValidate
        >
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
            <Input
              id="invite-name"
              name="fullName"
              placeholder="Add their preferred name"
              aria-invalid={Boolean(fullNameError)}
              aria-describedby={fullNameError ? "invite-name-error" : undefined}
              className={fullNameError ? errorInputClass : undefined}
            />
            <FieldError id="invite-name-error" message={fullNameError} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              id="invite-role"
              name="role"
              defaultValue="office_worker"
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
            <Select
              id="invite-venue"
              name="venueId"
              defaultValue=""
              aria-invalid={Boolean(venueIdError)}
              aria-describedby={venueIdError ? "invite-venue-error" : undefined}
              className={venueIdError ? errorInputClass : undefined}
            >
              <option value="">No linked venue</option>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </Select>
            <FieldError id="invite-venue-error" message={venueIdError} />
          </div>
          <div className="md:col-span-2 xl:col-span-1 xl:flex xl:h-full xl:items-end xl:justify-end">
            <SubmitButton label="Send invite" pendingLabel="Sending..." className="w-full xl:w-auto" />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function UserCardMobile({
  user,
  venues,
  currentUserId,
  canEdit
}: {
  user: EnrichedUser;
  venues: VenueRow[];
  currentUserId: string;
  canEdit: boolean;
}) {
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

  const isDeactivated = Boolean(user.deactivated_at);
  const activityLabel = formatUserActivity(user);

  return (
    <Card className={isDeactivated ? "opacity-60" : undefined}>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="flex-1 min-w-0">
          <CardTitle className="text-lg text-[var(--navy)]">{user.full_name ?? user.email}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${
                isDeactivated ? "bg-red-500" : user.emailConfirmedAt ? "bg-green-500" : "bg-amber-400"
              }`}
              aria-hidden="true"
            />
            <span className="text-xs text-[var(--ink-muted)]">
              {isDeactivated ? "Deactivated" : user.emailConfirmedAt ? "Active" : "Pending"}
              {!isDeactivated && <>{" · "}{activityLabel}</>}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <p className="flex-shrink-0 rounded-full bg-muted-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            {roleLabels[user.role]}
          </p>
          {canEdit ? <UserActionsMenu user={user} currentUserId={currentUserId} /> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={formAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="userId" value={user.id} />
          <div className="space-y-2">
            <Label htmlFor={`fullName-${user.id}`}>Full name</Label>
            <Input
              id={`fullName-${user.id}`}
              name="fullName"
              defaultValue={user.full_name ?? ""}
              placeholder="Full name"
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`role-${user.id}`}>Role</Label>
            <Select id={`role-${user.id}`} name="role" defaultValue={user.role} disabled={!canEdit}>
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={`venue-${user.id}`}>Linked venue (optional)</Label>
            <Select id={`venue-${user.id}`} name="venueId" defaultValue={user.venue_id ?? ""} disabled={!canEdit}>
              <option value="">No linked venue</option>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--canvas-2)] px-3 py-2 text-sm text-[var(--ink)] md:col-span-2">
            <input
              type="checkbox"
              name="isCentralEventsLead"
              defaultChecked={user.is_central_events_lead}
              className="h-4 w-4 rounded border-[var(--hair)]"
              disabled={!canEdit}
            />
            <span>Central events lead</span>
          </label>
          {canEdit ? (
            <div className="md:col-span-2 flex justify-end">
              <SubmitButton
                label="Save changes"
                pendingLabel="Saving..."
                icon={<Save className="h-4 w-4" aria-hidden="true" />}
                hideLabel
                size="icon"
              />
            </div>
          ) : null}
        </form>
        {canEdit && !user.emailConfirmedAt && !isDeactivated && (
          <ResendInviteButton
            userId={user.id}
            email={user.email}
            fullName={user.full_name}
          />
        )}
      </CardContent>
    </Card>
  );
}

function UserDesktopList({ users, venues, currentUserId, canEdit }: UsersManagerProps) {
  if (users.length === 0) {
    return (
      <div className="hidden rounded-[var(--radius)] border border-[var(--hair)] bg-[var(--paper)] py-8 text-center text-subtle md:block">
        No workspace users yet.
      </div>
    );
  }

  return (
    <div className="hidden overflow-x-auto rounded-[var(--radius)] border border-[var(--hair)] bg-[var(--paper)] shadow-card md:block">
      <div className="min-w-[1080px]">
        <div className={`grid ${desktopUserGridClass} gap-4 border-b border-[var(--hair)] bg-[var(--canvas-2)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-subtle`}>
          <div>Name</div>
          <div>Email</div>
          <div>Role</div>
          <div>Linked venue</div>
          <div>Lead</div>
          <div className="text-right">Actions</div>
        </div>
        <ul className="divide-y divide-[var(--hair)]">
          {users.map((user) => (
            <UserDesktopRow
              key={user.id}
              user={user}
              venues={venues}
              currentUserId={currentUserId}
              canEdit={canEdit}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function UserDesktopRow({
  user,
  venues,
  currentUserId,
  canEdit
}: {
  user: EnrichedUser;
  venues: VenueRow[];
  currentUserId: string;
  canEdit: boolean;
}) {
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

  const isDeactivated = Boolean(user.deactivated_at);
  const activityLabel = formatUserActivity(user);

  return (
    <li
      className={`px-5 py-3 transition-colors hover:bg-[var(--paper-tint)] ${isDeactivated ? "opacity-60" : ""}`}
    >
      <form action={formAction} className={`grid ${desktopUserGridClass} items-start gap-4`}>
        <input type="hidden" name="userId" value={user.id} />
        <div className="min-w-0 space-y-1">
          <label className="sr-only" htmlFor={`desktop-fullName-${user.id}`}>
            Full name
          </label>
          <Input
            id={`desktop-fullName-${user.id}`}
            name="fullName"
            defaultValue={user.full_name ?? ""}
            placeholder="Full name"
            disabled={!canEdit}
          />
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${
                isDeactivated ? "bg-red-500" : user.emailConfirmedAt ? "bg-green-500" : "bg-amber-400"
              }`}
              aria-hidden="true"
            />
            <span className="text-xs text-[var(--ink-muted)]">
              {isDeactivated ? "Deactivated" : user.emailConfirmedAt ? "Active" : "Pending"}
              {!isDeactivated && <>{" · "}{activityLabel}</>}
            </span>
          </div>
        </div>
        <div className="min-w-0 pt-2">
          <p className="truncate text-sm text-[var(--ink)]" title={user.email}>
            {user.email}
          </p>
        </div>
        <div className="min-w-0">
          <label className="sr-only" htmlFor={`desktop-role-${user.id}`}>
            Role
          </label>
          <Select id={`desktop-role-${user.id}`} name="role" defaultValue={user.role} disabled={!canEdit}>
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-0">
          <label className="sr-only" htmlFor={`desktop-venue-${user.id}`}>
            Linked venue
          </label>
          <Select id={`desktop-venue-${user.id}`} name="venueId" defaultValue={user.venue_id ?? ""} disabled={!canEdit}>
            <option value="">No linked venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="inline-flex items-center gap-2 pt-2 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            name="isCentralEventsLead"
            defaultChecked={user.is_central_events_lead}
            className="h-4 w-4 rounded border-[var(--hair)]"
            disabled={!canEdit}
          />
          <span className="sr-only">Central events lead</span>
          <span aria-hidden="true">{user.is_central_events_lead ? "Lead" : "No"}</span>
        </label>
        <div className="flex min-w-0 items-start justify-end gap-2 pt-0.5">
          {canEdit ? (
            <>
              <SubmitButton
                label="Save changes"
                pendingLabel="Saving..."
                icon={<Save className="h-4 w-4" aria-hidden="true" />}
                hideLabel
                size="icon"
              />
              <UserActionsMenu user={user} currentUserId={currentUserId} />
            </>
          ) : null}
        </div>
      </form>
      {canEdit && !user.emailConfirmedAt && !isDeactivated && (
        <div className={`mt-2 grid ${desktopUserGridClass} gap-4`}>
          <div>
            <ResendInviteButton
              userId={user.id}
              email={user.email}
              fullName={user.full_name}
            />
          </div>
        </div>
      )}
    </li>
  );
}
