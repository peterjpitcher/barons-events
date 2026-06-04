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
  canEdit: boolean;
};

const errorInputClass = "!border-[var(--burgundy)] focus-visible:!border-[var(--burgundy)]";

export function EventTypesManager({ eventTypes, canEdit }: ManagerProps) {
  return (
    <div className="space-y-5">
      {canEdit ? <CreateEventTypeForm /> : null}
      <div className="space-y-4">
        <div className="grid gap-4 md:hidden">
          {eventTypes.map((type) => (
            <EventTypeCardMobile key={type.id} type={type} canEdit={canEdit} />
          ))}
          {eventTypes.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-subtle">
                {canEdit ? "No event types yet. Add the first one above." : "No event types yet."}
              </CardContent>
            </Card>
          ) : null}
        </div>
        <EventTypeDesktopList eventTypes={eventTypes} canEdit={canEdit} />
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

function EventTypeCardMobile({ type, canEdit }: { type: EventTypeRow; canEdit: boolean }) {
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
        <CardTitle className="text-lg text-[var(--navy)]">{type.label}</CardTitle>
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
              disabled={!canEdit}
            />
            <FieldError id={labelErrorId} message={labelError} />
          </div>
          {canEdit ? <SubmitButton label="Save" pendingLabel="Saving..." /> : null}
        </form>
        {canEdit ? (
          <form action={deleteAction} className="inline-flex">
            <input type="hidden" name="typeId" value={type.id} />
            <SubmitButton label="Remove" pendingLabel="Removing..." variant="destructive" />
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EventTypeDesktopList({ eventTypes, canEdit }: { eventTypes: EventTypeRow[]; canEdit: boolean }) {
  if (eventTypes.length === 0) {
    return (
      <div className="hidden rounded-[var(--radius)] border border-[var(--hair)] bg-[var(--paper)] py-8 text-center text-subtle md:block">
        {canEdit ? "No event types yet. Add the first one above." : "No event types yet."}
      </div>
    );
  }

  return (
    <div className="hidden overflow-hidden rounded-[var(--radius)] border border-[var(--hair)] bg-[var(--paper)] md:block">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-4 border-b border-[var(--hair)] bg-[var(--canvas-2)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-subtle">
        <div>Event type</div>
        <div>Added</div>
        <div className="text-right">{canEdit ? "Actions" : ""}</div>
      </div>
      <ul>
        {eventTypes.map((type, index) => (
          <EventTypeDesktopRow key={type.id} type={type} isFirst={index === 0} canEdit={canEdit} />
        ))}
      </ul>
    </div>
  );
}

function EventTypeDesktopRow({ type, isFirst, canEdit }: { type: EventTypeRow; isFirst: boolean; canEdit: boolean }) {
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
      className={`border-[var(--hair)] px-5 py-4 ${
        isFirst ? "border-b" : "border-y"
      } hover:bg-[var(--paper-tint)]`}
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
              disabled={!canEdit}
            />
            <FieldError id={labelErrorId} message={labelError} />
          </div>
          {canEdit ? <SubmitButton label="Save" pendingLabel="Saving..." className="justify-self-end" /> : null}
        </form>
        <p className="text-sm text-subtle">Added {formattedDate}</p>
        {canEdit ? (
          <form action={deleteAction} className="flex justify-end">
            <input type="hidden" name="typeId" value={type.id} />
            <SubmitButton label="Remove" pendingLabel="Removing..." variant="destructive" />
          </form>
        ) : <span />}
      </div>
    </li>
  );
}
