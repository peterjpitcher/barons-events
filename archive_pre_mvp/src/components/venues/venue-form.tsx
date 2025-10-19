"use client";

import { useActionState, useState } from "react";
import {
  createVenueAction,
  type VenueFormState,
  updateVenueAction,
} from "@/actions/venues";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

type AreaDraft = {
  id: string;
  name: string;
  capacity: string;
};

const createAreaDraftId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `area-${Math.random().toString(36).slice(2, 10)}`;

type VenueFormValues = {
  name?: string;
  address?: string | null;
  venueId?: string;
};

type VenueFormProps =
  | {
      mode: "create";
      initialValues?: VenueFormValues;
    }
  | {
      mode: "edit";
      initialValues: VenueFormValues & { venueId: string };
    };

const defaultValues: Required<VenueFormValues> = {
  name: "",
  address: "",
  venueId: "",
};

export function VenueForm(props: VenueFormProps) {
  const initialValues: Required<VenueFormValues> = {
    ...defaultValues,
    ...(props.initialValues ?? {}),
  };

  const enableAreaSetup = props.mode === "create";
  const [areas, setAreas] = useState<AreaDraft[]>(
    enableAreaSetup
      ? [
          {
            id: createAreaDraftId(),
            name: "",
            capacity: "",
          },
        ]
      : []
  );

  const updateArea = (id: string, field: "name" | "capacity", value: string) => {
    setAreas((prev) =>
      prev.map((area) =>
        area.id === id
          ? {
              ...area,
              [field]: value,
            }
          : area
      )
    );
  };

  const handleAddArea = () => {
    setAreas((prev) => [
      ...prev,
      {
        id: createAreaDraftId(),
        name: "",
        capacity: "",
      },
    ]);
  };

  const handleRemoveArea = (id: string) => {
    setAreas((prev) => {
      if (prev.length === 1) {
        return prev.map((area) =>
          area.id === id
            ? {
                ...area,
                name: "",
                capacity: "",
              }
            : area
        );
      }
      return prev.filter((area) => area.id !== id);
    });
  };

  const action =
    props.mode === "create" ? createVenueAction : updateVenueAction;

  const actionHandler = async (
    state: VenueFormState,
    formData: FormData
  ) => (await action(state, formData)) ?? state;

  const [state, dispatch] = useActionState<VenueFormState, FormData>(
    actionHandler,
    {}
  );

  const submitLabel = props.mode === "create" ? "Create venue" : "Save changes";

  return (
    <form action={dispatch} className="space-y-8">
      {props.mode === "edit" ? (
        <input type="hidden" name="venueId" value={initialValues.venueId} />
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor="name"
            className="text-sm font-semibold uppercase tracking-[0.2em] text-subtle"
          >
            Venue name
          </label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={initialValues.name}
            placeholder="Barons Riverside"
          />
          {state.fieldErrors?.name ? (
            <p className="text-xs font-medium text-[var(--color-danger)]">
              {state.fieldErrors.name}
            </p>
          ) : null}
        </div>
      </div>
      <div className="space-y-2">
        <label
          htmlFor="address"
          className="text-sm font-semibold uppercase tracking-[0.2em] text-subtle"
        >
          Address
        </label>
        <Textarea
          id="address"
          name="address"
          rows={3}
          defaultValue={initialValues.address ?? ""}
          placeholder="1 Riverside Way, Reading, RG1 1AA"
        />
        {state.fieldErrors?.address ? (
          <p className="text-xs font-medium text-[var(--color-danger)]">
            {state.fieldErrors.address}
          </p>
        ) : null}
      </div>
      {enableAreaSetup ? (
        <section className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-[var(--color-primary-900)]">
              Venue areas
            </h3>
            <p className="text-sm text-subtle">
              Define the spaces and capacities now so planners can reserve them when drafting events. You can always adjust these after creation.
            </p>
          </div>

          {state.areaErrors && state.areaErrors.length > 0 ? (
            <Alert variant="danger" title="Check the area details">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {state.areaErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <div className="space-y-3">
            {areas.map((area) => {
              const isSingleRow = areas.length === 1;
              const isRowEmpty = area.name.trim().length === 0 && area.capacity.trim().length === 0;
              return (
                <div
                  key={area.id}
                  className="grid gap-3 rounded-lg border border-[rgba(39,54,64,0.12)] bg-white px-4 py-4 shadow-soft md:grid-cols-[minmax(0,1fr)_minmax(0,160px)_auto]"
                >
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                      Area name
                    </label>
                    <Input
                      name="areaName"
                      value={area.name}
                      onChange={(event) =>
                        updateArea(area.id, "name", event.target.value)
                      }
                      placeholder="Main Bar"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle whitespace-nowrap">
                      Capacity
                    </label>
                    <Input
                      name="areaCapacity"
                      value={area.capacity}
                      onChange={(event) =>
                        updateArea(area.id, "capacity", event.target.value)
                      }
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="120"
                    />
                    <p className="text-xs text-subtle">Optional</p>
                  </div>
                  <div className="flex items-end justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveArea(area.id)}
                      disabled={isSingleRow && isRowEmpty}
                    >
                      Remove
                    </Button>
                  </div>
              </div>
            );
          })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={handleAddArea}>
              Add another area
            </Button>
            <span className="text-xs text-subtle">
              Leave all rows blank if you don’t need areas yet.
            </span>
          </div>
        </section>
      ) : null}

      {state.error ? <Alert variant="danger" title={state.error} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{submitLabel}</Button>
        <span className="text-xs text-subtle">
          Changes save immediately for Central planners.
        </span>
      </div>
    </form>
  );
}
