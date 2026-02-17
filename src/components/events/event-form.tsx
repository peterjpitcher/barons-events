"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createArtistAction } from "@/actions/artists";
import {
  generateTermsAndConditionsAction,
  generateWebsiteCopyAction,
  saveEventDraftAction,
  submitEventForReviewAction
} from "@/actions/events";
import { SubmitButton } from "@/components/ui/submit-button";
import { DeleteEventButton } from "@/components/events/delete-event-button";
import { Button } from "@/components/ui/button";
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
import type { ArtistOption } from "@/lib/artists";
import type { VenueRow } from "@/lib/venues";

export type EventFormProps = {
  mode: "create" | "edit";
  defaultValues?: EventSummary;
  venues: VenueRow[];
  artists: ArtistOption[];
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

const ARTIST_TYPE_OPTIONS = [
  { value: "artist", label: "Artist" },
  { value: "band", label: "Band" },
  { value: "host", label: "Host" },
  { value: "dj", label: "DJ" },
  { value: "comedian", label: "Comedian" },
  { value: "other", label: "Other" }
] as const;

const ARTIST_TYPE_LABELS: Record<string, string> = {
  artist: "Artist",
  band: "Band",
  host: "Host",
  dj: "DJ",
  comedian: "Comedian",
  other: "Other"
};

function toArtistType(value: string): (typeof ARTIST_TYPE_OPTIONS)[number]["value"] {
  return ARTIST_TYPE_OPTIONS.some((option) => option.value === value)
    ? (value as (typeof ARTIST_TYPE_OPTIONS)[number]["value"])
    : "artist";
}

function toArtistTypeFilter(value: string): "all" | (typeof ARTIST_TYPE_OPTIONS)[number]["value"] {
  if (value === "all") return "all";
  return toArtistType(value);
}

function sortArtistOptions(items: ArtistOption[]): ArtistOption[] {
  return [...items].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function mergeArtistOptions(current: ArtistOption[], incoming: ArtistOption[]): ArtistOption[] {
  const byId = new Map(current.map((artist) => [artist.id, artist]));
  incoming.forEach((artist) => {
    byId.set(artist.id, artist);
  });
  return sortArtistOptions(Array.from(byId.values()));
}

function getLinkedArtistSelection(defaultValues?: EventSummary): { ids: string[]; names: string[] } {
  if (!Array.isArray((defaultValues as any)?.artists)) {
    return { ids: [], names: [] };
  }

  const ids: string[] = [];
  const names: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  ((defaultValues as any).artists as any[]).forEach((entry) => {
    const artistValue = Array.isArray(entry?.artist) ? entry.artist[0] : entry?.artist;
    const artistId = typeof artistValue?.id === "string" ? artistValue.id : null;
    const artistName = typeof artistValue?.name === "string" ? artistValue.name.trim() : null;

    if (artistId && !seenIds.has(artistId)) {
      seenIds.add(artistId);
      ids.push(artistId);
    }
    if (artistName) {
      const key = artistName.toLowerCase();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        names.push(artistName);
      }
    }
  });

  return { ids, names };
}

export function EventForm({
  mode,
  defaultValues,
  venues,
  artists,
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
  const [termsState, termsAction] = useActionState(generateTermsAndConditionsAction, undefined);
  const [artistCreateState, createArtistFormAction] = useActionState(createArtistAction, undefined);
  const [intent, setIntent] = useState<"draft" | "submit" | "generate">("draft");
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showArtistModal, setShowArtistModal] = useState(false);
  const [artistSearch, setArtistSearch] = useState("");
  const [artistTypeFilter, setArtistTypeFilter] = useState<"all" | (typeof ARTIST_TYPE_OPTIONS)[number]["value"]>("all");
  const [showCreateArtistForm, setShowCreateArtistForm] = useState(false);
  const [newArtistName, setNewArtistName] = useState("");
  const [newArtistType, setNewArtistType] = useState<(typeof ARTIST_TYPE_OPTIONS)[number]["value"]>("artist");
  const [newArtistEmail, setNewArtistEmail] = useState("");
  const [newArtistPhone, setNewArtistPhone] = useState("");
  const [newArtistDescription, setNewArtistDescription] = useState("");
  const [allowsWalkIns, setAllowsWalkIns] = useState<"" | "yes" | "no">("");
  const [refundAllowed, setRefundAllowed] = useState<"" | "yes" | "no">("");
  const [rescheduleAllowed, setRescheduleAllowed] = useState<"" | "yes" | "no">("");
  const [termsExtraNotes, setTermsExtraNotes] = useState("");
  const [sectionOpen, setSectionOpen] = useState({
    core: true,
    timing: true,
    planning: true,
    goals: true,
    website: true,
    save: true
  });

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

  useEffect(() => {
    if (!termsState?.message) return;
    if (termsState.success && typeof termsState.terms === "string") {
      setTermsAndConditions(termsState.terms);
      setShowTermsModal(false);
      toast.success(termsState.message ?? "Terms generated.");
    } else if (!termsState.success) {
      toast.error(termsState.message ?? "Could not generate terms.");
    }
  }, [termsState]);

  useEffect(() => {
    setAvailableArtists((current) => mergeArtistOptions(current, artists));
  }, [artists]);

  useEffect(() => {
    if (!artistCreateState?.message) return;
    if (artistCreateState.success) {
      if (artistCreateState.artist) {
        const created = artistCreateState.artist;
        setAvailableArtists((current) => mergeArtistOptions(current, [created]));
        setSelectedArtistIds((current) => (current.includes(created.id) ? current : [...current, created.id]));
        setArtistSearch(created.name);
        setShowCreateArtistForm(false);
        setNewArtistName("");
        setNewArtistType(toArtistType(created.artistType));
        setNewArtistEmail("");
        setNewArtistPhone("");
        setNewArtistDescription("");
      }
      toast.success(artistCreateState.message);
      return;
    }
    if (!artistCreateState.fieldErrors) {
      toast.error(artistCreateState.message ?? "Could not add artist.");
    }
  }, [artistCreateState]);

  const canChooseVenue = role === "central_planner";
  const preferredVenueId = initialVenueId ?? defaultValues?.venue_id ?? userVenueId ?? venues[0]?.id ?? "";
  const defaultVenueId = venues.some((venue) => venue.id === preferredVenueId) ? preferredVenueId : venues[0]?.id ?? "";
  const defaultGoalValues = new Set(
    (defaultValues?.goal_focus ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const defaultArtistSelection = getLinkedArtistSelection(defaultValues);
  const [availableArtists, setAvailableArtists] = useState<ArtistOption[]>(() => sortArtistOptions(artists));
  const [selectedArtistIds, setSelectedArtistIds] = useState<string[]>(defaultArtistSelection.ids);
  const [titleValue, setTitleValue] = useState(defaultValues?.title ?? "");
  const [eventTypeValue, setEventTypeValue] = useState(defaultValues?.event_type ?? eventTypes[0] ?? "");
  const [selectedVenueId, setSelectedVenueId] = useState(defaultVenueId);
  const [venueSpaceValue, setVenueSpaceValue] = useState(defaultValues?.venue_space ?? "");
  const [startValue, setStartValue] = useState(toLocalInputValue(defaultValues?.start_at ?? initialStartAt));
  const [endValue, setEndValue] = useState(toLocalInputValue(defaultValues?.end_at ?? initialEndAt));
  const [endDirty, setEndDirty] = useState(Boolean(defaultValues?.end_at ?? initialEndAt));
  const [eventNotes, setEventNotes] = useState(defaultValues?.notes ?? "");
  const [bookingType, setBookingType] = useState(defaultValues?.booking_type ?? "");
  const [ticketPrice, setTicketPrice] = useState(defaultValues?.ticket_price != null ? String(defaultValues.ticket_price) : "");
  const [selectedGoals, setSelectedGoals] = useState<Set<string>>(new Set(defaultGoalValues));
  const [checkInCutoffMinutes, setCheckInCutoffMinutes] = useState(
    defaultValues?.check_in_cutoff_minutes != null ? String(defaultValues.check_in_cutoff_minutes) : ""
  );
  const [agePolicy, setAgePolicy] = useState(defaultValues?.age_policy ?? "");
  const [accessibilityNotes, setAccessibilityNotes] = useState(defaultValues?.accessibility_notes ?? "");
  const [cancellationWindowHours, setCancellationWindowHours] = useState(
    defaultValues?.cancellation_window_hours != null ? String(defaultValues.cancellation_window_hours) : ""
  );
  const [termsAndConditions, setTermsAndConditions] = useState(defaultValues?.terms_and_conditions ?? "");

  const [publicTitle, setPublicTitle] = useState(defaultValues?.public_title ?? "");
  const [publicTeaser, setPublicTeaser] = useState(defaultValues?.public_teaser ?? "");
  const [publicDescription, setPublicDescription] = useState(defaultValues?.public_description ?? "");
  const [publicHighlights, setPublicHighlights] = useState(
    Array.isArray(defaultValues?.public_highlights) ? defaultValues.public_highlights.join("\n") : ""
  );
  const [bookingUrl, setBookingUrl] = useState(defaultValues?.booking_url ?? "");
  const [seoTitle, setSeoTitle] = useState(defaultValues?.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(defaultValues?.seo_description ?? "");
  const [seoSlug, setSeoSlug] = useState(defaultValues?.seo_slug ?? "");

  useEffect(() => {
    setTitleValue(defaultValues?.title ?? "");
    setEventTypeValue(defaultValues?.event_type ?? eventTypes[0] ?? "");
    setVenueSpaceValue(defaultValues?.venue_space ?? "");
    setEventNotes(defaultValues?.notes ?? "");
    setTicketPrice(defaultValues?.ticket_price != null ? String(defaultValues.ticket_price) : "");
    setSelectedArtistIds(getLinkedArtistSelection(defaultValues).ids);
    setSelectedGoals(
      new Set(
        (defaultValues?.goal_focus ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );
    setBookingType(defaultValues?.booking_type ?? "");
    setCheckInCutoffMinutes(
      defaultValues?.check_in_cutoff_minutes != null ? String(defaultValues.check_in_cutoff_minutes) : ""
    );
    setAgePolicy(defaultValues?.age_policy ?? "");
    setAccessibilityNotes(defaultValues?.accessibility_notes ?? "");
    setCancellationWindowHours(
      defaultValues?.cancellation_window_hours != null ? String(defaultValues.cancellation_window_hours) : ""
    );
    setTermsAndConditions(defaultValues?.terms_and_conditions ?? "");
    setPublicTitle(defaultValues?.public_title ?? "");
    setPublicTeaser(defaultValues?.public_teaser ?? "");
    setPublicDescription(defaultValues?.public_description ?? "");
    setPublicHighlights(Array.isArray(defaultValues?.public_highlights) ? defaultValues.public_highlights.join("\n") : "");
    setBookingUrl(defaultValues?.booking_url ?? "");
    setSeoTitle(defaultValues?.seo_title ?? "");
    setSeoDescription(defaultValues?.seo_description ?? "");
    setSeoSlug(defaultValues?.seo_slug ?? "");
  }, [defaultValues?.id, eventTypes]);

  useEffect(() => {
    if (!websiteCopyState?.success || !websiteCopyState.values) return;
    setPublicTitle(websiteCopyState.values.publicTitle ?? "");
    setPublicTeaser(websiteCopyState.values.publicTeaser ?? "");
    setPublicDescription(websiteCopyState.values.publicDescription ?? "");
    setPublicHighlights((websiteCopyState.values.publicHighlights ?? []).join("\n"));
    setSeoTitle(websiteCopyState.values.seoTitle ?? "");
    setSeoDescription(websiteCopyState.values.seoDescription ?? "");
    setSeoSlug(websiteCopyState.values.seoSlug ?? "");
  }, [websiteCopyState]);

  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === selectedVenueId) ?? venues.find((venue) => venue.id === defaultVenueId) ?? venues[0],
    [selectedVenueId, venues, defaultVenueId]
  );
  const artistById = useMemo(() => new Map(availableArtists.map((artist) => [artist.id, artist])), [availableArtists]);
  const selectedArtistOptions = useMemo(
    () =>
      selectedArtistIds
        .map((artistId) => artistById.get(artistId))
        .filter((artist): artist is ArtistOption => Boolean(artist)),
    [selectedArtistIds, artistById]
  );
  const selectedArtistNames = selectedArtistOptions.map((artist) => artist.name);
  const selectedArtistText = selectedArtistNames.join(", ");
  const filteredArtists = useMemo(() => {
    const query = artistSearch.trim().toLowerCase();
    return availableArtists.filter((artist) => {
      if (artistTypeFilter !== "all" && artist.artistType !== artistTypeFilter) {
        return false;
      }
      if (!query.length) {
        return true;
      }
      const haystack = [artist.name, artist.email ?? "", artist.phone ?? "", artist.description ?? ""].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [availableArtists, artistSearch, artistTypeFilter]);
  const createArtistFieldErrors = artistCreateState?.fieldErrors ?? {};

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

  function handleArtistSelection(artistId: string, checked: boolean) {
    setSelectedArtistIds((current) => {
      if (checked) {
        if (current.includes(artistId)) return current;
        return [...current, artistId];
      }
      return current.filter((id) => id !== artistId);
    });
  }

  function clearSelectedArtists() {
    setSelectedArtistIds([]);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as unknown as { submitter?: HTMLElement | null }).submitter;
    const actionIntent = submitter?.getAttribute?.("data-intent");
    const nextIntent = actionIntent === "submit" ? "submit" : actionIntent === "generate" ? "generate" : "draft";

    const willAutoApprove =
      role === "central_planner" && (nextIntent === "submit" || (nextIntent === "draft" && mode === "create"));
    if (willAutoApprove) {
      const confirmed = window.confirm(
        "This action will approve the event and generate AI website copy now. Continue?"
      );
      if (!confirmed) {
        event.preventDefault();
        return;
      }
    }

    setIntent(nextIntent);
  }

  const completionPercent = (checks: boolean[]): number => {
    const total = checks.length;
    const complete = checks.filter(Boolean).length;
    return Math.round((complete / total) * 100);
  };

  const coreCompletion = completionPercent([
    titleValue.trim().length >= 3,
    eventTypeValue.trim().length >= 3,
    selectedVenueId.trim().length > 0,
    eventNotes.trim().length >= 20
  ]);
  const timingCompletion = completionPercent([
    startValue.trim().length > 0,
    endValue.trim().length > 0,
    venueSpaceValue.trim().length >= 2
  ]);
  const planningCompletion = completionPercent([
    bookingType.trim().length > 0,
    bookingType !== "ticketed" || ticketPrice.trim().length > 0,
    agePolicy.trim().length >= 2,
    bookingType === "free_entry" || cancellationWindowHours.trim().length > 0,
    termsAndConditions.trim().length >= 20
  ]);
  const goalsCompletion = completionPercent([selectedGoals.size > 0]);
  const websiteCompletion = completionPercent([
    publicTitle.trim().length >= 3,
    publicTeaser.trim().length >= 12,
    publicDescription.trim().length >= 80,
    publicHighlights.trim().length > 0
  ]);
  const saveCompletion = completionPercent([
    coreCompletion === 100,
    timingCompletion === 100,
    planningCompletion >= 80,
    goalsCompletion === 100,
    websiteCompletion >= 60
  ]);

  function toggleSection(section: keyof typeof sectionOpen) {
    setSectionOpen((current) => ({ ...current, [section]: !current[section] }));
  }

  function toggleGoal(value: string, checked: boolean) {
    setSelectedGoals((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(value);
      } else {
        next.delete(value);
      }
      return next;
    });
  }

  const activeState = intent === "submit" ? submitState : draftState;
  const fieldErrors = activeState?.fieldErrors ?? {};

  return (
    <>
      <form action={draftAction} className="space-y-6" noValidate onSubmit={handleSubmit}>
      <input type="hidden" name="eventId" defaultValue={defaultValues?.id} />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>1. Core details</CardTitle>
              <CardDescription>Start with the venue, title, type, and the key details guests should know.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-muted-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-text)]">
                {coreCompletion}% complete
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => toggleSection("core")}>
                {sectionOpen.core ? "Collapse" : "Expand"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn("grid gap-6", !sectionOpen.core && "hidden")}>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
              <div className="space-y-2">
                <Label htmlFor="title">Event title</Label>
                <Input
                  id="title"
                  name="title"
                  value={titleValue}
                  onChange={(event) => setTitleValue(event.target.value)}
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
                    value={selectedVenueId}
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
                  value={eventTypeValue}
                  onChange={(event) => setEventTypeValue(event.target.value)}
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

            <div className="space-y-2">
              <Label htmlFor="eventDetails">Event details</Label>
              <Textarea
                id="eventDetails"
                name="notes"
                rows={5}
                value={eventNotes}
                onChange={(event) => setEventNotes(event.target.value)}
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
              <p className="text-xs text-subtle">
                Include anything a guest would want to know (what&apos;s happening, timings, promos, key moments).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="artistNames">Artists / bands / hosts</Label>
              <input type="hidden" name="artistIds" value={selectedArtistIds.join(",")} />
              <input type="hidden" name="artistNames" value={selectedArtistNames.join(", ")} />
              <Input
                id="artistNames"
                value={selectedArtistText}
                readOnly
                placeholder="No artists selected yet"
                aria-readonly="true"
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowArtistModal(true)}>
                  Search artists
                </Button>
                {selectedArtistIds.length > 0 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={clearSelectedArtists}>
                    Clear selection
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-subtle">
                Only linked artists are saved. If you are unsure about the host/artist, leave it blank and add them later.
              </p>
            </div>
          </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>2. Timing & spaces</CardTitle>
              <CardDescription>Set when the event runs, then list the spaces being used.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-muted-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-text)]">
                {timingCompletion}% complete
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => toggleSection("timing")}>
                {sectionOpen.timing ? "Collapse" : "Expand"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn("grid gap-6", !sectionOpen.timing && "hidden")}>
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

            <div className="space-y-2">
              <Label htmlFor="venueSpace">Spaces</Label>
              <Input
                id="venueSpace"
                name="venueSpace"
                value={venueSpaceValue}
                onChange={(event) => setVenueSpaceValue(event.target.value)}
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
          </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>3. Promos & planning</CardTitle>
              <CardDescription>
                Capture promotions, booking model, and commercial details so guest content stays accurate.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-muted-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-text)]">
                {planningCompletion}% complete
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => toggleSection("planning")}>
                {sectionOpen.planning ? "Collapse" : "Expand"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn("grid gap-6", !sectionOpen.planning && "hidden")}>
            <div className="grid gap-4 md:grid-cols-2">
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
            </div>

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

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-2">
                <Label htmlFor="bookingType">Booking format</Label>
                <Select
                  id="bookingType"
                  name="bookingType"
                  value={bookingType}
                  onChange={(event) => setBookingType(event.target.value)}
                  required
                  aria-invalid={Boolean(fieldErrors.bookingType)}
                  aria-describedby={fieldErrors.bookingType ? "booking-type-error" : undefined}
                  className={cn(
                    fieldErrors.bookingType
                      ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                      : undefined
                  )}
                >
                  <option value="" disabled>
                    Choose booking format
                  </option>
                  <option value="ticketed">Ticketed event</option>
                  <option value="table_booking">Table booking event</option>
                  <option value="free_entry">Free entry</option>
                  <option value="mixed">Mixed (ticketed + booking)</option>
                </Select>
                <FieldError id="booking-type-error" message={fieldErrors.bookingType} />
                <p className="text-xs text-subtle">This drives AI copy so guests understand how to secure their place.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticketPrice">Ticket price (£)</Label>
                <Input
                  id="ticketPrice"
                  name="ticketPrice"
                  type="number"
                  min={0}
                  step="0.01"
                  value={ticketPrice}
                  onChange={(event) => setTicketPrice(event.target.value)}
                  placeholder="e.g. 15.00"
                  aria-invalid={Boolean(fieldErrors.ticketPrice)}
                  aria-describedby={fieldErrors.ticketPrice ? "ticket-price-error" : undefined}
                  className={cn(
                    fieldErrors.ticketPrice
                      ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                      : undefined
                  )}
                />
                <FieldError id="ticket-price-error" message={fieldErrors.ticketPrice} />
                <p className="text-xs text-subtle">
                  {bookingType === "ticketed"
                    ? "Required for ticketed events."
                    : "Optional for non-ticketed events (use for deposits or packages)."}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="checkInCutoffMinutes">Last admission / check-in cutoff (minutes)</Label>
                <Input
                  id="checkInCutoffMinutes"
                  name="checkInCutoffMinutes"
                  type="number"
                  min={0}
                  max={1440}
                  step={1}
                  value={checkInCutoffMinutes}
                  onChange={(event) => setCheckInCutoffMinutes(event.target.value)}
                  placeholder="e.g. 30"
                  aria-invalid={Boolean(fieldErrors.checkInCutoffMinutes)}
                  aria-describedby={fieldErrors.checkInCutoffMinutes ? "check-in-cutoff-error" : undefined}
                  className={cn(
                    fieldErrors.checkInCutoffMinutes
                      ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                      : undefined
                  )}
                />
                <FieldError id="check-in-cutoff-error" message={fieldErrors.checkInCutoffMinutes} />
                <p className="text-xs text-subtle">
                  Use minutes before start time. Example: `30` means check-in closes 30 minutes before the event starts.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cancellationWindowHours">Cancellation / refund window (hours)</Label>
                <Input
                  id="cancellationWindowHours"
                  name="cancellationWindowHours"
                  type="number"
                  min={0}
                  max={720}
                  step={1}
                  value={cancellationWindowHours}
                  onChange={(event) => setCancellationWindowHours(event.target.value)}
                  placeholder="e.g. 48"
                  aria-invalid={Boolean(fieldErrors.cancellationWindowHours)}
                  aria-describedby={fieldErrors.cancellationWindowHours ? "cancellation-window-error" : undefined}
                  className={cn(
                    fieldErrors.cancellationWindowHours
                      ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                      : undefined
                  )}
                />
                <FieldError id="cancellation-window-error" message={fieldErrors.cancellationWindowHours} />
                <p className="text-xs text-subtle">
                  {bookingType === "free_entry"
                    ? "Optional for free-entry events."
                    : "Required for bookable events so guests get a clear cancellation/refund policy."}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="agePolicy">Age policy</Label>
                <Input
                  id="agePolicy"
                  name="agePolicy"
                  value={agePolicy}
                  onChange={(event) => setAgePolicy(event.target.value)}
                  placeholder="e.g. 18+ only (ID required)"
                  required
                  aria-invalid={Boolean(fieldErrors.agePolicy)}
                  aria-describedby={fieldErrors.agePolicy ? "age-policy-error" : undefined}
                  className={cn(
                    fieldErrors.agePolicy
                      ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                      : undefined
                  )}
                />
                <FieldError id="age-policy-error" message={fieldErrors.agePolicy} />
                <p className="text-xs text-subtle">Use clear guest-facing wording that door staff can enforce consistently.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="accessibilityNotes">Accessibility notes</Label>
                <Textarea
                  id="accessibilityNotes"
                  name="accessibilityNotes"
                  rows={3}
                  value={accessibilityNotes}
                  onChange={(event) => setAccessibilityNotes(event.target.value)}
                  placeholder="Wheelchair access route, seating support, hearing loop details, etc."
                  aria-invalid={Boolean(fieldErrors.accessibilityNotes)}
                  aria-describedby={fieldErrors.accessibilityNotes ? "accessibility-notes-error" : undefined}
                  className={cn(
                    fieldErrors.accessibilityNotes
                      ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                      : undefined
                  )}
                />
                <FieldError id="accessibility-notes-error" message={fieldErrors.accessibilityNotes} />
                <p className="text-xs text-subtle">
                  Add event-specific accessibility information so guests can plan confidently.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="eventImage">Event image (optional)</Label>
                <Input id="eventImage" name="eventImage" type="file" accept="image/*" />
                {defaultValues?.event_image_path ? (
                  <p className="text-xs text-subtle">
                    Current image: {defaultValues.event_image_path.split("/").at(-1) ?? defaultValues.event_image_path}
                  </p>
                ) : (
                  <p className="text-xs text-subtle">Add a hero image to strengthen event listings and social shares.</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="termsAndConditions">Terms & conditions</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => setShowTermsModal(true)}
                >
                  Help me build this
                </Button>
              </div>
              <Textarea
                id="termsAndConditions"
                name="termsAndConditions"
                rows={5}
                value={termsAndConditions}
                onChange={(event) => setTermsAndConditions(event.target.value)}
                placeholder="Add guest-facing terms and conditions."
                aria-invalid={Boolean(fieldErrors.termsAndConditions)}
                aria-describedby={fieldErrors.termsAndConditions ? "terms-and-conditions-error" : undefined}
                className={cn(
                  fieldErrors.termsAndConditions
                    ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                    : undefined
                )}
              />
              <FieldError id="terms-and-conditions-error" message={fieldErrors.termsAndConditions} />
              <p className="text-xs text-subtle">
                Keep this guest-safe and policy-focused: booking, cancellation, arrival, age policy, accessibility.
              </p>
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>4. Goals</CardTitle>
              <CardDescription>Select the goals that matter for this activation.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-muted-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-text)]">
                {goalsCompletion}% complete
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => toggleSection("goals")}>
                {sectionOpen.goals ? "Collapse" : "Expand"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn("grid gap-6", !sectionOpen.goals && "hidden")}>
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
                      checked={selectedGoals.has(option.value)}
                      onChange={(event) => toggleGoal(option.value, event.target.checked)}
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>5. Website listing (AI-assisted)</CardTitle>
              <CardDescription>Generate and polish the guest-facing name, teaser, and description for the website.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-muted-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-text)]">
                {websiteCompletion}% complete
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => toggleSection("website")}>
                {sectionOpen.website ? "Collapse" : "Expand"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn("grid gap-6", !sectionOpen.website && "hidden")}>
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
                  placeholder="https://..."
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
              <Label htmlFor="publicHighlights">Event Highlights</Label>
              <Textarea
                id="publicHighlights"
                name="publicHighlights"
                rows={4}
                value={publicHighlights}
                onChange={(event) => setPublicHighlights(event.target.value)}
                placeholder="- Live entertainment from 8pm\n- Signature cocktails and food pairings\n- Limited spaces, advance booking advised"
                aria-invalid={Boolean(fieldErrors.publicHighlights)}
                aria-describedby={fieldErrors.publicHighlights ? "public-highlights-error" : undefined}
                className={cn(
                  fieldErrors.publicHighlights
                    ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                    : undefined
                )}
              />
              <FieldError id="public-highlights-error" message={fieldErrors.publicHighlights} />
              <p className="text-xs text-subtle">
                One highlight per line. Keep each line concise so guests can scan the USP quickly.
              </p>
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
                    placeholder="e.g. Quiz Night | 6 Jan 2026"
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
                    placeholder="quiz-night-2026-01-06"
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
                  placeholder="Include the date, e.g. Join us at The Cricketers for Quiz Night on 6 Jan 2026."
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>6. Save & submit</CardTitle>
              <CardDescription>Save a draft first, then submit for review when ready.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-muted-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-text)]">
                {saveCompletion}% complete
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => toggleSection("save")}>
                {sectionOpen.save ? "Collapse" : "Expand"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn("flex flex-wrap items-center gap-3", !sectionOpen.save && "hidden")}>
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

      {showArtistModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(39,54,64,0.55)] p-4">
          <div className="w-full max-w-5xl rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] p-5">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-[var(--color-text)]">Select artists / bands / hosts</h2>
                <p className="text-sm text-subtle">
                  Search and filter the artist directory, then link confirmed names to this event.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowArtistModal(false)}>
                Close
              </Button>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <div className="space-y-2">
                    <Label htmlFor="artist-search">Search artists</Label>
                    <Input
                      id="artist-search"
                      value={artistSearch}
                      onChange={(event) => setArtistSearch(event.target.value)}
                      placeholder="Search by name, contact, or description"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="artist-type-filter">Filter by type</Label>
                    <Select
                      id="artist-type-filter"
                      value={artistTypeFilter}
                      onChange={(event) => setArtistTypeFilter(toArtistTypeFilter(event.target.value))}
                    >
                      <option value="all">All types</option>
                      {ARTIST_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="max-h-[380px] space-y-2 overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-3">
                  {filteredArtists.length === 0 ? (
                    <p className="px-1 py-8 text-center text-sm text-subtle">No artists match this search.</p>
                  ) : (
                    filteredArtists.map((artist) => {
                      const checked = selectedArtistIds.includes(artist.id);
                      return (
                        <label
                          key={artist.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border px-3 py-2 text-sm",
                            checked
                              ? "border-[var(--color-primary-500)] bg-[rgba(193,124,61,0.12)]"
                              : "border-[var(--color-border)] bg-white"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => handleArtistSelection(artist.id, event.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary-700)] focus:ring-[var(--color-primary-500)]"
                          />
                          <span className="min-w-0">
                            <span className="font-medium text-[var(--color-text)]">{artist.name}</span>
                            <span className="ml-2 text-xs uppercase tracking-[0.08em] text-subtle">
                              {ARTIST_TYPE_LABELS[artist.artistType] ?? artist.artistType}
                            </span>
                            <span className="block text-xs text-subtle">
                              {[artist.email, artist.phone].filter(Boolean).join(" · ") || "No contact info"}
                            </span>
                            {artist.description ? (
                              <span className="block text-xs text-subtle">{artist.description}</span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    Selected artists ({selectedArtistOptions.length})
                  </p>
                  <p className="text-xs text-subtle">
                    {selectedArtistOptions.length
                      ? selectedArtistOptions.map((artist) => artist.name).join(", ")
                      : "No artists selected yet."}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setShowCreateArtistForm((value) => !value)}>
                    {showCreateArtistForm ? "Hide create form" : "Create new artist"}
                  </Button>
                  {selectedArtistOptions.length ? (
                    <Button type="button" variant="ghost" size="sm" onClick={clearSelectedArtists}>
                      Clear all
                    </Button>
                  ) : null}
                </div>

                {showCreateArtistForm ? (
                  <form action={createArtistFormAction} className="space-y-3 border-t border-[var(--color-border)] pt-3" noValidate>
                    <div className="space-y-1">
                      <Label htmlFor="new-artist-name">Name</Label>
                      <Input
                        id="new-artist-name"
                        name="name"
                        value={newArtistName}
                        onChange={(event) => setNewArtistName(event.target.value)}
                        placeholder="e.g. Elliot"
                        aria-invalid={Boolean(createArtistFieldErrors.name)}
                        aria-describedby={createArtistFieldErrors.name ? "new-artist-name-error" : undefined}
                        className={cn(
                          createArtistFieldErrors.name
                            ? "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]"
                            : undefined
                        )}
                      />
                      <FieldError id="new-artist-name-error" message={createArtistFieldErrors.name} />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="new-artist-type">Type</Label>
                      <Select
                        id="new-artist-type"
                        name="artistType"
                        value={newArtistType}
                        onChange={(event) => setNewArtistType(toArtistType(event.target.value))}
                      >
                        {ARTIST_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="new-artist-email">Email</Label>
                      <Input
                        id="new-artist-email"
                        name="email"
                        type="email"
                        value={newArtistEmail}
                        onChange={(event) => setNewArtistEmail(event.target.value)}
                        placeholder="Optional"
                        aria-invalid={Boolean(createArtistFieldErrors.email)}
                        aria-describedby={createArtistFieldErrors.email ? "new-artist-email-error" : undefined}
                      />
                      <FieldError id="new-artist-email-error" message={createArtistFieldErrors.email} />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="new-artist-phone">Phone</Label>
                      <Input
                        id="new-artist-phone"
                        name="phone"
                        value={newArtistPhone}
                        onChange={(event) => setNewArtistPhone(event.target.value)}
                        placeholder="Optional"
                        aria-invalid={Boolean(createArtistFieldErrors.phone)}
                        aria-describedby={createArtistFieldErrors.phone ? "new-artist-phone-error" : undefined}
                      />
                      <FieldError id="new-artist-phone-error" message={createArtistFieldErrors.phone} />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="new-artist-description">Description</Label>
                      <Textarea
                        id="new-artist-description"
                        name="description"
                        rows={3}
                        value={newArtistDescription}
                        onChange={(event) => setNewArtistDescription(event.target.value)}
                        placeholder="Style, genre, audience fit, or operational notes"
                        aria-invalid={Boolean(createArtistFieldErrors.description)}
                        aria-describedby={createArtistFieldErrors.description ? "new-artist-description-error" : undefined}
                      />
                      <FieldError id="new-artist-description-error" message={createArtistFieldErrors.description} />
                    </div>

                    <div className="flex justify-end">
                      <SubmitButton label="Create artist" pendingLabel="Creating..." variant="secondary" />
                    </div>
                  </form>
                ) : (
                  <p className="text-xs text-subtle">
                    New artists are only added when you create them here. Unknown names are never auto-created.
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end border-t border-[var(--color-border)] px-5 py-4">
              <Button type="button" variant="secondary" onClick={() => setShowArtistModal(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showTermsModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(39,54,64,0.5)] p-4">
          <div className="w-full max-w-2xl rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
            <div className="flex items-start justify-between border-b border-[var(--color-border)] p-5">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text)]">Build Terms & Conditions</h2>
                <p className="text-sm text-subtle">
                  Choose booking guardrails and EventHub will draft clear guest-facing terms.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowTermsModal(false)}>
                Close
              </Button>
            </div>
            <form action={termsAction} className="space-y-4 p-5">
              <input type="hidden" name="bookingType" value={bookingType} />
              <input type="hidden" name="ticketPrice" value={ticketPrice} />
              <input type="hidden" name="checkInCutoffMinutes" value={checkInCutoffMinutes} />
              <input type="hidden" name="cancellationWindowHours" value={cancellationWindowHours} />
              <input type="hidden" name="agePolicy" value={agePolicy} />
              <input type="hidden" name="accessibilityNotes" value={accessibilityNotes} />

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="allowsWalkIns">Allow walk-ins?</Label>
                  <Select
                    id="allowsWalkIns"
                    name="allowsWalkIns"
                    value={allowsWalkIns}
                    onChange={(event) => setAllowsWalkIns(event.target.value as "" | "yes" | "no")}
                  >
                    <option value="">Not specified</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="refundAllowed">Allow refunds?</Label>
                  <Select
                    id="refundAllowed"
                    name="refundAllowed"
                    value={refundAllowed}
                    onChange={(event) => setRefundAllowed(event.target.value as "" | "yes" | "no")}
                  >
                    <option value="">Not specified</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rescheduleAllowed">Allow reschedules?</Label>
                  <Select
                    id="rescheduleAllowed"
                    name="rescheduleAllowed"
                    value={rescheduleAllowed}
                    onChange={(event) => setRescheduleAllowed(event.target.value as "" | "yes" | "no")}
                  >
                    <option value="">Not specified</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="extraNotes">Extra policy notes</Label>
                <Textarea
                  id="extraNotes"
                  name="extraNotes"
                  rows={4}
                  value={termsExtraNotes}
                  onChange={(event) => setTermsExtraNotes(event.target.value)}
                  placeholder="Optional: no outside food/drink, dress code, late entry rules, etc."
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowTermsModal(false)}>
                  Cancel
                </Button>
                <SubmitButton label="Generate terms" pendingLabel="Generating..." variant="secondary" />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
