"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { inviteUserAction, updateUserAction } from "@/actions/users";
import type { Database } from "@/lib/supabase/types";
import type { AppUserRow, EnrichedUser } from "@/lib/users";
import { formatRelativeTime } from "@/lib/datetime";
import { ResendInviteButton } from "@/components/users/resend-invite-button";
import { UserActionsMenu } from "@/components/users/user-actions-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/design-primitives";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError } from "@/components/ui/field-error";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Plus, Save } from "lucide-react";

type VenueRow = Database["public"]["Tables"]["venues"]["Row"];

type UsersManagerProps = {
  users: EnrichedUser[];
  venues: VenueRow[];
  currentUserId: string;
  canEdit: boolean;
};

const roleLabels: Record<string, string> = {
  administrator: "Administrator",
  manager: "Manager"
};

const errorInputClass = "!border-[var(--burgundy)] focus-visible:!border-[var(--burgundy)]";
const desktopUserGridClass =
  "grid-cols-[minmax(13rem,1.45fr)_minmax(13rem,1.25fr)_minmax(11rem,0.9fr)_minmax(13rem,1.15fr)_minmax(6rem,0.55fr)_minmax(7.5rem,auto)]";

function formatUserActivity(user: EnrichedUser): string {
  if (user.lastActiveAt) return `Last active ${formatRelativeTime(user.lastActiveAt)}`;
  if (user.lastSignInAt) return `Last sign-in ${formatRelativeTime(user.lastSignInAt)}`;
  return "No activity yet";
}

function venueLabelForUser(user: EnrichedUser, venues: VenueRow[]): string {
  if (!user.venue_id) return user.is_central_events_lead ? "Central events" : "All venues";
  return venues.find((venue) => venue.id === user.venue_id)?.name ?? "Linked venue";
}

export function UsersManager({ users, venues, currentUserId, canEdit }: UsersManagerProps) {
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="space-y-5">
      {canEdit ? (
        <>
          <div className="md:hidden">
            <Button type="button" variant="primary" className="h-11 w-full" onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Invite user
            </Button>
            <Sheet open={inviteOpen} onOpenChange={setInviteOpen}>
              <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Invite a new user</SheetTitle>
                </SheetHeader>
                <div className="p-5">
                  <InviteUserForm venues={venues} mobileSheet />
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <div className="hidden md:block">
            <InviteUserForm venues={venues} />
          </div>
        </>
      ) : null}
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

function InviteUserForm({ venues, mobileSheet = false }: { venues: VenueRow[]; mobileSheet?: boolean }) {
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
    <Card className={mobileSheet ? "border-0 shadow-none" : undefined}>
      <CardHeader className={mobileSheet ? "hidden" : undefined}>
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
              className={`${emailError ? errorInputClass : ""} h-12 text-[16px] md:h-10 md:text-sm`}
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
              className={`${fullNameError ? errorInputClass : ""} h-12 text-[16px] md:h-10 md:text-sm`}
            />
            <FieldError id="invite-name-error" message={fullNameError} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              id="invite-role"
              name="role"
              defaultValue="manager"
              required
              aria-invalid={Boolean(roleError)}
              aria-describedby={roleError ? "invite-role-error" : undefined}
              className={`${roleError ? errorInputClass : ""} h-12 text-[16px] md:h-10 md:text-sm`}
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
              className={`${venueIdError ? errorInputClass : ""} h-12 text-[16px] md:h-10 md:text-sm`}
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
            <SubmitButton label="Send invite" pendingLabel="Sending..." className="h-11 w-full xl:w-auto" />
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
  const displayName = user.full_name ?? user.email;
  const venueLabel = venueLabelForUser(user, venues);

  return (
    <article className={`mobile-card space-y-4 ${isDeactivated ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <Avatar name={displayName} size={44} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-[var(--ink)]">{displayName}</h2>
              <p className="truncate text-sm text-[var(--ink-muted)]">{user.email}</p>
            </div>
            {canEdit ? <UserActionsMenu user={user} currentUserId={currentUserId} /> : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--navy)] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-white">
              {roleLabels[user.role]}
            </span>
            <span className="rounded-full border border-[var(--hair)] bg-[var(--canvas-2)] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-[var(--ink-muted)]">
              {venueLabel}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${
                isDeactivated ? "bg-red-500" : user.emailConfirmedAt ? "bg-green-500" : "bg-amber-400"
              }`}
              aria-hidden="true"
            />
            <span className="text-xs text-[var(--ink-muted)]" suppressHydrationWarning>
              {isDeactivated ? "Deactivated" : user.emailConfirmedAt ? "Active" : "Pending"}
              {!isDeactivated && <>{" · "}{activityLabel}</>}
            </span>
          </div>
        </div>
      </div>
      {canEdit ? (
        <details className="rounded-[8px] border border-[var(--hair)] bg-[var(--canvas-2)] p-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">Edit access</summary>
          <form action={formAction} className="mt-3 grid gap-3">
            <input type="hidden" name="userId" value={user.id} />
            <div className="space-y-1.5">
              <Label htmlFor={`fullName-${user.id}`}>Full name</Label>
              <Input
                id={`fullName-${user.id}`}
                name="fullName"
                defaultValue={user.full_name ?? ""}
                placeholder="Full name"
                disabled={!canEdit}
                className="h-12 text-[16px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`role-${user.id}`}>Role</Label>
              <Select id={`role-${user.id}`} name="role" defaultValue={user.role} disabled={!canEdit} className="h-12 text-[16px]">
                {Object.entries(roleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`venue-${user.id}`}>Linked venue</Label>
              <Select id={`venue-${user.id}`} name="venueId" defaultValue={user.venue_id ?? ""} disabled={!canEdit} className="h-12 text-[16px]">
                <option value="">No linked venue</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                name="isCentralEventsLead"
                defaultChecked={user.is_central_events_lead}
                className="h-4 w-4 rounded border-[var(--hair)]"
                disabled={!canEdit}
              />
              <span>Central events lead</span>
            </label>
            <SubmitButton
              label="Save changes"
              pendingLabel="Saving..."
              icon={<Save className="h-4 w-4" aria-hidden="true" />}
              className="h-11 w-full"
            />
          </form>
        </details>
      ) : null}
      {canEdit && !user.emailConfirmedAt && !isDeactivated && (
        <ResendInviteButton
          userId={user.id}
          email={user.email}
          fullName={user.full_name}
        />
      )}
    </article>
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
            <span className="text-xs text-[var(--ink-muted)]" suppressHydrationWarning>
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
