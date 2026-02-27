"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createServiceTypeAction,
  updateServiceTypeAction,
  deleteServiceTypeAction
} from "@/actions/opening-hours";
import type { ServiceTypeRow } from "@/lib/opening-hours";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError } from "@/components/ui/field-error";

type ManagerProps = {
  serviceTypes: ServiceTypeRow[];
};

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function ServiceTypesManager({ serviceTypes }: ManagerProps) {
  return (
    <div className="space-y-4">
      <CreateServiceTypeForm />
      {serviceTypes.length > 0 ? (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-white">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 border-b border-[var(--color-border)] bg-[var(--color-muted-surface)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
            <div>Service type</div>
            <div className="text-right">Save</div>
            <div className="text-right">Remove</div>
          </div>
          <ul>
            {serviceTypes.map((type) => (
              <ServiceTypeRow key={type.id} type={type} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-subtle">
          No service types yet. Add the first one above — these appear as rows in the weekly opening hours grid.
        </p>
      )}
    </div>
  );
}

function CreateServiceTypeForm() {
  const [state, formAction] = useActionState(createServiceTypeAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const nameError = state?.fieldErrors?.name;

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
    <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" noValidate>
      <div className="space-y-2">
        <Label htmlFor="new-service-type">Service type name</Label>
        <Input
          id="new-service-type"
          name="name"
          placeholder="e.g. Bar, Kitchen, Sunday Lunch"
          required
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? "new-service-type-error" : undefined}
          className={nameError ? errorInputClass : undefined}
        />
        <FieldError id="new-service-type-error" message={nameError} />
      </div>
      <div className="flex items-end">
        <SubmitButton label="Add type" pendingLabel="Saving…" />
      </div>
    </form>
  );
}

function ServiceTypeRow({ type }: { type: ServiceTypeRow }) {
  const [updateState, updateAction] = useActionState(updateServiceTypeAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteServiceTypeAction, undefined);
  const router = useRouter();
  const nameError = updateState?.fieldErrors?.name;
  const nameErrorId = `service-type-${type.id}-error`;

  useEffect(() => {
    if (!updateState?.message) return;
    if (updateState.success) {
      toast.success(updateState.message);
      router.refresh();
    } else if (!updateState.fieldErrors) {
      toast.error(updateState.message);
    }
  }, [updateState, router]);

  useEffect(() => {
    if (!deleteState?.message) return;
    if (deleteState.success) {
      toast.success(deleteState.message);
      router.refresh();
    } else {
      toast.error(deleteState.message);
    }
  }, [deleteState, router]);

  return (
    <li className="border-t border-[var(--color-border)] px-4 py-3">
      <form action={updateAction} noValidate>
        <input type="hidden" name="typeId" value={type.id} />
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-4">
          <div className="space-y-1">
            <label className="sr-only" htmlFor={`service-type-${type.id}`}>
              Service type name
            </label>
            <Input
              id={`service-type-${type.id}`}
              name="name"
              defaultValue={type.name}
              required
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? nameErrorId : undefined}
              className={nameError ? errorInputClass : undefined}
            />
            <FieldError id={nameErrorId} message={nameError} />
          </div>
          <SubmitButton label="Save" pendingLabel="Saving…" size="sm" variant="secondary" />
          <form action={deleteAction}>
            <input type="hidden" name="typeId" value={type.id} />
            <SubmitButton label="Remove" pendingLabel="Removing…" variant="destructive" size="sm" />
          </form>
        </div>
      </form>
    </li>
  );
}
