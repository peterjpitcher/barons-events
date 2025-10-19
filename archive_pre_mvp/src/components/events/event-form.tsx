"use client";

import { ChangeEvent, useActionState, useEffect, useMemo, useState } from "react";
import {
  createEventDraftAction,
  updateEventDraftAction,
  type EventFormState,
} from "@/actions/events";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

type VenueAreaOption = {
  id: string;
  name: string;
  capacity: number | null;
};

type VenueOption = {
  id: string;
  name: string;
  areas: VenueAreaOption[];
};

type EventInitialValues = {
  title: string;
  venueId: string;
  startAt: string | null;
  endAt: string | null;
  areaIds: string[];
};

type EventFormMode = "create" | "edit";

type EventFormProps = {
  mode?: EventFormMode;
  eventId?: string;
  initialValues?: EventInitialValues;
  venues: VenueOption[];
  reviewerQueueCount?: number;
};

type LocalErrors = Partial<
  Record<"title" | "venueId" | "startAt" | "endAt" | "areaIds", string>
>;

const initialState: EventFormState | undefined = undefined;

const createActionHandler = async (
  _state: EventFormState | undefined,
  formData: FormData
) => (await createEventDraftAction(formData)) ?? undefined;

const updateActionHandler = async (
  _state: EventFormState | undefined,
  formData: FormData
) => (await updateEventDraftAction(formData)) ?? undefined;

const steps = [
  {
    id: "basics",
    title: "Basics",
    description: "Name the event and confirm the venue owner.",
  },
  {
    id: "schedule",
    title: "Schedule",
    description: "Pin down timings and reserve the required spaces.",
  },
  {
    id: "review",
    title: "Review",
    description: "Double-check details before saving or submitting.",
  },
] as const;

const formatSummaryValue = (value: string | null | undefined) => {
  if (!value) return "Not set";
  return value;
};

const formatDateTimeForInput = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

export function EventForm({
  mode = "create",
  eventId,
  initialValues,
  venues,
  reviewerQueueCount = 0,
}: EventFormProps) {
  const actionHandler = mode === "edit" ? updateActionHandler : createActionHandler;
  const [state, dispatch] = useActionState(actionHandler, initialState);

  const isEditMode = mode === "edit";

  if (isEditMode && !eventId) {
    throw new Error("EventForm requires an eventId when rendered in edit mode.");
  }

  const hasVenues = venues.length > 0;
  const initialVenueId = useMemo(() => {
    if (isEditMode && initialValues?.venueId) {
      return initialValues.venueId;
    }
    return hasVenues ? venues[0]?.id ?? "" : "";
  }, [hasVenues, venues, initialValues?.venueId, isEditMode]);

  const initialAreaSource = initialValues?.areaIds;
  const initialAreaIds = useMemo(() => {
    if (!initialAreaSource) {
      return [] as string[];
    }
    return [...initialAreaSource];
  }, [initialAreaSource]);

  const defaultInitialValues: EventInitialValues = {
    title: initialValues?.title ?? "",
    venueId: initialValues?.venueId ?? initialVenueId,
    startAt: initialValues?.startAt ?? null,
    endAt: initialValues?.endAt ?? null,
    areaIds: initialAreaIds,
  };

  const [stepIndex, setStepIndex] = useState(0);
  const [formValues, setFormValues] = useState(() => ({
    title: isEditMode ? defaultInitialValues.title : "",
    venueId: defaultInitialValues.venueId,
    startAt: isEditMode ? formatDateTimeForInput(defaultInitialValues.startAt) : "",
    endAt: isEditMode ? formatDateTimeForInput(defaultInitialValues.endAt) : "",
  }));
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>(() =>
    isEditMode ? [...initialAreaIds] : []
  );
  const [localErrors, setLocalErrors] = useState<LocalErrors>({});

  useEffect(() => {
    if (isEditMode && initialValues) {
      setFormValues({
        title: defaultInitialValues.title,
        venueId: defaultInitialValues.venueId,
        startAt: formatDateTimeForInput(defaultInitialValues.startAt),
        endAt: formatDateTimeForInput(defaultInitialValues.endAt),
      });
      setSelectedAreaIds([...initialAreaIds]);
      setLocalErrors({});
    }
  }, [
    isEditMode,
    initialValues,
    defaultInitialValues.title,
    defaultInitialValues.venueId,
    defaultInitialValues.startAt,
    defaultInitialValues.endAt,
    initialAreaIds,
  ]);

  useEffect(() => {
    if (!isEditMode) {
      setFormValues((prev) => ({
        ...prev,
        venueId: initialVenueId,
      }));
      setSelectedAreaIds([]);
      setLocalErrors((prev) => {
        if (!prev.areaIds) {
          return prev;
        }
        const { areaIds: _removedAreaIds, ...rest } = prev;
        void _removedAreaIds;
        return rest;
      });
    }
  }, [initialVenueId, isEditMode]);

  useEffect(() => {
    if (state?.fieldErrors) {
      if (state.fieldErrors.title) {
        setStepIndex(0);
      } else if (state.fieldErrors.venueId || state.fieldErrors.startAt || state.fieldErrors.endAt) {
        setStepIndex(1);
      }
    }
  }, [state]);

  const currentVenue = useMemo(
    () => venues.find((venue) => venue.id === formValues.venueId) ?? null,
    [formValues.venueId, venues]
  );
  const availableAreas = currentVenue?.areas ?? [];

  useEffect(() => {
    if (!currentVenue) {
      setSelectedAreaIds([]);
      return;
    }

    setSelectedAreaIds((prev) =>
      prev.filter((areaId) => currentVenue.areas.some((area) => area.id === areaId))
    );
  }, [currentVenue]);

  const handleFieldChange = (
    field: "title" | "venueId" | "startAt" | "endAt"
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setFormValues((prev) => ({
      ...prev,
      [field]: value,
    }));
    if (field === "venueId") {
      setSelectedAreaIds([]);
    }
    setLocalErrors((prev) => {
      const updated = { ...prev };
      delete updated[field];
      if (field === "venueId" && updated.areaIds) {
        delete updated.areaIds;
      }
      return updated;
    });
  };

  const validateStep = () => {
    const errors: LocalErrors = {};

    if (stepIndex === 0) {
      if (!formValues.title || formValues.title.trim().length < 3) {
        errors.title = "Add a descriptive title (min 3 characters).";
      }
      if (!formValues.venueId) {
        errors.venueId = "Select the venue running this event.";
      }
    }

    if (stepIndex === 1) {
      if (!formValues.startAt) {
        errors.startAt = "Choose a start date and time.";
      }
      if (availableAreas.length > 0 && selectedAreaIds.length === 0) {
        errors.areaIds = "Select at least one area for this venue.";
      }
    }

    setLocalErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const goNext = () => {
    if (!validateStep()) {
      return;
    }
    setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const goBack = () => {
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const areaSummary = selectedAreaIds
    .map((areaId) => currentVenue?.areas.find((area) => area.id === areaId)?.name ?? "")
    .filter((name) => name.length > 0);

  const summaryItems = [
    { label: "Event title", value: formatSummaryValue(formValues.title) },
    {
      label: "Venue",
      value: formatSummaryValue(
        venues.find((venue) => venue.id === formValues.venueId)?.name
      ),
    },
    {
      label: "Start",
      value: formValues.startAt
        ? new Date(formValues.startAt).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "Not set",
    },
    {
      label: "End",
      value: formValues.endAt
        ? new Date(formValues.endAt).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "Not set",
    },
    {
      label: "Venue areas",
      value: areaSummary.length > 0 ? areaSummary.join(", ") : "Not selected",
    },
  ];

  const areaFieldError = state?.fieldErrors?.areaIds;
  const areaErrorMessage = localErrors.areaIds ?? areaFieldError;

  return (
    <form action={dispatch} className="space-y-8">
      {isEditMode ? <input type="hidden" name="eventId" value={eventId ?? ""} /> : null}
      <input type="hidden" name="title" value={formValues.title} />
      <input type="hidden" name="venueId" value={formValues.venueId} />
      <input type="hidden" name="startAt" value={formValues.startAt} />
      <input type="hidden" name="endAt" value={formValues.endAt} />
      {selectedAreaIds.map((areaId) => (
        <input key={areaId} type="hidden" name="areaIds" value={areaId} />
      ))}

      <div className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-[var(--color-primary-900)]">
            {isEditMode ? "Update event draft" : "Create event draft"}
          </h2>
          <p className="text-sm leading-relaxed text-subtle">
            {isEditMode
              ? "Refresh the essentials so the draft stays accurate before you resubmit for review."
              : "Guided flow for venue managers and planners to capture event essentials before submitting for review."}
          </p>
        </div>

        <ol className="flex flex-wrap items-center gap-4 text-sm" aria-label="Event draft steps">
          {steps.map((step, index) => {
            const isActive = index === stepIndex;
            const isCompleted = index < stepIndex;
            return (
              <li key={step.id} className="flex items-center gap-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition ${
                    isActive
                      ? "border-[var(--color-primary-700)] bg-[var(--color-primary-700)] text-white shadow-soft"
                      : isCompleted
                        ? "border-[rgba(47,143,104,0.4)] bg-[rgba(47,143,104,0.1)] text-[var(--color-success)]"
                        : "border-[rgba(39,54,64,0.25)] text-subtle"
                  }`}
                >
                  {index + 1}
                </div>
                <div className="flex flex-col">
                  <span
                    className={`text-xs font-semibold uppercase tracking-[0.25em] ${
                      isActive ? "text-[var(--color-primary-900)]" : "text-subtle"
                    }`}
                  >
                    {step.title}
                  </span>
                  <span className="text-xs text-subtle">{step.description}</span>
                </div>
                {index < steps.length - 1 ? (
                  <span className="hidden h-px w-10 border-t border-dashed border-[rgba(39,54,64,0.2)] sm:block" />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      {!hasVenues ? (
        <Alert
          variant="warning"
          title={isEditMode ? "Venue list unavailable" : "Add venues to enable drafts"}
          description={
            isEditMode
              ? "We couldn’t load the venue you need for this draft. Check your access or ask a Central planner to restore it."
              : "Create venue records first so drafts can attach to the right locations."
          }
        />
      ) : null}

      <div className={stepIndex === 0 ? "space-y-6" : "hidden"}>
        <div className="space-y-2">
          <label
            htmlFor="title"
            className="text-sm font-semibold uppercase tracking-[0.2em] text-subtle"
          >
            Event title
          </label>
          <Input
            id="title"
            value={formValues.title}
            onChange={handleFieldChange("title")}
            placeholder="Summer beer festival"
            required
          />
          {localErrors.title ? (
            <p className="text-xs font-medium text-[var(--color-danger)]">{localErrors.title}</p>
          ) : state?.fieldErrors?.title ? (
            <p className="text-xs font-medium text-[var(--color-danger)]">
              {state.fieldErrors.title}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="venueId"
            className="text-sm font-semibold uppercase tracking-[0.2em] text-subtle"
          >
            Venue
          </label>
          <Select
            id="venueId"
            value={formValues.venueId}
            onChange={handleFieldChange("venueId")}
            disabled={!hasVenues}
          >
            <option value="">Select a venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </Select>
          {localErrors.venueId ? (
            <p className="text-xs font-medium text-[var(--color-danger)]">{localErrors.venueId}</p>
          ) : state?.fieldErrors?.venueId ? (
            <p className="text-xs font-medium text-[var(--color-danger)]">
              {state.fieldErrors.venueId}
            </p>
          ) : null}
        </div>
      </div>

      <div className={stepIndex === 1 ? "space-y-6" : "hidden"}>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="startAt"
              className="text-sm font-semibold uppercase tracking-[0.2em] text-subtle"
            >
              Start date &amp; time
            </label>
            <Input
              id="startAt"
              type="datetime-local"
              value={formValues.startAt}
              onChange={handleFieldChange("startAt")}
              required
            />
            {localErrors.startAt ? (
              <p className="text-xs font-medium text-[var(--color-danger)]">
                {localErrors.startAt}
              </p>
            ) : state?.fieldErrors?.startAt ? (
              <p className="text-xs font-medium text-[var(--color-danger)]">
                {state.fieldErrors.startAt}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="endAt"
              className="text-sm font-semibold uppercase tracking-[0.2em] text-subtle"
            >
              End date &amp; time (optional)
            </label>
            <Input
              id="endAt"
              type="datetime-local"
              value={formValues.endAt}
              onChange={handleFieldChange("endAt")}
            />
            {state?.fieldErrors?.endAt ? (
              <p className="text-xs font-medium text-[var(--color-danger)]">
                {state.fieldErrors.endAt}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold uppercase tracking-[0.2em] text-subtle">
            Venue areas
          </label>
          {availableAreas.length === 0 ? (
            <p className="text-xs text-subtle">
              No areas are configured for this venue yet. Ask central planning to add areas if you need to reserve a specific space.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {availableAreas.map((area) => {
                const checked = selectedAreaIds.includes(area.id);
                const capacityLabel =
                  typeof area.capacity === "number"
                    ? `Capacity ${area.capacity}`
                    : "Capacity unknown";
                return (
                  <label
                    key={area.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition ${
                      checked
                        ? "border-[var(--color-primary-500)] bg-[rgba(39,54,64,0.06)]"
                        : "border-[rgba(39,54,64,0.12)] hover:border-[var(--color-primary-300)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary-700)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
                      checked={checked}
                      onChange={(event) => {
                        setSelectedAreaIds((prev) => {
                          if (event.target.checked) {
                            return [...prev, area.id];
                          }
                          return prev.filter((id) => id !== area.id);
                        });
                        setLocalErrors((prev) => {
                          if (!prev.areaIds) {
                            return prev;
                          }
                          const { areaIds: _removedAreaIds, ...rest } = prev;
                          void _removedAreaIds;
                          return rest;
                        });
                      }}
                    />
                    <div className="space-y-1 text-sm">
                      <p className="font-semibold text-[var(--color-primary-900)]">
                        {area.name}
                      </p>
                      <p className="text-xs text-subtle">{capacityLabel}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          {areaErrorMessage ? (
            <p className="text-xs font-medium text-[var(--color-danger)]">
              {areaErrorMessage}
            </p>
          ) : null}
        </div>
      </div>

      <div className={stepIndex === 2 ? "space-y-4" : "hidden"}>
        <div className="rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.08)] bg-white/95 px-6 py-5 shadow-soft">
          <h3 className="text-base font-semibold text-[var(--color-primary-900)]">
            Review draft details
          </h3>
          <p className="text-xs text-subtle">
            {isEditMode
              ? "Confirm everything looks right before saving changes or resubmitting for review."
              : "Make sure these details are correct. You can edit the draft after creation before submitting for review."}
          </p>
          <dl className="mt-4 space-y-3">
            {summaryItems.map((item) => (
              <div key={item.label} className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
                  {item.label}
                </dt>
                <dd className="text-sm text-[var(--color-text)]">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-xs text-subtle">
          Central planning currently has {reviewerQueueCount} {reviewerQueueCount === 1 ? "event" : "events"} awaiting review.
        </p>
      </div>

      {state?.error ? <Alert variant="danger" title={state.error} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {stepIndex > 0 ? (
          <Button type="button" variant="ghost" onClick={goBack}>
            Back
          </Button>
        ) : (
          <span />
        )}

        {stepIndex < steps.length - 1 ? (
          <Button type="button" variant="primary" onClick={goNext} disabled={!hasVenues}>
            Continue
          </Button>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                name="intent"
                value="save"
                variant="outline"
                disabled={!hasVenues}
              >
                {isEditMode ? "Save changes" : "Save draft"}
              </Button>
              <Button
                type="submit"
                name="intent"
                value="submit"
                disabled={!hasVenues}
              >
                Submit for review
              </Button>
            </div>
            <span className="text-xs text-subtle">
              Drafts stay private until you submit them for review.
            </span>
          </div>
        )}
      </div>
    </form>
  );
}
