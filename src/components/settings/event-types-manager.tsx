"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createEventTypeAction, updateEventTypeAction, deleteEventTypeAction } from "@/actions/event-types";
import type { EventTypeRow } from "@/lib/event-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError } from "@/components/ui/field-error";

type ManagerProps = {
  eventTypes: EventTypeRow[];
};

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function EventTypesManager({ eventTypes }: ManagerProps) {
  return (
    <div className="space-y-6">
      <CreateEventTypeForm />
      <div className="space-y-4">
        <div className="grid gap-4 md:hidden">
          {eventTypes.map((type) => (
            <EventTypeCardMobile key={type.id} type={type} />
          ))}
          {eventTypes.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-subtle">
                No event types yet. Add the first one above.
              </CardContent>
            </Card>
          ) : null}
        </div>
        <EventTypeDesktopList eventTypes={eventTypes} />
      </div>
    </div>
  );
}

function CreateEventTypeForm() {
  const [state, formAction] = useActionState(createEventTypeAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const labelError = state?.fieldErrors?.label;

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      formRef.current?.reset();
    } else if (!state.fieldErrors) {
      toast.error(state.message);
    }
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add an event type</CardTitle>
        <CardDescription>Keep the picklist current so venues choose consistent labels.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]" noValidate>
          <div className="space-y-2">
            <Label htmlFor="new-event-type">Event type name</Label>
            <Input
              id="new-event-type"
              name="label"
              placeholder="Tap Takeover"
              required
              aria-invalid={Boolean(labelError)}
              aria-describedby={labelError ? "new-event-type-error" : undefined}
              className={labelError ? errorInputClass : undefined}
            />
            <FieldError id="new-event-type-error" message={labelError} />
            <p className="text-xs text-subtle">Make it short and specific (e.g., Quiz, Charity Night).</p>
          </div>
          <div className="flex items-end">
            <SubmitButton label="Add type" pendingLabel="Saving..." />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EventTypeCardMobile({ type }: { type: EventTypeRow }) {
  const [updateState, updateAction] = useActionState(updateEventTypeAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteEventTypeAction, undefined);
  const router = useRouter();
  const labelError = updateState?.fieldErrors?.label;
  const labelErrorId = `event-type-${type.id}-error`;

  useEffect(() => {
    if (updateState?.message) {
      if (updateState.success) {
        toast.success(updateState.message);
        router.refresh();
      } else if (!updateState.fieldErrors) {
        toast.error(updateState.message);
      }
    }
  }, [updateState, router]);

  useEffect(() => {
    if (deleteState?.message) {
      if (deleteState.success) {
        toast.success(deleteState.message);
        router.refresh();
      } else {
        toast.error(deleteState.message);
      }
    }
  }, [deleteState, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg text-[var(--color-primary-700)]">{type.label}</CardTitle>
        <CardDescription>Last updated {new Date(type.created_at).toLocaleDateString("en-GB")}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={updateAction} className="space-y-3" noValidate>
          <input type="hidden" name="typeId" value={type.id} />
          <div className="space-y-2">
            <Label htmlFor={`event-type-${type.id}`}>Event type name</Label>
            <Input
              id={`event-type-${type.id}`}
              name="label"
              defaultValue={type.label}
              required
              aria-invalid={Boolean(labelError)}
              aria-describedby={labelError ? labelErrorId : undefined}
              className={labelError ? errorInputClass : undefined}
            />
            <FieldError id={labelErrorId} message={labelError} />
          </div>
          <SubmitButton label="Save" pendingLabel="Saving..." />
        </form>
        <form action={deleteAction} className="inline-flex">
          <input type="hidden" name="typeId" value={type.id} />
          <SubmitButton label="Remove" pendingLabel="Removing..." variant="destructive" />
        </form>
      </CardContent>
    </Card>
  );
}

function EventTypeDesktopList({ eventTypes }: { eventTypes: EventTypeRow[] }) {
  if (eventTypes.length === 0) {
    return (
      <div className="hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-white py-8 text-center text-subtle md:block">
        No event types yet. Add the first one above.
      </div>
    );
  }

  return (
    <div className="hidden overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-white md:block">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-4 border-b border-[var(--color-border)] bg-[var(--color-muted-surface)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-subtle">
        <div>Event type</div>
        <div>Added</div>
        <div className="text-right">Actions</div>
      </div>
      <ul>
        {eventTypes.map((type, index) => (
          <EventTypeDesktopRow key={type.id} type={type} isFirst={index === 0} />
        ))}
      </ul>
    </div>
  );
}

function EventTypeDesktopRow({ type, isFirst }: { type: EventTypeRow; isFirst: boolean }) {
  const [updateState, updateAction] = useActionState(updateEventTypeAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteEventTypeAction, undefined);
  const router = useRouter();
  const labelError = updateState?.fieldErrors?.label;
  const labelErrorId = `event-type-desktop-${type.id}-error`;

  useEffect(() => {
    if (updateState?.message) {
      if (updateState.success) {
        toast.success(updateState.message);
        router.refresh();
      } else if (!updateState.fieldErrors) {
        toast.error(updateState.message);
      }
    }
  }, [updateState, router]);

  useEffect(() => {
    if (deleteState?.message) {
      if (deleteState.success) {
        toast.success(deleteState.message);
        router.refresh();
      } else {
        toast.error(deleteState.message);
      }
    }
  }, [deleteState, router]);

  const formattedDate = new Date(type.created_at).toLocaleDateString("en-GB");

  return (
    <li
      className={`border-[var(--color-border)] px-5 py-4 ${
        isFirst ? "border-b" : "border-y"
      } hover:bg-[rgba(39,54,64,0.03)]`}
    >
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center gap-4">
        <form
          action={updateAction}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
          noValidate
        >
          <input type="hidden" name="typeId" value={type.id} />
          <div className="flex flex-col gap-1">
            <label className="sr-only" htmlFor={`event-type-desktop-${type.id}`}>
              Event type name
            </label>
            <Input
              id={`event-type-desktop-${type.id}`}
              name="label"
              defaultValue={type.label}
              required
              aria-invalid={Boolean(labelError)}
              aria-describedby={labelError ? labelErrorId : undefined}
              className={labelError ? errorInputClass : undefined}
            />
            <FieldError id={labelErrorId} message={labelError} />
          </div>
          <SubmitButton label="Save" pendingLabel="Saving..." className="justify-self-end" />
        </form>
        <p className="text-sm text-subtle">Added {formattedDate}</p>
        <form action={deleteAction} className="flex justify-end">
          <input type="hidden" name="typeId" value={type.id} />
          <SubmitButton label="Remove" pendingLabel="Removing..." variant="destructive" />
        </form>
      </div>
    </li>
  );
}
