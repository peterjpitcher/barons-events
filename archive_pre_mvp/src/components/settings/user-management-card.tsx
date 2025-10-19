"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createUserAction,
  createUserInitialState,
  type CreateUserFormState,
  type CreateUserFieldName,
} from "@/actions/users";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export type ManagedUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  venue?: { id: string; name: string | null } | null;
  created_at: string | null;
};

export type VenueOption = {
  id: string;
  name: string;
};

type UserManagementCardProps = {
  users: ManagedUser[];
  venues: VenueOption[];
};

const roleOptions = [
  {
    value: "venue_manager",
    label: "Venue manager",
    helper: "Creates and updates event drafts for an assigned venue.",
  },
  {
    value: "reviewer",
    label: "Reviewer",
    helper: "Reviews submissions, shares feedback, and records decisions.",
  },
  {
    value: "central_planner",
    label: "Central planner",
    helper: "Manages planning dashboards, calendars, and downstream exports.",
  },
  {
    value: "executive",
    label: "Executive",
    helper: "Receives digests and planning snapshots once approvals land.",
  },
] as const;


const formatRole = (role: string) =>
  role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatDate = (value: string | null) => {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return date.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
};

const FieldError = ({ field, state }: { field: CreateUserFieldName; state: CreateUserFormState }) => {
  const message = state.fieldErrors?.[field];
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-[var(--color-danger)]">{message}</p>;
};

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Creating account…" : "Create user"}
    </Button>
  );
};

export function UserManagementCard({ users, venues }: UserManagementCardProps) {
  const [formState, formAction] = useActionState(createUserAction, createUserInitialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedRole, setSelectedRole] = useState<string>("venue_manager");

  useEffect(() => {
    if (formState.status === "success") {
      formRef.current?.reset();
      setSelectedRole("venue_manager");
    }
  }, [formState.status]);

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bDate - aDate;
    });
  }, [users]);

  const showVenueSelect = selectedRole === "venue_manager";

  return (
    <Card className="bg-white/98">
      <CardHeader>
        <CardTitle>Manage workspace users</CardTitle>
        <CardDescription>
          Invite teammates, assign roles, and keep venue assignments aligned with planning.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {formState.status === "success" ? (
          <Alert variant="success" title="User created" description={formState.message}>
            {formState.temporaryPassword ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-[var(--color-primary-800)]">
                  Temporary password:
                </span>
                <code className="rounded bg-[rgba(42,79,168,0.08)] px-2 py-1 text-[var(--color-primary-800)]">
                  {formState.temporaryPassword}
                </code>
              </p>
            ) : null}
          </Alert>
        ) : null}

        {formState.status === "error" ? (
          <Alert variant="danger" title="Unable to create user" description={formState.message} />
        ) : null}

        <form
          ref={formRef}
          action={formAction}
          className="space-y-5 rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.12)] bg-white/95 p-6 shadow-soft"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                Email
              </label>
              <Input
                name="email"
                type="email"
                placeholder="teammate@barons.example"
                autoComplete="off"
                aria-invalid={Boolean(formState.fieldErrors?.email)}
              />
              <FieldError field="email" state={formState} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                Full name
              </label>
              <Input
                name="fullName"
                type="text"
                placeholder="Alex Planner"
                autoComplete="off"
                aria-invalid={Boolean(formState.fieldErrors?.fullName)}
              />
              <FieldError field="fullName" state={formState} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr),minmax(0,3fr)]">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                Role
              </label>
              <Select
                name="role"
                defaultValue={selectedRole}
                onChange={(event) => setSelectedRole(event.target.value)}
                aria-invalid={Boolean(formState.fieldErrors?.role)}
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError field="role" state={formState} />
            </div>
            <div className="rounded-[var(--radius)] border border-[rgba(39,54,64,0.1)] bg-[rgba(39,54,64,0.04)] px-4 py-3 text-sm text-muted">
              {roleOptions.find((option) => option.value === selectedRole)?.helper ??
                "Choose the role that matches how this teammate will work across the workspace."}
            </div>
          </div>

          {showVenueSelect ? (
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                Assigned venue
              </label>
              <Select
                name="venueId"
                defaultValue=""
                aria-invalid={Boolean(formState.fieldErrors?.venueId)}
              >
                <option value="">Select a venue…</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </Select>
              <FieldError field="venueId" state={formState} />
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                Venue managers need an assigned venue. Leave blank for other roles.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-[var(--color-primary-800)]">
              <input
                type="checkbox"
                name="sendInvite"
                defaultChecked
                className="h-4 w-4 rounded border border-[var(--color-border)] text-[var(--color-primary-600)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(42,79,168,0.45)]"
              />
              Send invite email so they set their own password
            </label>
            <SubmitButton />
          </div>

          <p className="text-xs text-muted">
            We’ll automatically assign the correct Supabase role and add them to the internal users directory once the account is created.
          </p>
        </form>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--color-primary-900)]">
              Recent workspace users
            </h3>
            <Badge variant="neutral">{users.length}</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[rgba(39,54,64,0.12)] text-sm">
              <thead className="bg-[rgba(39,54,64,0.05)] text-left uppercase tracking-[0.25em] text-[11px] text-subtle">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Venue</th>
                  <th className="px-4 py-3">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(39,54,64,0.08)]">
                {sortedUsers.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-muted" colSpan={5}>
                      No other users found yet. New accounts will appear here once created.
                    </td>
                  </tr>
                ) : (
                  sortedUsers.map((user) => {
                    const displayName = user.full_name?.length ? user.full_name : "—";
                    const roleLabel = formatRole(user.role);
                    const venueLabel = user.venue?.name ?? "—";

                    return (
                      <tr key={user.id} className="bg-white/70 hover:bg-[rgba(39,54,64,0.05)]">
                        <td className="px-4 py-3 font-medium text-[var(--color-primary-900)]">
                          {displayName}
                        </td>
                        <td className="px-4 py-3 text-[var(--color-primary-700)]">
                          <a
                            href={`mailto:${user.email}`}
                            className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-primary-900)]"
                          >
                            {user.email}
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="info">{roleLabel}</Badge>
                        </td>
                        <td className="px-4 py-3 text-[var(--color-primary-700)]">{venueLabel}</td>
                        <td className="px-4 py-3 text-[var(--color-primary-700)]">
                          {formatDate(user.created_at)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
