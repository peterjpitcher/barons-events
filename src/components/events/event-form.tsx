"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { generateWebsiteCopyAction, saveEventDraftAction, submitEventForReviewAction } from "@/actions/events";
import { SubmitButton } from "@/components/ui/submit-button";
import { DeleteEventButton } from "@/components/events/delete-event-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { EVENT_GOALS } from "@/lib/event-goals";
import { cn } from "@/lib/utils";
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
  const [websiteCopyState, websiteCopyAction] = useActionState(generateWebsiteCopyAction, undefined);
  const [intent, setIntent] = useState<"draft" | "submit" | "generate">("draft");

  useEffect(() => {
    if (draftState?.message) {
      if (draftState.success) {
        toast.success(draftState.message);
      } else if (!draftState.fieldErrors) {
        toast.error(draftState.message);
      }
    }
  }, [draftState]);

  useEffect(() => {
    if (submitState?.message) {
      if (submitState.success) {
        toast.success(submitState.message);
      } else if (!submitState.fieldErrors) {
        toast.error(submitState.message);
      }
    }
  }, [submitState]);

  useEffect(() => {
    if (websiteCopyState?.message) {
      if (websiteCopyState.success) {
        toast.success(websiteCopyState.message);
      } else if (!websiteCopyState.fieldErrors) {
        toast.error(websiteCopyState.message);
      }
    }
  }, [websiteCopyState]);

  const canChooseVenue = role === "central_planner";
  const preferredVenueId = initialVenueId ?? defaultValues?.venue_id ?? userVenueId ?? venues[0]?.id ?? "";
  const defaultVenueId = venues.some((venue) => venue.id === preferredVenueId) ? preferredVenueId : venues[0]?.id ?? "";
  const [selectedVenueId, setSelectedVenueId] = useState(defaultVenueId);
  const [startValue, setStartValue] = useState(toLocalInputValue(defaultValues?.start_at ?? initialStartAt));
  const [endValue, setEndValue] = useState(toLocalInputValue(defaultValues?.end_at ?? initialEndAt));
  const [endDirty, setEndDirty] = useState(Boolean(defaultValues?.end_at ?? initialEndAt));

  const [publicTitle, setPublicTitle] = useState(defaultValues?.public_title ?? "");
  const [publicTeaser, setPublicTeaser] = useState(defaultValues?.public_teaser ?? "");
  const [publicDescription, setPublicDescription] = useState(defaultValues?.public_description ?? "");
  const [bookingUrl, setBookingUrl] = useState(defaultValues?.booking_url ?? "");
  const [seoTitle, setSeoTitle] = useState(defaultValues?.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(defaultValues?.seo_description ?? "");
  const [seoSlug, setSeoSlug] = useState(defaultValues?.seo_slug ?? "");

  useEffect(() => {
    setPublicTitle(defaultValues?.public_title ?? "");
    setPublicTeaser(defaultValues?.public_teaser ?? "");
    setPublicDescription(defaultValues?.public_description ?? "");
    setBookingUrl(defaultValues?.booking_url ?? "");
    setSeoTitle(defaultValues?.seo_title ?? "");
    setSeoDescription(defaultValues?.seo_description ?? "");
    setSeoSlug(defaultValues?.seo_slug ?? "");
  }, [defaultValues?.id]);

  useEffect(() => {
    if (!websiteCopyState?.success || !websiteCopyState.values) return;
    setPublicTitle(websiteCopyState.values.publicTitle ?? "");
    setPublicTeaser(websiteCopyState.values.publicTeaser ?? "");
    setPublicDescription(websiteCopyState.values.publicDescription ?? "");
    setSeoTitle(websiteCopyState.values.seoTitle ?? "");
    setSeoDescription(websiteCopyState.values.seoDescription ?? "");
    setSeoSlug(websiteCopyState.values.seoSlug ?? "");
  }, [websiteCopyState]);

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
  const canGenerateWebsiteCopy =
    mode === "edit" && Boolean(defaultValues?.id) && ["approved", "completed"].includes(defaultValues?.status ?? "");

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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as unknown as { submitter?: HTMLElement | null }).submitter;
    const actionIntent = submitter?.getAttribute?.("data-intent");
    setIntent(actionIntent === "submit" ? "submit" : actionIntent === "generate" ? "generate" : "draft");
  }

  const activeState = intent === "submit" ? submitState : draftState;
  const fieldErrors = activeState?.fieldErrors ?? {};

  return (
    <form action={draftAction} className="space-y-6" noValidate onSubmit={handleSubmit}>
      <input type="hidden" name="eventId" defaultValue={defaultValues?.id} />

      <Card>
        <CardHeader>
          <CardTitle>1. Core details</CardTitle>
          <CardDescription>Start with the venue, title, and the type of activation you’re planning.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-2">
              <Label htmlFor="title">Event title</Label>
              <Input
                id="title"
                name="title"
                defaultValue={defaultValues?.title ?? ""}
                placeholder="e.g. Riverside Tap Takeover"
                required
                aria-invalid={Boolean(fieldErrors.title)}
                aria-describedby={fieldErrors.title ? "title-error" : undefined}
                className={cn(
                  fieldErrors.title
                    ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                    : undefined
                )}
              />
              <FieldError id="title-error" message={fieldErrors.title} />
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
                  aria-invalid={Boolean(fieldErrors.venueId)}
                  aria-describedby={fieldErrors.venueId ? "venue-error" : undefined}
                  className={cn(
                    fieldErrors.venueId
                      ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                      : undefined
                  )}
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
                  <Input
                    disabled
                    value={selectedVenue?.name ?? ""}
                    aria-invalid={Boolean(fieldErrors.venueId)}
                    aria-describedby={fieldErrors.venueId ? "venue-error" : undefined}
                    className={cn(
                      fieldErrors.venueId
                        ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                        : undefined
                    )}
                  />
                  <input type="hidden" name="venueId" value={selectedVenueId} />
                </>
              )}
              <FieldError id="venue-error" message={fieldErrors.venueId} />
              <p className="text-xs text-subtle">Pick the host venue—this controls which spaces appear below.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="eventType">Event type</Label>
              <Select
                id="eventType"
                name="eventType"
                defaultValue={defaultValues?.event_type ?? typeOptions[0]}
                required
                aria-invalid={Boolean(fieldErrors.eventType)}
                aria-describedby={fieldErrors.eventType ? "event-type-error" : undefined}
                className={cn(
                  fieldErrors.eventType
                    ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                    : undefined
                )}
              >
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
              <FieldError id="event-type-error" message={fieldErrors.eventType} />
              <p className="text-xs text-subtle">Need a new option? Add it in Settings.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Timing & spaces</CardTitle>
          <CardDescription>Set where the event takes place and when guests should arrive.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="space-y-2">
            <Label htmlFor="venueSpace">Spaces</Label>
            <Input
              id="venueSpace"
              name="venueSpace"
              defaultValue={defaultValues?.venue_space ?? ""}
              placeholder="e.g. Main Bar, Garden"
              required
              aria-invalid={Boolean(fieldErrors.venueSpace)}
              aria-describedby={fieldErrors.venueSpace ? "venue-space-error" : undefined}
              className={cn(
                fieldErrors.venueSpace
                  ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                  : undefined
              )}
            />
            <FieldError id="venue-space-error" message={fieldErrors.venueSpace} />
            <p className="text-xs text-subtle">Enter the specific areas or rooms being used.</p>
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
                aria-invalid={Boolean(fieldErrors.startAt)}
                aria-describedby={fieldErrors.startAt ? "start-at-error" : undefined}
                className={cn(
                  fieldErrors.startAt
                    ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                    : undefined
                )}
              />
              <FieldError id="start-at-error" message={fieldErrors.startAt} />
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
                aria-invalid={Boolean(fieldErrors.endAt)}
                aria-describedby={fieldErrors.endAt ? "end-at-error" : undefined}
                className={cn(
                  fieldErrors.endAt
                    ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                    : undefined
                )}
              />
              <FieldError id="end-at-error" message={fieldErrors.endAt} />
              <p className="text-xs text-subtle">We’ll auto-fill three hours after the start—adjust if the event runs longer or shorter.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Promos & planning</CardTitle>
          <CardDescription>Provide headcount, promos, and any expected costs for planning.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Event details & goals</CardTitle>
          <CardDescription>Capture the guest-facing details and any internal goals for the activation.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="space-y-2">
            <Label htmlFor="eventDetails">Event details</Label>
            <Textarea
              id="eventDetails"
              name="notes"
              rows={5}
              defaultValue={defaultValues?.notes ?? ""}
              placeholder="Add all the details about the event here — it doesn’t need to be structured."
              aria-invalid={Boolean(fieldErrors.notes)}
              aria-describedby={fieldErrors.notes ? "event-details-error" : undefined}
              className={cn(
                fieldErrors.notes
                  ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                  : undefined
              )}
            />
            <FieldError id="event-details-error" message={fieldErrors.notes} />
            <p className="text-xs text-subtle">Include anything a guest would want to know (what’s happening, timings, promos, key moments).</p>
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

      <Card id="website-copy">
        <CardHeader>
          <CardTitle>5. Website listing (AI-assisted)</CardTitle>
          <CardDescription>Generate and polish the guest-facing name, teaser, and description for the website.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="publicTitle">Public name</Label>
              <Input
                id="publicTitle"
                name="publicTitle"
                value={publicTitle}
                onChange={(event) => setPublicTitle(event.target.value)}
                placeholder="Guest-facing name for the website"
                aria-invalid={Boolean(fieldErrors.publicTitle)}
                aria-describedby={fieldErrors.publicTitle ? "public-title-error" : undefined}
                className={cn(
                  fieldErrors.publicTitle
                    ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                    : undefined
                )}
              />
              <FieldError id="public-title-error" message={fieldErrors.publicTitle} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bookingUrl">Booking link</Label>
              <Input
                id="bookingUrl"
                name="bookingUrl"
                type="url"
                value={bookingUrl}
                onChange={(event) => setBookingUrl(event.target.value)}
                placeholder="https://…"
                aria-invalid={Boolean(fieldErrors.bookingUrl)}
                aria-describedby={fieldErrors.bookingUrl ? "booking-url-error" : undefined}
                className={cn(
                  fieldErrors.bookingUrl
                    ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                    : undefined
                )}
              />
              <FieldError id="booking-url-error" message={fieldErrors.bookingUrl} />
              <p className="text-xs text-subtle">Optional. If empty, the website can hide the booking CTA.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="publicTeaser">Teaser</Label>
            <Input
              id="publicTeaser"
              name="publicTeaser"
              value={publicTeaser}
              onChange={(event) => setPublicTeaser(event.target.value)}
              placeholder="Short hook for cards (max ~160 chars)"
              aria-invalid={Boolean(fieldErrors.publicTeaser)}
              aria-describedby={fieldErrors.publicTeaser ? "public-teaser-error" : undefined}
              className={cn(
                fieldErrors.publicTeaser
                  ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                  : undefined
              )}
            />
            <FieldError id="public-teaser-error" message={fieldErrors.publicTeaser} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="publicDescription">Public description</Label>
            <Textarea
              id="publicDescription"
              name="publicDescription"
              rows={9}
              value={publicDescription}
              onChange={(event) => setPublicDescription(event.target.value)}
              placeholder="~300 words designed to drive urgency and bookings."
              aria-invalid={Boolean(fieldErrors.publicDescription)}
              aria-describedby={fieldErrors.publicDescription ? "public-description-error" : undefined}
              className={cn(
                fieldErrors.publicDescription
                  ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                  : undefined
              )}
            />
            <FieldError id="public-description-error" message={fieldErrors.publicDescription} />
            <p className="text-xs text-subtle">Write as if a guest is reading this on the website.</p>
          </div>

          <div className="space-y-4 rounded-lg bg-[var(--color-surface-soft)] p-4">
            <h3 className="font-semibold text-[var(--color-text)]">SEO metadata</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="seoTitle">SEO title</Label>
                <Input
                  id="seoTitle"
                  name="seoTitle"
                  value={seoTitle}
                  onChange={(event) => setSeoTitle(event.target.value)}
                  placeholder="≤ 60 characters"
                  aria-invalid={Boolean(fieldErrors.seoTitle)}
                  aria-describedby={fieldErrors.seoTitle ? "seo-title-error" : undefined}
                  className={cn(
                    fieldErrors.seoTitle
                      ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                      : undefined
                  )}
                />
                <FieldError id="seo-title-error" message={fieldErrors.seoTitle} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="seoSlug">SEO slug</Label>
                <Input
                  id="seoSlug"
                  name="seoSlug"
                  value={seoSlug}
                  onChange={(event) => setSeoSlug(event.target.value)}
                  placeholder="lowercase-words-separated-by-hyphens"
                  aria-invalid={Boolean(fieldErrors.seoSlug)}
                  aria-describedby={fieldErrors.seoSlug ? "seo-slug-error" : undefined}
                  className={cn(
                    fieldErrors.seoSlug
                      ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                      : undefined
                  )}
                />
                <FieldError id="seo-slug-error" message={fieldErrors.seoSlug} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="seoDescription">SEO description</Label>
              <Textarea
                id="seoDescription"
                name="seoDescription"
                rows={3}
                value={seoDescription}
                onChange={(event) => setSeoDescription(event.target.value)}
                placeholder="≤ 155 characters"
                aria-invalid={Boolean(fieldErrors.seoDescription)}
                aria-describedby={fieldErrors.seoDescription ? "seo-description-error" : undefined}
                className={cn(
                  fieldErrors.seoDescription
                    ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                    : undefined
                )}
              />
              <FieldError id="seo-description-error" message={fieldErrors.seoDescription} />
            </div>
          </div>

          {!canGenerateWebsiteCopy ? (
            <p className="text-xs text-subtle">
              Save the draft and approve the event to enable AI generation.
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="justify-end">
          <SubmitButton
            formAction={websiteCopyAction}
            label="Generate with AI"
            pendingLabel="Generating..."
            variant="secondary"
            data-intent="generate"
            disabled={!canGenerateWebsiteCopy}
          />
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>6. Save & submit</CardTitle>
          <CardDescription>Save a draft first, then submit for review when ready.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <SubmitButton
            label={mode === "create" ? "Save draft" : "Save changes"}
            pendingLabel="Saving..."
            variant="primary"
            data-intent="draft"
          />
          <SubmitButton
            formAction={submitAction}
            label="Submit for review"
            pendingLabel="Sending..."
            variant="secondary"
            data-intent="submit"
          />
          {mode === "edit" && defaultValues?.id ? <DeleteEventButton eventId={defaultValues.id} variant="button" /> : null}
        </CardContent>
      </Card>
    </form>
  );
}
