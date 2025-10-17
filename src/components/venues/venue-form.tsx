"use client";

import { useFormState } from "react-dom";
import {
  createVenueAction,
  type VenueFormState,
  timezoneOptions,
  updateVenueAction,
} from "@/actions/venues";

type VenueFormValues = {
  name?: string;
  address?: string | null;
  region?: string | null;
  timezone?: string;
  capacity?: number | null;
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
  region: "",
  timezone: "Europe/London",
  capacity: null,
  venueId: "",
};

export function VenueForm(props: VenueFormProps) {
  const initialValues = {
    ...defaultValues,
    ...(props.initialValues ?? {}),
  };

  const action =
    props.mode === "create" ? createVenueAction : updateVenueAction;

  const actionHandler = async (
    state: VenueFormState,
    formData: FormData
  ) => (await action(state, formData)) ?? state;

  const [state, dispatch] = useFormState<VenueFormState, FormData>(
    actionHandler,
    {}
  );

  const submitLabel = props.mode === "create" ? "Create venue" : "Save changes";

  return (
    <form
      action={dispatch}
      className="space-y-6 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm"
    >
      {props.mode === "edit" ? (
        <input type="hidden" name="venueId" value={initialValues.venueId} />
      ) : null}

      <div className="space-y-2">
        <label
          htmlFor="name"
          className="text-sm font-medium text-black/80"
        >
          Venue name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={initialValues.name}
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
        />
        {state.fieldErrors?.name ? (
          <p className="text-xs text-red-600">{state.fieldErrors.name}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="address"
          className="text-sm font-medium text-black/80"
        >
          Address
        </label>
        <textarea
          id="address"
          name="address"
          rows={3}
          defaultValue={initialValues.address ?? ""}
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
        />
        {state.fieldErrors?.address ? (
          <p className="text-xs text-red-600">{state.fieldErrors.address}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor="region"
            className="text-sm font-medium text-black/80"
          >
            Region
          </label>
          <input
            id="region"
            name="region"
            defaultValue={initialValues.region ?? ""}
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          />
          {state.fieldErrors?.region ? (
            <p className="text-xs text-red-600">{state.fieldErrors.region}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="timezone"
            className="text-sm font-medium text-black/80"
          >
            Timezone
          </label>
          <select
            id="timezone"
            name="timezone"
            defaultValue={initialValues.timezone ?? "Europe/London"}
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          >
            {timezoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          {state.fieldErrors?.timezone ? (
            <p className="text-xs text-red-600">{state.fieldErrors.timezone}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="capacity"
          className="text-sm font-medium text-black/80"
        >
          Capacity
        </label>
        <input
          id="capacity"
          name="capacity"
          inputMode="numeric"
          pattern="[0-9]*"
          min={0}
          defaultValue={
            typeof initialValues.capacity === "number"
              ? String(initialValues.capacity)
              : ""
          }
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
        />
        <p className="text-xs text-black/50">
          Leave blank if unknown or not applicable.
        </p>
        {state.fieldErrors?.capacity ? (
          <p className="text-xs text-red-600">{state.fieldErrors.capacity}</p>
        ) : null}
      </div>

      {state.error ? (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
        >
          {submitLabel}
        </button>
        <span className="text-xs text-black/50">
          Changes save immediately for HQ planners.
        </span>
      </div>
    </form>
  );
}
