"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { saveEventDraftAction, submitEventForReviewAction } from "@/actions/events";
import { SubmitButton } from "@/components/ui/submit-button";
import { DeleteEventButton } from "@/components/events/delete-event-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { EVENT_GOALS } from "@/lib/event-goals";
import type { EventSummary } from "@/lib/events";
import type { UserRole } from "@/lib/types";

import type { VenueWithAreas } from "@/lib/venues";

export type EventFormProps = {
  mode: "create" | "edit";
  defaultValues?: EventSummary;
  venues: VenueWithAreas[];
  eventTypes: string[];
  role: UserRole;
  userVenueId?: string | null;
  initialStartAt?: string;
  initialEndAt?: string;
  initialVenueId?: string;
};

function toLocalInputValue(date?: string | null) {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset();
  const local = new Date(parsed.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function addHours(localIso: string, hours: number) {
  if (!localIso) return "";
  const parsed = new Date(localIso);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setHours(parsed.getHours() + hours);
  const offset = parsed.getTimezoneOffset();
  const adjusted = new Date(parsed.getTime() - offset * 60000);
  return adjusted.toISOString().slice(0, 16);
}

export function EventForm({
  mode,
  defaultValues,
  venues,
  eventTypes,
  role,
  userVenueId,
  initialStartAt,
  initialEndAt,
  initialVenueId
}: EventFormProps) {
  const [draftState, draftAction] = useActionState(saveEventDraftAction, undefined);
  const [submitState, submitAction] = useActionState(submitEventForReviewAction, undefined);

  useEffect(() => {
    if (draftState?.message) {
      if (draftState.success) {
        toast.success(draftState.message);
      } else {
        toast.error(draftState.message);
      }
    }
  }, [draftState]);

  useEffect(() => {
    if (submitState?.message) {
      if (submitState.success) {
        toast.success(submitState.message);
      } else {
        toast.error(submitState.message);
      }
    }
  }, [submitState]);

  const canChooseVenue = role === "central_planner";
  const preferredVenueId = initialVenueId ?? defaultValues?.venue_id ?? userVenueId ?? venues[0]?.id ?? "";
  const defaultVenueId = venues.some((venue) => venue.id === preferredVenueId) ? preferredVenueId : venues[0]?.id ?? "";
  const [selectedVenueId, setSelectedVenueId] = useState(defaultVenueId);
  const [startValue, setStartValue] = useState(toLocalInputValue(defaultValues?.start_at ?? initialStartAt));
  const [endValue, setEndValue] = useState(toLocalInputValue(defaultValues?.end_at ?? initialEndAt));
  const [endDirty, setEndDirty] = useState(Boolean(defaultValues?.end_at ?? initialEndAt));

  const defaultGoals = useMemo(
    () =>
      new Set(
        (defaultValues?.goal_focus ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      ),
    [defaultValues?.goal_focus]
  );

  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === selectedVenueId) ?? venues.find((venue) => venue.id === defaultVenueId) ?? venues[0],
    [selectedVenueId, venues, defaultVenueId]
  );

  const typeOptions = eventTypes.length ? eventTypes : ["General"];

  function handleVenueChange(value: string) {
    setSelectedVenueId(value);
  }

  function handleStartChange(value: string) {
    setStartValue(value);
    if (!endDirty || !endValue) {
      const auto = addHours(value, 3);
      if (auto) setEndValue(auto);
    }
  }

  function handleEndChange(value: string) {
    setEndDirty(true);
    setEndValue(value);
  }

  return (
    <form action={draftAction} className="space-y-6">
      <input type="hidden" name="eventId" defaultValue={defaultValues?.id} />

      <Card>
        <CardContent className="grid gap-6 pt-6">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-2">
              <Label htmlFor="title">Event title</Label>
              <Input
                id="title"
                name="title"
                defaultValue={defaultValues?.title ?? ""}
                placeholder="e.g. Riverside Tap Takeover"
                required
              />
              <p className="text-xs text-subtle">This is the headline guests will see on the website and in reviewer dashboards.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="venueId">Venue</Label>
              {canChooseVenue ? (
                <Select
                  id="venueId"
                  name="venueId"
                  defaultValue={defaultVenueId}
                  onChange={(event) => handleVenueChange(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Choose venue
                  </option>
                  {venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <>
                  <Input disabled value={selectedVenue?.name ?? ""} />
                  <input type="hidden" name="venueId" value={selectedVenueId} />
                </>
              )}
              <p className="text-xs text-subtle">Pick the host venue—this controls which spaces appear below.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="eventDetails">Event details</Label>
            <Textarea
              id="eventDetails"
              name="notes"
              rows={4}
              defaultValue={defaultValues?.notes ?? ""}
              placeholder="Summarise the activation, key beats, partners, and any standout experiences."
            />
            <p className="text-xs text-subtle">Share the overview that helps teams understand what's happening and why it matters.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="eventType">Event type</Label>
              <Select id="eventType" name="eventType" defaultValue={defaultValues?.event_type ?? typeOptions[0]} required>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-subtle">Need a new option? Add it in Settings.</p>
            </div>
            <div className="space-y-2">
              <div className="space-y-2">
                <Label htmlFor="venueSpace">Spaces</Label>
                <Input
                  id="venueSpace"
                  name="venueSpace"
                  defaultValue={defaultValues?.venue_space ?? ""}
                  placeholder="e.g. Main Bar, Garden"
                  required
                />
                <p className="text-xs text-subtle">Enter the specific areas or rooms being used.</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startAt">Starts</Label>
              <Input
                id="startAt"
                name="startAt"
                type="datetime-local"
                value={startValue}
                onChange={(event) => handleStartChange(event.target.value)}
                required
              />
              <p className="text-xs text-subtle">When guests are expected to arrive or the activity begins.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="endAt">Ends</Label>
              <Input
                id="endAt"
                name="endAt"
                type="datetime-local"
                value={endValue}
                onChange={(event) => handleEndChange(event.target.value)}
                required
              />
              <p className="text-xs text-subtle">We’ll auto-fill three hours after the start—adjust if the event runs longer or shorter.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="expectedHeadcount">Expected headcount</Label>
              <Input
                id="expectedHeadcount"
                name="expectedHeadcount"
                type="number"
                min={0}
                defaultValue={defaultValues?.expected_headcount ?? ""}
                placeholder="e.g. 120"
              />
              <p className="text-xs text-subtle">Rough numbers help planning for staffing, stock, and floor setup.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wetPromo">Wet promotion</Label>
              <Input
                id="wetPromo"
                name="wetPromo"
                defaultValue={defaultValues?.wet_promo ?? ""}
                placeholder="Two-for-one cocktails, guest brewery taps"
              />
              <p className="text-xs text-subtle">Is this event expected to drive wet sales? Note any key drink offers.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="foodPromo">Food promotion</Label>
            <Input
              id="foodPromo"
              name="foodPromo"
              defaultValue={defaultValues?.food_promo ?? ""}
              placeholder="Sharing boards, brunch specials"
            />
            <p className="text-xs text-subtle">List any paired food promotions or add-ons.</p>
          </div>

          <div className="space-y-4 rounded-lg bg-[var(--color-surface-soft)] p-4">
            <h3 className="font-semibold text-[var(--color-text)]">Financials</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="costTotal">Total predicted cost (£)</Label>
                <Input
                  id="costTotal"
                  name="costTotal"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={defaultValues?.cost_total ?? ""}
                  placeholder="e.g. 500.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="costDetails">Cost details</Label>
                <Textarea
                  id="costDetails"
                  name="costDetails"
                  rows={2}
                  defaultValue={defaultValues?.cost_details ?? ""}
                  placeholder="Breakdown of expenses..."
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Goals</Label>
            <p className="text-xs text-subtle">Select the goals that matter for this event. Pick as many as apply.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EVENT_GOALS.map((option) => (
                <label key={option.value} className="flex items-start gap-2 text-sm text-[var(--color-text)]">
                  <input
                    type="checkbox"
                    name="goalFocus"
                    value={option.value}
                    defaultChecked={defaultGoals.has(option.value)}
                    className="mt-1 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary-700)] focus:ring-[var(--color-primary-500)]"
                  />
                  <span>
                    <span className="font-medium">{option.label}</span>
                    <br />
                    <span className="text-xs text-subtle">{option.helper}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={mode === "create" ? "Save draft" : "Save changes"} pendingLabel="Saving..." variant="primary" />
        <SubmitButton
          formAction={submitAction}
          label="Submit for review"
          pendingLabel="Sending..."
          variant="secondary"
        />
        {mode === "edit" && defaultValues?.id ? <DeleteEventButton eventId={defaultValues.id} /> : null}
      </div>
    </form>
  );
}
