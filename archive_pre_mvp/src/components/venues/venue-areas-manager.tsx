"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import {
  createVenueAreaAction,
  updateVenueAreaAction,
  deleteVenueAreaAction,
  type VenueAreaFormState,
} from "@/actions/venues";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const initialAreaState: VenueAreaFormState = {};

type VenueArea = {
  id: string;
  name: string;
  capacity: number | null;
};

type VenueAreasManagerProps = {
  venueId: string;
  areas: VenueArea[];
};

const FieldError = ({ message }: { message?: string }) =>
  message ? (
    <p className="text-xs font-medium text-[var(--color-danger)]">{message}</p>
  ) : null;

const DeleteButton = () => {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={pending}>
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
};

function VenueAreaRow({ venueId, area }: { venueId: string; area: VenueArea }) {
  const [updateState, updateAction] = useActionState(
    async (_state: VenueAreaFormState | undefined, formData: FormData) =>
      (await updateVenueAreaAction(_state, formData)) ?? undefined,
    initialAreaState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (updateState === undefined) {
      formRef.current?.reset();
    }
  }, [updateState]);

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-[rgba(39,54,64,0.12)] bg-white px-4 py-3 shadow-soft md:flex-row md:items-center md:justify-between">
      <form
        ref={formRef}
        action={updateAction}
        className="flex flex-1 flex-col gap-2 md:flex-row md:items-center md:gap-3"
      >
        <input type="hidden" name="venueId" value={venueId} />
        <input type="hidden" name="areaId" value={area.id} />
        <div className="flex-1 space-y-1">
          <Input
            name="name"
            defaultValue={area.name}
            placeholder="Main Bar"
            required
          />
          <FieldError message={updateState?.fieldErrors?.name} />
        </div>
        <div className="w-full space-y-1 md:w-32">
          <Input
            name="capacity"
            defaultValue={typeof area.capacity === "number" ? String(area.capacity) : ""}
            placeholder="120"
          />
          <FieldError message={updateState?.fieldErrors?.capacity} />
        </div>
        <Button type="submit" size="sm">
          Save
        </Button>
      </form>
      <form
        action={async (formData: FormData) => {
          await deleteVenueAreaAction(formData);
        }}
        className="flex justify-end"
      >
        <input type="hidden" name="venueId" value={venueId} />
        <input type="hidden" name="areaId" value={area.id} />
        <DeleteButton />
      </form>
      {updateState?.error ? <FieldError message={updateState.error} /> : null}
    </li>
  );
}

export function VenueAreasManager({ venueId, areas }: VenueAreasManagerProps) {
  const [createState, createAction] = useActionState(
    async (_state: VenueAreaFormState | undefined, formData: FormData) =>
      (await createVenueAreaAction(_state, formData)) ?? undefined,
    initialAreaState
  );
  const createFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!createState || (!createState.error && !createState.fieldErrors)) {
      createFormRef.current?.reset();
    }
  }, [createState]);

  const sortedAreas = [...areas].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-[var(--color-primary-900)]">
          Venue areas
        </h3>
        <p className="text-sm text-subtle">
          Define individual spaces and capacities so events can reserve the right combination.
        </p>
      </div>

      <form
        ref={createFormRef}
        action={createAction}
        className="grid gap-3 rounded-lg border border-[rgba(39,54,64,0.12)] bg-white px-4 py-4 shadow-soft md:grid-cols-[minmax(0,1fr)_minmax(0,180px)_auto]"
      >
        <input type="hidden" name="venueId" value={venueId} />
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
            Area name
          </label>
          <Input name="name" placeholder="Snug Bar" required />
          <FieldError message={createState?.fieldErrors?.name} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle whitespace-nowrap">
            Capacity
          </label>
          <Input name="capacity" placeholder="80" inputMode="numeric" pattern="[0-9]*" />
          <p className="text-xs text-subtle">Optional</p>
          <FieldError message={createState?.fieldErrors?.capacity} />
        </div>
        <div className="flex items-end justify-end">
          <Button type="submit" size="sm">
            Add area
          </Button>
        </div>
        {createState?.error ? (
          <div className="md:col-span-3">
            <FieldError message={createState.error} />
          </div>
        ) : null}
      </form>

      {sortedAreas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[rgba(39,54,64,0.18)] bg-white/80 px-4 py-3 text-sm text-subtle">
          No areas yet. Add the main spaces so planners and reviewers can reserve them on events.
        </p>
      ) : (
        <ul className="space-y-3">
          {sortedAreas.map((area) => (
            <VenueAreaRow key={area.id} venueId={venueId} area={area} />
          ))}
        </ul>
      )}
    </section>
  );
}
