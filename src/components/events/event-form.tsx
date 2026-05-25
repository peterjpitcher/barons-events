"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createArtistAction } from "@/actions/artists";
import {
  generateTermsAndConditionsAction,
  generateWebsiteCopyAction,
  generateWebsiteCopyFromFormAction,
  saveEventDraftAction,
  submitEventForReviewAction
} from "@/actions/events";
import { VenueMultiSelect, type VenueOption } from "@/components/venues/venue-multi-select";
import { deriveEventFormVenueDefaults } from "@/lib/events/form-defaults";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { EventFormContext } from "@/components/events/event-form-context";
import { WebsiteListingCard } from "@/components/events/website-listing-card";
import { FloatingActionBar } from "@/components/events/floating-action-bar";
import {
  BOOKING_FORMAT_LABELS,
  BOOKING_FORMATS,
  isBookingFormat,
  isFreeBookingFormat,
  isPaidBookingFormat,
  isPayOnArrivalBookingFormat
} from "@/lib/booking-format";
import { EVENT_GOALS } from "@/lib/event-goals";
import { cn } from "@/lib/utils";
import { toLondonDateTimeInputValue } from "@/lib/datetime";
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
  users?: Array<{ id: string; name: string }>;
  /**
   * Gates the inline Delete button rendered inside the form actions. Caller
   * is responsible for computing this via canEditEventFromRow so the UI,
   * server action and RLS policy agree. Defaults to false for safety when
   * the caller forgets to pass it in edit mode.
   */
  canDelete?: boolean;
  /** When true, all form fields are disabled and save/submit actions hidden. */
  readOnly?: boolean;
  /** Submitted debrief data — when present, a "Debrief" tab is shown. */
  debrief?: {
    attendance: number | null;
    baseline_attendance: number | null;
    wet_takings: number | null;
    food_takings: number | null;
    baseline_wet_takings: number | null;
    baseline_food_takings: number | null;
    actual_total_takings: number | null;
    baseline_total_takings: number | null;
    sales_uplift_value: number | null;
    sales_uplift_percent: number | null;
    promo_effectiveness: number | null;
    would_book_again: boolean | null;
    highlights: string | null;
    issues: string | null;
    guest_sentiment_notes: string | null;
    operational_notes: string | null;
    next_time_actions: string | null;
    labour_hours?: number | null;
    labour_rate_gbp_at_submit?: number | null;
    submitted_at: string;
    [key: string]: unknown;
  } | null;
};

function toLocalInputValue(date?: string | null) {
  return toLondonDateTimeInputValue(date);
}

function addHours(localIso: string, hours: number) {
  if (!localIso) return "";
  const parsed = localIso.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!parsed) return "";

  const year = Number(parsed[1]);
  const month = Number(parsed[2]);
  const day = Number(parsed[3]);
  const hour = Number(parsed[4]);
  const minute = Number(parsed[5]);
  const base = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  if (Number.isNaN(base.getTime())) return "";

  base.setUTCHours(base.getUTCHours() + hours);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  const d = String(base.getUTCDate()).padStart(2, "0");
  const h = String(base.getUTCHours()).padStart(2, "0");
  const min = String(base.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
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
  initialStartAt,
  initialEndAt,
  initialVenueId,
  users,
  canDelete = false,
  readOnly = false,
  debrief = null
}: EventFormProps) {
  const [draftState, draftAction, isSavingPending] = useActionState(saveEventDraftAction, undefined);
  const [submitState, submitAction, isSubmittingPending] = useActionState(submitEventForReviewAction, undefined);
  const [websiteCopyState, websiteCopyAction, isGeneratingEditPending] = useActionState(generateWebsiteCopyAction, undefined);
  const [websiteCopyFormState, websiteCopyFormAction, isGeneratingFormPending] = useActionState(generateWebsiteCopyFromFormAction, undefined);
  const isGeneratingPending = isGeneratingEditPending || isGeneratingFormPending;
  const activeWebsiteCopyAction = mode === "create" ? websiteCopyFormAction : websiteCopyAction;
  const [termsState, termsAction] = useActionState(generateTermsAndConditionsAction, undefined);
  const [artistCreateState, createArtistFormAction] = useActionState(createArtistAction, undefined);
  const [intent, setIntent] = useState<"draft" | "submit" | "generate">("draft");
  const [isDirty, setIsDirty] = useState(false);
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
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSlow, setIsSlow] = useState(false);

  // Refs for proxy buttons and form (tabbed mode)
  const formRef = useRef<HTMLFormElement>(null);
  const proxyDraftRef = useRef<HTMLButtonElement>(null);
  const proxySubmitRef = useRef<HTMLButtonElement>(null);
  const proxyGenerateRef = useRef<HTMLButtonElement>(null);
  const artistModalRef = useRef<HTMLDivElement>(null);
  const termsModalRef = useRef<HTMLDivElement>(null);

  // Form-mount correlation ids. `operation_id` is echoed back through the
  // server action's ActionResult so error toasts can surface a short hash for
  // support. `idempotency_key` is reserved for the Phase B′ atomic-save RPC
  // (Action Rewirer wave) — emit it now so the field exists when that lands.
  // Regenerated after every successful save (effect below).
  const operationIdRef = useRef<string>(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "00000000-0000-4000-8000-000000000000"
  );
  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "00000000-0000-4000-8000-000000000001"
  );
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(defaultValues?.updated_at ?? "");

  useEffect(() => {
    if (!draftState?.message) return;
    if (draftState.success) {
      toast.success(draftState.message);
      // Phase B′ image-state-machine: surface non-blocking warnings from the
      // RPC path. Storage upload or attach failures still leave the row
      // saved, so we treat them as warnings (not errors) and let the daily
      // reconcile cron retry the attach.
      if (draftState.warnings?.includes("image-upload-failed")) {
        toast.warning("Saved, but the image upload failed. Try uploading again.");
      } else if (draftState.warnings?.includes("image-attach-pending")) {
        toast.warning("Saved, but the image is still attaching. It will appear shortly.");
      }
    } else {
      // Append the short hash of the operation_id so the user can quote it
      // in support requests; server logs and audit-log meta share the same
      // value, making lookups straightforward.
      toast.error(
        draftState.operationId
          ? `${draftState.message} (ref: ${draftState.operationId.slice(0, 8)})`
          : draftState.message
      );
    }
  }, [draftState]);


  useEffect(() => {
    if (!submitState?.message) return;
    if (submitState.success) {
      toast.success(submitState.message);
      if (submitState.warnings?.includes("image-upload-failed")) {
        toast.warning("Submitted, but the image upload failed. Try uploading again.");
      } else if (submitState.warnings?.includes("image-attach-pending")) {
        toast.warning("Submitted, but the image is still attaching. It will appear shortly.");
      }
    } else {
      toast.error(
        submitState.operationId
          ? `${submitState.message} (ref: ${submitState.operationId.slice(0, 8)})`
          : submitState.message
      );
    }
  }, [submitState]);

  useEffect(() => {
    if (!websiteCopyState?.message) return;
    if (websiteCopyState.success) {
      toast.success(websiteCopyState.message);
    } else {
      toast.error(websiteCopyState.message);
    }
  }, [websiteCopyState]);

  useEffect(() => {
    if (!websiteCopyFormState?.message) return;
    if (websiteCopyFormState.success) {
      toast.success(websiteCopyFormState.message);
    } else {
      toast.error(websiteCopyFormState.message);
    }
  }, [websiteCopyFormState]);

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

  // Warn user before navigating away from a dirty form
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Reset dirty flag and record save timestamp on successful save or submit
  useEffect(() => {
    if (draftState?.success) {
      setIsDirty(false);
      setLastSavedAt(new Date());
      // Rotate correlation ids so the next save gets fresh ones — without
      // this, a re-submission would replay the same operation_id and (in the
      // upcoming RPC path) the same idempotency_key.
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        operationIdRef.current = crypto.randomUUID();
        idempotencyKeyRef.current = crypto.randomUUID();
      }
      setExpectedUpdatedAt(draftState.updatedAt ?? "");
    }
  }, [draftState]);
  useEffect(() => {
    if (submitState?.success) {
      setIsDirty(false);
      setLastSavedAt(new Date());
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        operationIdRef.current = crypto.randomUUID();
        idempotencyKeyRef.current = crypto.randomUUID();
      }
      setExpectedUpdatedAt(submitState.updatedAt ?? "");
    }
  }, [submitState]);

  useEffect(() => {
    setAvailableArtists((current) => mergeArtistOptions(current, artists));
  }, [artists]);

  useEffect(() => {
    if (!showArtistModal) return;
    artistModalRef.current?.focus();
  }, [showArtistModal]);

  useEffect(() => {
    if (!showTermsModal) return;
    termsModalRef.current?.focus();
  }, [showTermsModal]);

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
    toast.error(artistCreateState.message ?? "Could not add artist.");
  }, [artistCreateState]);

  const canChooseVenue = role === "administrator" || (mode === "create" && role === "office_worker");
  const initialVenueDefaults = deriveEventFormVenueDefaults({
    mode,
    initialVenueId,
    eventVenueId: defaultValues?.venue_id ?? null,
    eventVenues: (defaultValues as { venues?: Array<{ id: string }> } | undefined)?.venues ?? null,
    availableVenueIds: venues.map((venue) => venue.id)
  });
  const defaultVenueId = initialVenueDefaults.primaryVenueId;
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
  const [eventTypeValue, setEventTypeValue] = useState(defaultValues?.event_type ?? "");
  const [selectedVenueId, setSelectedVenueId] = useState(defaultVenueId);
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>(initialVenueDefaults.selectedVenueIds);
  const [venueSpaceValue, setVenueSpaceValue] = useState(defaultValues?.venue_space ?? "");
  const [startValue, setStartValue] = useState(toLocalInputValue(defaultValues?.start_at ?? initialStartAt));
  const [endValue, setEndValue] = useState(toLocalInputValue(defaultValues?.end_at ?? initialEndAt));
  const [endDirty, setEndDirty] = useState(Boolean(defaultValues?.end_at ?? initialEndAt));
  const [eventNotes, setEventNotes] = useState(defaultValues?.notes ?? "");
  const [managerResponsibleId, setManagerResponsibleId] = useState<string>((defaultValues as any)?.manager_responsible_id ?? "");
  const [managerDirty, setManagerDirty] = useState(Boolean((defaultValues as any)?.manager_responsible_id));
  const [bookingType, setBookingType] = useState(defaultValues?.booking_type ?? "");
  const selectedBookingFormat = isBookingFormat(bookingType) ? bookingType : null;
  const isFreeBookingSelected = selectedBookingFormat ? isFreeBookingFormat(selectedBookingFormat) : false;
  const isPaidBookingSelected = selectedBookingFormat ? isPaidBookingFormat(selectedBookingFormat) : false;
  const isPayOnArrivalBookingSelected = selectedBookingFormat ? isPayOnArrivalBookingFormat(selectedBookingFormat) : false;
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
  const [seoTitle, setSeoTitle] = useState(defaultValues?.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(defaultValues?.seo_description ?? "");
  const [seoSlug, setSeoSlug] = useState(defaultValues?.seo_slug ?? "");

  useEffect(() => {
    if (isFreeBookingSelected && ticketPrice) {
      setTicketPrice("");
    }
  }, [isFreeBookingSelected, ticketPrice]);

  // NOTE: a prop-reset useEffect (keyed on `defaultValues?.id`) used to live
  // here to re-seed every controlled state when an `id` change came in via
  // props. It has been removed. Parents now mount this form with
  // `key={defaultValues?.id ?? "new"}`, which means a different event id
  // triggers a full unmount/remount and the state initialisers above re-run.
  // For same-id revalidation (e.g. `revalidatePath` after a peripheral
  // mutation), the form state stays exactly as the user left it.

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

  useEffect(() => {
    if (!websiteCopyFormState?.success || !websiteCopyFormState.values) return;
    setPublicTitle(websiteCopyFormState.values.publicTitle ?? "");
    setPublicTeaser(websiteCopyFormState.values.publicTeaser ?? "");
    setPublicDescription(websiteCopyFormState.values.publicDescription ?? "");
    setPublicHighlights((websiteCopyFormState.values.publicHighlights ?? []).join("\n"));
    setSeoTitle(websiteCopyFormState.values.seoTitle ?? "");
    setSeoDescription(websiteCopyFormState.values.seoDescription ?? "");
    setSeoSlug(websiteCopyFormState.values.seoSlug ?? "");
  }, [websiteCopyFormState]);

  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === selectedVenueId) ?? venues.find((venue) => venue.id === defaultVenueId),
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

  const typeOptions = useMemo(() => {
    const base = eventTypes.length ? eventTypes : ["General"];
    const baseSet = new Set(base);
    const options = base.map((label) => ({ label, isLegacy: false }));
    if (eventTypeValue && !baseSet.has(eventTypeValue)) {
      options.push({ label: eventTypeValue, isLegacy: true });
    }
    return options;
  }, [eventTypes, eventTypeValue]);
  const canGenerateWebsiteCopy = mode === "edit"
    ? Boolean(defaultValues?.id) && ["approved", "completed"].includes(defaultValues?.status ?? "")
    : true;

  function handleVenueChange(value: string) {
    setSelectedVenueId(value);
    setSelectedVenueIds(value ? [value] : []);
    if (!managerDirty) {
      const venue = venues.find((v) => v.id === value);
      setManagerResponsibleId(venue?.default_manager_responsible_id ?? "");
    }
  }

  function handleVenueMultiChange(ids: string[]) {
    setSelectedVenueIds(ids);
    // Keep the single selectedVenueId in sync with the first selection, so the
    // single-venue fallback path (and downstream state like defaultManager) still works.
    const primary = ids[0] ?? "";
    setSelectedVenueId(primary);
    if (!managerDirty) {
      const venue = venues.find((v) => v.id === primary);
      setManagerResponsibleId(venue?.default_manager_responsible_id ?? "");
    }
    setIsDirty(true);
  }

  useEffect(() => {
    if (!managerDirty && selectedVenueId) {
      const venue = venues.find((v) => v.id === selectedVenueId);
      if (venue?.default_manager_responsible_id) {
        setManagerResponsibleId(venue.default_manager_responsible_id);
      }
    }
    // Only run on mount
  }, []);

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

    setIntent(nextIntent);
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

  // Multi-venue capability: administrators can tick multiple venues. One
  // event is produced that's linked to all selected venues — no more N-events.
  const isMultiCapable = role === "administrator" && venues.length > 1;

  const activeState = intent === "submit" ? submitState : draftState;
  const fieldErrors = activeState?.fieldErrors ?? {};

  // Auto-scroll to the first invalid field when errors appear
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  useEffect(() => {
    if (!hasFieldErrors) return;
    const timer = setTimeout(() => {
      document.querySelector('[aria-invalid="true"]')?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }, 100);
    return () => clearTimeout(timer);
  }, [hasFieldErrors]);

  const isPending = isSavingPending || isSubmittingPending || isGeneratingPending;

  // Show slow-save warning after 8 seconds
  useEffect(() => {
    if (!isPending) {
      setIsSlow(false);
      return;
    }
    const timer = setTimeout(() => setIsSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [isPending]);

  // ─── Button labels per role + status ──────────────────────────────────────
  const eventStatus = defaultValues?.status ?? "draft";

  const primaryLabel = (() => {
    if (mode === "create") return "Save draft";
    if (eventStatus === "approved_pending_details") return "Save details";
    if (role === "administrator" && eventStatus === "approved") return "Save & re-publish";
    return "Save changes";
  })();

  const showSecondaryAction = (() => {
    // Pre-event proposal flow: approved_pending_details transitions to draft
    // automatically when the required fields are saved. No separate "submit"
    // button is needed until it reaches normal draft state.
    if (eventStatus === "approved_pending_details") return false;
    // pending_approval is not editable via this form — the admin approves/
    // rejects via the pending queue. Guard anyway.
    if (eventStatus === "pending_approval") return false;
    if (role === "administrator") {
      // No secondary for approved or completed — primary handles it
      return eventStatus !== "approved" && eventStatus !== "completed";
    }
    if (role === "office_worker") {
      // Can only submit drafts or revisions
      return eventStatus === "draft" || eventStatus === "needs_revisions";
    }
    return false;
  })();

  const secondaryLabel = (() => {
    if (role === "administrator") {
      if (mode === "create") return "Save & publish";
      return "Publish";
    }
    return "Submit for review";
  })();

  const contextValue = {
    saveDraft: () => {
      if (formRef.current && proxyDraftRef.current) {
        formRef.current.requestSubmit(proxyDraftRef.current);
      }
    },
    submitForReview: () => {
      if (formRef.current && proxySubmitRef.current) {
        formRef.current.requestSubmit(proxySubmitRef.current);
      }
    },
    generateWebsiteCopy: () => {
      if (formRef.current && proxyGenerateRef.current) {
        formRef.current.requestSubmit(proxyGenerateRef.current);
      }
    },
    isSaving: isSavingPending,
    isSubmitting: isSubmittingPending,
    isGenerating: isGeneratingPending,
    isPending,
    mode,
    canGenerateWebsiteCopy,
    primaryLabel,
    secondaryLabel,
    showSecondaryAction
  };

  // ─── Shared field blocks (used in both tabbed and legacy layouts) ──────────

  const titleAndVenueFields = (
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
        <Label htmlFor="venueId">{isMultiCapable ? "Venues" : "Venue"}</Label>
        {isMultiCapable ? (
          <>
            <VenueMultiSelect
              venues={venues.map((venue) => ({
                id: venue.id,
                name: venue.name,
                 
                category: (venue as any).category === "cafe" ? "cafe" : "pub",
                isInternal: Boolean((venue as any).is_internal)
              } satisfies VenueOption))}
              selectedIds={selectedVenueIds}
              onChange={handleVenueMultiChange}
              hiddenFieldName="venueIds"
            />
          </>
        ) : canChooseVenue ? (
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
            <option value="" disabled>Choose venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>{venue.name}</option>
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
        <p className="text-xs text-subtle">
          {isMultiCapable
            ? "Pick one or more venues — the event will be linked to all of them. Tasks marked \"one per venue\" on the SOP will fan out automatically."
            : "Pick the host venue—this controls which spaces appear below."}
        </p>
      </div>
    </div>
  );

  const eventTypeField = (
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
          <option value="">Choose event type</option>
          {typeOptions.map(({ label, isLegacy }) => (
            <option key={label} value={label}>
              {label}{isLegacy ? " (legacy — pick a current type)" : ""}
            </option>
          ))}
        </Select>
        <FieldError id="event-type-error" message={fieldErrors.eventType} />
        <p className="text-xs text-subtle">
          {role === "administrator"
            ? "Need a new option? Add it in Settings."
            : "Need a new option? Contact your administrator to add new event types."}
        </p>
    </div>
  );

  const notesField = (
    <div className="space-y-2">
      <Label htmlFor="eventDetails">Event details</Label>
      <Textarea
        id="eventDetails"
        name="notes"
        rows={5}
        value={eventNotes}
        onChange={(event) => setEventNotes(event.target.value)}
        placeholder="Add all the details about the event here — it doesn't need to be structured."
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
  );

  const managerResponsibleField = (
    <div className="space-y-2">
      <Label htmlFor="managerResponsibleId">Manager Responsible</Label>
      <select
        id="managerResponsibleId"
        name="managerResponsibleId"
        value={managerResponsibleId}
        onChange={(e) => {
          setManagerDirty(true);
          setManagerResponsibleId(e.target.value);
        }}
        className="flex h-10 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-400)] focus-visible:ring-offset-2"
      >
        <option value="">No manager assigned</option>
        {(users ?? []).map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
      <p className="text-xs text-subtle">
        The on-site manager accountable for this event.
      </p>
    </div>
  );

  const artistsField = (
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
  );

  const timingFields = (
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
        <p className="text-xs text-subtle">We&apos;ll auto-fill three hours after the start—adjust if the event runs longer or shorter.</p>
      </div>
    </div>
  );

  const spacesField = (
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
  );

  const eventImageField = (
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
  );

  const promosFields = (
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
  );

  const headcountField = (
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
  );

  const bookingFields = (
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
          <option value="" disabled>Choose booking format</option>
          {BOOKING_FORMATS.map((format) => (
            <option key={format} value={format}>{BOOKING_FORMAT_LABELS[format]}</option>
          ))}
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
          disabled={isFreeBookingSelected}
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
          {isFreeBookingSelected
            ? "No price for free formats."
            : isPaidBookingSelected
            ? "Required for paid events."
            : isPayOnArrivalBookingSelected
              ? "Optional, shown as pay-on-arrival price."
              : "Choose a booking format to set price rules."}
        </p>
      </div>
    </div>
  );

  const cutoffAndCancellationFields = (
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
          {isFreeBookingSelected
            ? "Optional for free-entry events."
            : "Required for bookable events so guests get a clear cancellation/refund policy."}
        </p>
      </div>
    </div>
  );

  const agePolicyAndAccessibilityFields = (
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
  );

  const termsField = (
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
  );

  const financialsSection = (
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
  );

  const goalsSection = (
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
  );

  const websiteFields = (
    <>
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
          placeholder="- Live entertainment from 8pm&#10;- Signature cocktails and food pairings&#10;- Limited spaces, advance booking advised"
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
    </>
  );

  // ─── Modals ───────────────────────────────────────────────────────────────

  const artistModal = showArtistModal ? (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(39,54,64,0.55)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Select artists"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") setShowArtistModal(false); }}
      ref={artistModalRef}
    >
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
                    <option key={option.value} value={option.value}>{option.label}</option>
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
                      <option key={option.value} value={option.value}>{option.label}</option>
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
  ) : null;

  const termsModal = showTermsModal ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(39,54,64,0.5)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Generate terms and conditions"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") setShowTermsModal(false); }}
      ref={termsModalRef}
    >
      <div className="w-full max-w-2xl rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
        <div className="flex items-start justify-between border-b border-[var(--color-border)] p-5">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Build Terms & Conditions</h2>
            <p className="text-sm text-subtle">
              Choose booking guardrails and BaronsHub will draft clear guest-facing terms.
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
  ) : null;

  // ─── Two-column layout ────────────────────────────────────────────────────

  return (
    <EventFormContext.Provider value={contextValue}>
      <form ref={formRef} action={draftAction} noValidate onSubmit={handleSubmit} onChange={() => setIsDirty(true)}>
        <input type="hidden" name="eventId" defaultValue={defaultValues?.id} />
        <input type="hidden" name="operation_id" value={operationIdRef.current} readOnly />
        <input type="hidden" name="idempotency_key" value={idempotencyKeyRef.current} readOnly />
        {mode === "edit" && expectedUpdatedAt ? (
          <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} readOnly />
        ) : null}
        {activeState && !activeState.success && activeState.message && !activeState.fieldErrors && (
          <div className="mb-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger)]/10 p-4 text-sm text-[var(--color-danger)]" role="alert">
            <strong>Something went wrong:</strong> {activeState.message}
          </div>
        )}
        {activeState?.success && activeState?.message && (
          <div className="mb-4 rounded-lg border border-[var(--color-success)] bg-[var(--color-success)]/10 p-4 text-sm text-[var(--color-success)]" role="status">
            {activeState.message}
          </div>
        )}
        <div className="mb-4 flex items-center gap-2">
          {isPending ? (
            <span className="text-xs text-[var(--color-text-muted)] animate-pulse">
              {isSlow ? "Still saving — please don't navigate away..." : "Saving..."}
            </span>
          ) : lastSavedAt ? (
            <span className="text-xs text-[var(--color-text-muted)]">
              Last saved: {lastSavedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : isDirty ? (
            <span className="text-xs text-[var(--color-warning)]">Unsaved changes</span>
          ) : null}
        </div>
        {/* Proxy buttons — sr-only, clicked programmatically from FAB */}
        <button ref={proxyDraftRef} type="submit" data-intent="draft" aria-hidden="true" tabIndex={-1} className="sr-only" />
        <button ref={proxySubmitRef} type="submit" formAction={submitAction} data-intent="submit" aria-hidden="true" tabIndex={-1} className="sr-only" />
        <button ref={proxyGenerateRef} type="submit" formAction={activeWebsiteCopyAction} data-intent="generate" aria-hidden="true" tabIndex={-1} className="sr-only" />

        <fieldset disabled={isPending || readOnly} className="disabled:opacity-60">
          {/* Two-column layout */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left column: Event Details */}
            <Card>
              <CardHeader className="!rounded-t-[var(--radius-lg)] !bg-[var(--color-primary-700)] px-6 py-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider !text-white">
                  Event Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Row 1: Title + Venue (side by side — already a grid) */}
                {titleAndVenueFields}

                {/* Row 2: Event type + Manager side by side */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>{eventTypeField}</div>
                  <div>{managerResponsibleField}</div>
                </div>

                {/* Row 3: Timing (Start + End — already a grid) */}
                {timingFields}

                {/* Row 4: Spaces + Artists side by side */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>{spacesField}</div>
                  <div>{artistsField}</div>
                </div>

                {/* Row 5: Notes (full width textarea) */}
                {notesField}

                {/* Row 6: Event image */}
                {eventImageField}
              </CardContent>
            </Card>

            {/* Right column: Website Listing */}
            <WebsiteListingCard
              websiteFields={websiteFields}
              generateAction={activeWebsiteCopyAction}
              canGenerate={canGenerateWebsiteCopy}
              readOnly={readOnly}
            />
          </div>

          {/* Lower: Booking & Ticketing */}
          <Card className="mt-6">
            <CardHeader className="!rounded-t-[var(--radius-lg)] !bg-[var(--color-primary-700)] px-6 py-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider !text-white">
                Booking &amp; Ticketing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {promosFields}
              {headcountField}
              {bookingFields}
              {cutoffAndCancellationFields}
              {agePolicyAndAccessibilityFields}
              {termsField}
              {financialsSection}
              {goalsSection}
            </CardContent>
          </Card>
        </fieldset>
      </form>

      {!readOnly ? <FloatingActionBar /> : null}

      {artistModal}
      {termsModal}
    </EventFormContext.Provider>
  );
}
