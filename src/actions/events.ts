"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { canReviewEvents, canProposeEvents, canEditEvent } from "@/lib/roles";
import { loadEventEditContext } from "@/lib/events/edit-context";
import { appendEventVersion, createEventDraft, createEventPlanningItem, ensureEventPlanningItem, recordApproval, softDeleteEvent, updateEventDraft, updateEventAssignee } from "@/lib/events";
import {
  buildSaveEventDraftPayload,
  callSaveEventDraftRpc,
  callSubmitEventForReviewRpc,
  type SaveEventDraftRpcResult
} from "@/lib/events/save-rpc";
import { generateUniqueEventSlug } from "@/lib/bookings";
import { cleanupOrphanArtists, parseArtistNames, syncEventArtists } from "@/lib/artists";
import { eventDraftSchema, eventFormSchema, bookingUrlSchema } from "@/lib/validation";
import { getFieldErrors } from "@/lib/form-errors";
import type { ActionResult, EventStatus } from "@/lib/types";
import type { Database } from "@/lib/supabase/database.types";
import { sendAssigneeReassignmentEmail, sendEventSubmittedEmail, sendNewEventAnnouncementEmail, sendReviewDecisionEmail } from "@/lib/notifications";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { generateTermsAndConditions, generateWebsiteCopy, type GeneratedWebsiteCopy } from "@/lib/ai";
import { isBookingFormat, isFreeBookingFormat, type BookingFormat } from "@/lib/booking-format";
import { normaliseEventDateTimeForStorage } from "@/lib/datetime";
import { normaliseSopNotRequiredTemplateIds } from "@/lib/planning/sop";
import { getOrCreateTrackedBookingUrl, type TrackedBookingUrlStatus } from "@/lib/event-booking-links";
import {
  normaliseOptionalText as normaliseOptionalTextField,
  normaliseOptionalNumber as normaliseOptionalNumberField,
  normaliseOptionalInteger as normaliseOptionalIntegerField,
} from "@/lib/normalise";
import { canOfficeWorkerUseVenueSelection } from "@/lib/visibility";
import { logEventAction } from "@/lib/observability/event-action-log";

const reviewerFallback = z.string().uuid().optional();

/**
 * Reads the form-mounted correlation id from FormData. The client-side
 * EventForm seeds this via a hidden `operation_id` input so that error
 * toasts, server logs and audit-log meta share a single hash for support.
 *
 * Falls back to a fresh UUID when the client did not send one or sent a
 * malformed value, so server logs always have a correlation id even on
 * direct/test invocations.
 */
function readOperationId(formData: FormData): string {
  const raw = formData.get("operation_id");
  if (typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return raw;
  }
  return crypto.randomUUID();
}

/**
 * Reads the form-mounted persistent idempotency key. Used by the Phase B′
 * atomic-save RPC to deduplicate retries — same key + same user replays the
 * stored response without writing again. Falls back to a fresh UUID when the
 * client did not send one (legacy callers, test invocations).
 */
function readIdempotencyKey(formData: FormData): string {
  const raw = formData.get("idempotency_key");
  if (typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return raw;
  }
  return crypto.randomUUID();
}

/**
 * Reads the optional optimistic-concurrency token (the row's last-known
 * `updated_at`). Returned as an ISO string for the RPC, or null when the
 * client did not send one (e.g. first save of a new draft).
 */
function readExpectedUpdatedAt(formData: FormData): string | null {
  const raw = formData.get("expected_updated_at");
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  return null;
}

/** Phase B′ atomic-save feature flag. */
function shouldUseSaveEventRpc(): boolean {
  return process.env.EVENT_SAVE_USE_RPC === "true";
}

type EventsTable = Database["public"]["Tables"]["events"];
type EventRowUpdate = EventsTable["Update"];

/**
 * Compensating image upload + attach for the RPC path.
 *
 * The atomic save RPC writes only the events row + linked tables; the binary
 * image upload is a separate side effect that cannot share the RPC's
 * transaction. We follow a two-phase commit:
 *   1. Upload the bytes to storage (idempotent — overwrite uses upsert).
 *   2. UPDATE events.event_image_path to attach.
 * If step 1 fails we record an `image-upload-failed` warning. If step 1
 * succeeds but step 2 fails we set `pending_image_attach` so the daily cron
 * (`/api/cron/reconcile-event-images`) can attach later, and surface an
 * `image-attach-pending` warning.
 */
async function attachEventImageAfterRpc(args: {
  eventId: string;
  file: File;
  operationId: string;
}): Promise<{ warning?: "image-upload-failed" | "image-attach-pending" }> {
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    console.error(
      `[event-save-rpc:${args.operationId.slice(0, 8)}] Service-role client unavailable for image upload:`,
      error
    );
    return { warning: "image-upload-failed" };
  }

  const fileExtRaw = (() => {
    const parsed = args.file.name.split(".");
    if (parsed.length < 2) return "";
    return parsed[parsed.length - 1];
  })();
  const fileExt = sanitiseFileName(fileExtRaw).slice(0, 10) ||
    (typeof args.file.type === "string" && args.file.type.startsWith("image/")
      ? args.file.type.split("/")[1] ?? "bin"
      : "bin");
  const path = `${args.eventId}/${Date.now()}.${fileExt}`;
  const bytes = Buffer.from(await args.file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from(EVENT_IMAGE_BUCKET)
    .upload(path, bytes, {
      contentType: args.file.type || "application/octet-stream",
      upsert: true
    });

  if (uploadError) {
    console.error(
      `[event-save-rpc:${args.operationId.slice(0, 8)}] Storage upload failed:`,
      uploadError
    );
    return { warning: "image-upload-failed" };
  }

  const attachUpdate: EventRowUpdate = {
    event_image_path: path,
    pending_image_attach: null
  };
  const { error: attachError } = await admin
    .from("events")
    .update(attachUpdate)
    .eq("id", args.eventId);

  if (attachError) {
    // Storage succeeded but the second write failed. Flag for reconciliation.
    console.error(
      `[event-save-rpc:${args.operationId.slice(0, 8)}] Image attach failed; flagging for reconcile:`,
      attachError
    );
    const pendingUpdate: EventRowUpdate = { pending_image_attach: path };
    const { error: pendingError } = await admin
      .from("events")
      .update(pendingUpdate)
      .eq("id", args.eventId);
    if (pendingError) {
      console.error(
        `[event-save-rpc:${args.operationId.slice(0, 8)}] Failed to set pending_image_attach:`,
        pendingError
      );
    }
    return { warning: "image-attach-pending" };
  }

  return {};
}

/**
 * Keeps the event_venues join table in sync with the picked venue list.
 * Calls the set_event_venues SECURITY DEFINER helper — first id becomes
 * primary, parent events.venue_id is updated to match.
 */
async function syncEventVenueAttachments(eventId: string, venueIds: string[]): Promise<void> {
  if (!eventId) return;
  const db = createSupabaseAdminClient();
   
  const { error } = await db.rpc("set_event_venues", {
    p_event_id: eventId,
    p_venue_ids: venueIds
  });
  if (error) {
    console.error("syncEventVenueAttachments RPC failed:", error);
  }
}

type WebsiteCopyValues = {
  publicTitle: string | null;
  publicTeaser: string | null;
  publicDescription: string | null;
  publicHighlights: string[] | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoSlug: string | null;
};

type WebsiteCopyActionResult = ActionResult & {
  values?: WebsiteCopyValues;
};

type TermsActionResult = ActionResult & {
  terms?: string;
};

const EVENT_IMAGE_BUCKET = "event-images";
const MAX_EVENT_IMAGE_BYTES = 10 * 1024 * 1024;
const ARTIST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEBSITE_COPY_AUDIT_CHANGES = [
  "Public title",
  "Public teaser",
  "Public description",
  "Public highlights",
  "SEO title",
  "SEO description",
  "SEO slug"
] as const;
const WEBSITE_COPY_EVENT_SELECT = `
  id,
  created_by,
  assignee_id,
  title,
  event_type,
  status,
  start_at,
  end_at,
  venue_space,
  expected_headcount,
  wet_promo,
  food_promo,
  goal_focus,
  cost_total,
  cost_details,
  booking_type,
  ticket_price,
  check_in_cutoff_minutes,
  age_policy,
  accessibility_notes,
  cancellation_window_hours,
  terms_and_conditions,
  public_title,
  public_teaser,
  public_description,
  public_highlights,
  booking_url,
  notes,
  venue:venues!events_venue_id_fkey(name,address),
  artists:event_artists(
    billing_order,
    artist:artists(name,description)
  )
`;

type ActionSupabaseClient = Awaited<ReturnType<typeof createSupabaseActionClient>>;
type WebsiteCopyEventRecord = {
  id: string;
  created_by: string | null;
  assignee_id: string | null;
  title: string | null;
  event_type: string | null;
  status: string | null;
  start_at: string | null;
  end_at: string | null;
  venue_space: string | null;
  expected_headcount: number | null;
  wet_promo: string | null;
  food_promo: string | null;
  goal_focus: string | null;
  cost_total: number | null;
  cost_details: string | null;
  booking_type: string | null;
  ticket_price: number | null;
  check_in_cutoff_minutes: number | null;
  age_policy: string | null;
  accessibility_notes: string | null;
  cancellation_window_hours: number | null;
  terms_and_conditions: string | null;
  public_title: string | null;
  public_teaser: string | null;
  public_description: string | null;
  public_highlights: unknown;
  booking_url: string | null;
  notes: string | null;
  venue: unknown;
  artists: unknown;
};

function normaliseVenueSpacesField(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") {
    return "";
  }
  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return "";
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  entries.forEach((entry) => {
    const key = entry.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  });
  return unique.join(", ");
}

function normaliseOptionalHighlightsField(value: FormDataEntryValue | null): string[] | null {
  if (typeof value !== "string") return null;
  const highlights = value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  return highlights.length ? highlights : null;
}

function normaliseOptionalBookingTypeField(value: FormDataEntryValue | null): BookingFormat | null {
  if (typeof value !== "string") return null;
  return isBookingFormat(value) ? value : null;
}

function normaliseTicketPriceForBookingFormat(
  bookingType: BookingFormat | null | undefined,
  ticketPrice: number | null | undefined
): number | null {
  if (bookingType && isFreeBookingFormat(bookingType)) {
    return null;
  }
  return ticketPrice ?? null;
}

function sanitiseFileName(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
  return cleaned.length ? cleaned : "event-image";
}

function normaliseArtistNameList(value: FormDataEntryValue | null): string[] {
  return parseArtistNames(typeof value === "string" ? value : null);
}

function normaliseArtistIdList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item): item is string => ARTIST_ID_PATTERN.test(item))
    )
  );
}

function artistListsDiffer(previous: string[], next: string[]): boolean {
  if (previous.length !== next.length) return true;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index].toLowerCase() !== next[index].toLowerCase()) {
      return true;
    }
  }
  return false;
}

function getFormValue(formData: FormData | undefined, key: string): FormDataEntryValue | null {
  if (!formData) return null;
  return formData.get(key);
}

function getFormValues(formData: FormData | undefined, key: string): FormDataEntryValue[] {
  if (!formData) return [];
  return formData.getAll(key);
}

function toWebsiteCopyValues(generated: GeneratedWebsiteCopy): WebsiteCopyValues {
  return {
    publicTitle: generated.publicTitle,
    publicTeaser: generated.publicTeaser,
    publicDescription: generated.publicDescription,
    publicHighlights: generated.publicHighlights,
    seoTitle: generated.seoTitle,
    seoDescription: generated.seoDescription,
    seoSlug: generated.seoSlug
  };
}

function buildWebsiteCopyUpdatePayload(generated: GeneratedWebsiteCopy): Record<string, unknown> {
  return {
    public_title: generated.publicTitle,
    public_teaser: generated.publicTeaser,
    public_description: generated.publicDescription,
    public_highlights: generated.publicHighlights,
    seo_title: generated.seoTitle,
    seo_description: generated.seoDescription,
    seo_slug: generated.seoSlug
  };
}

function buildWebsiteCopyInput(record: WebsiteCopyEventRecord, formData?: FormData) {
  const venueSpaces =
    typeof record.venue_space === "string"
      ? record.venue_space
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

  const formVenueSpaces = normaliseVenueSpacesField(getFormValue(formData, "venueSpace"))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const mergedVenueSpaces = formVenueSpaces.length ? formVenueSpaces : venueSpaces;

  const formGoalFocus = getFormValues(formData, "goalFocus")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  const recordGoalFocus =
    typeof record.goal_focus === "string"
      ? record.goal_focus
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  const goalFocus = formGoalFocus.length ? formGoalFocus : recordGoalFocus;

  type EmbeddedVenue = { name?: string | null; address?: string | null } | null | undefined;
  const venueValue: EmbeddedVenue = Array.isArray(record.venue)
    ? (record.venue[0] as EmbeddedVenue)
    : (record.venue as EmbeddedVenue);
  const venueName = typeof venueValue?.name === "string" ? venueValue.name : null;
  const venueAddress = typeof venueValue?.address === "string" ? venueValue.address : null;

  type EmbeddedArtistEntry = {
    artist?: { name?: string | null } | Array<{ name?: string | null }> | null;
  };
  const formArtistNames = normaliseArtistNameList(getFormValue(formData, "artistNames"));
  const recordArtistNames = Array.isArray(record.artists)
    ? (record.artists as EmbeddedArtistEntry[])
        .map((entry) => {
          const artistValue = Array.isArray(entry?.artist) ? entry.artist[0] : entry?.artist;
          return typeof artistValue?.name === "string" ? artistValue.name.trim() : null;
        })
        .filter((name): name is string => Boolean(name))
    : [];
  const artistNames = formArtistNames.length ? formArtistNames : recordArtistNames;

  const formBookingType = normaliseOptionalBookingTypeField(getFormValue(formData, "bookingType"));
  const recordBookingType = isBookingFormat(record.booking_type)
    ? record.booking_type
    : null;
  const bookingType = formBookingType ?? recordBookingType;

  const formPublicHighlights = normaliseOptionalHighlightsField(getFormValue(formData, "publicHighlights"));
  const recordPublicHighlights = Array.isArray(record.public_highlights)
    ? record.public_highlights
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : null;
  const inputHighlights = formPublicHighlights ?? recordPublicHighlights;
  const startAtRaw = normaliseOptionalTextField(getFormValue(formData, "startAt")) ?? record.start_at ?? "";
  const endAtRaw = normaliseOptionalTextField(getFormValue(formData, "endAt")) ?? record.end_at ?? "";

  return {
    title: normaliseOptionalTextField(getFormValue(formData, "title")) ?? record.title ?? "",
    eventType: normaliseOptionalTextField(getFormValue(formData, "eventType")) ?? record.event_type ?? "",
    startAt: startAtRaw ? normaliseEventDateTimeForStorage(startAtRaw) : "",
    endAt: endAtRaw ? normaliseEventDateTimeForStorage(endAtRaw) : "",
    artistNames,
    venueName,
    venueAddress,
    venueSpaces: mergedVenueSpaces,
    goalFocus,
    expectedHeadcount:
      normaliseOptionalNumberField(getFormValue(formData, "expectedHeadcount")) ??
      (typeof record.expected_headcount === "number" ? record.expected_headcount : null),
    wetPromo:
      normaliseOptionalTextField(getFormValue(formData, "wetPromo")) ??
      (typeof record.wet_promo === "string" ? record.wet_promo : null),
    foodPromo:
      normaliseOptionalTextField(getFormValue(formData, "foodPromo")) ??
      (typeof record.food_promo === "string" ? record.food_promo : null),
    costTotal:
      normaliseOptionalNumberField(getFormValue(formData, "costTotal")) ??
      (typeof record.cost_total === "number" ? record.cost_total : null),
    costDetails:
      normaliseOptionalTextField(getFormValue(formData, "costDetails")) ??
      (typeof record.cost_details === "string" ? record.cost_details : null),
    bookingType,
    ticketPrice: normaliseTicketPriceForBookingFormat(
      bookingType,
      normaliseOptionalNumberField(getFormValue(formData, "ticketPrice")) ??
        (typeof record.ticket_price === "number" ? record.ticket_price : null)
    ),
    checkInCutoffMinutes:
      normaliseOptionalIntegerField(getFormValue(formData, "checkInCutoffMinutes")) ??
      (typeof record.check_in_cutoff_minutes === "number" ? record.check_in_cutoff_minutes : null),
    agePolicy:
      normaliseOptionalTextField(getFormValue(formData, "agePolicy")) ??
      (typeof record.age_policy === "string" ? record.age_policy : null),
    accessibilityNotes:
      normaliseOptionalTextField(getFormValue(formData, "accessibilityNotes")) ??
      (typeof record.accessibility_notes === "string" ? record.accessibility_notes : null),
    cancellationWindowHours:
      normaliseOptionalIntegerField(getFormValue(formData, "cancellationWindowHours")) ??
      (typeof record.cancellation_window_hours === "number" ? record.cancellation_window_hours : null),
    termsAndConditions:
      normaliseOptionalTextField(getFormValue(formData, "termsAndConditions")) ??
      (typeof record.terms_and_conditions === "string" ? record.terms_and_conditions : null),
    bookingUrl:
      normaliseOptionalTextField(getFormValue(formData, "bookingUrl")) ??
      (typeof record.booking_url === "string" ? record.booking_url : null),
    details:
      normaliseOptionalTextField(getFormValue(formData, "notes")) ??
      (typeof record.notes === "string" ? record.notes : null),
    existingPublicTitle:
      normaliseOptionalTextField(getFormValue(formData, "publicTitle")) ??
      (typeof record.public_title === "string" ? record.public_title : null),
    existingPublicTeaser:
      normaliseOptionalTextField(getFormValue(formData, "publicTeaser")) ??
      (typeof record.public_teaser === "string" ? record.public_teaser : null),
    existingPublicDescription:
      normaliseOptionalTextField(getFormValue(formData, "publicDescription")) ??
      (typeof record.public_description === "string" ? record.public_description : null),
    existingPublicHighlights: inputHighlights
  };
}

async function fetchWebsiteCopyEventRecord(
  supabase: ActionSupabaseClient,
  eventId: string
): Promise<WebsiteCopyEventRecord | null> {
  const { data, error } = await supabase.from("events").select(WEBSITE_COPY_EVENT_SELECT).eq("id", eventId).maybeSingle();
  if (error) {
    throw error;
  }
  return data as WebsiteCopyEventRecord | null;
}

async function generateWebsiteCopyFromEventRecord(
  record: WebsiteCopyEventRecord,
  formData?: FormData
): Promise<GeneratedWebsiteCopy | null> {
  return generateWebsiteCopy(buildWebsiteCopyInput(record, formData));
}

async function updateEventWithFallback(params: {
  supabase: ActionSupabaseClient;
  eventId: string;
  payload: Record<string, unknown>;
  contextLabel: string;
  reviewerAssigneeId?: string | null;
}) {
  type EventUpdate = Database["public"]["Tables"]["events"]["Update"];
  let updateError: { message: string } | null = null;
  try {
    const admin = createSupabaseAdminClient();
    let adminUpdate = admin.from("events").update(params.payload as EventUpdate).eq("id", params.eventId);
    if (params.reviewerAssigneeId) {
      adminUpdate = adminUpdate.eq("assignee_id", params.reviewerAssigneeId);
    }
    const { error } = await adminUpdate;
    updateError = error;
  } catch (error) {
    console.warn(`Service-role ${params.contextLabel} update unavailable; retrying with user client`, error);
    updateError = { message: "service-role update unavailable" };
  }

  if (updateError) {
    console.warn(`Service-role ${params.contextLabel} update failed; retrying with user client`, updateError);
    let fallbackUpdate = params.supabase.from("events").update(params.payload as EventUpdate).eq("id", params.eventId);
    if (params.reviewerAssigneeId) {
      fallbackUpdate = fallbackUpdate.eq("assignee_id", params.reviewerAssigneeId);
    }
    const { error: fallbackError } = await fallbackUpdate;
    if (fallbackError) {
      throw fallbackError;
    }
  }
}

async function recordWebsiteCopyGeneratedAudit(params: {
  eventId: string;
  actorId: string;
  triggeredByApproval?: boolean;
  autoApproved?: boolean;
}) {
  const meta: Record<string, unknown> = {
    changes: [...WEBSITE_COPY_AUDIT_CHANGES]
  };
  if (params.triggeredByApproval) {
    meta["triggeredByApproval"] = true;
  }
  if (params.autoApproved) {
    meta["autoApproved"] = true;
  }

  await recordAuditLogEntry({
    entity: "event",
    entityId: params.eventId,
    action: "event.website_copy_generated",
    actorId: params.actorId,
    meta
  });
}

async function uploadEventImage(params: {
  eventId: string;
  file: File;
  existingPath?: string | null;
}): Promise<{ path: string } | { error: string }> {
  const file = params.file;
  if (file.size > MAX_EVENT_IMAGE_BYTES) {
    return { error: "Event image must be 10MB or smaller." };
  }
  if (typeof file.type === "string" && file.type.length > 0 && !file.type.startsWith("image/")) {
    return { error: "Event image must be an image file." };
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    console.error(error);
    return { error: "Supabase service role is not configured for image upload." };
  }

  const fileExt = (() => {
    const parsed = file.name.split(".");
    if (parsed.length < 2) return "jpg";
    return sanitiseFileName(parsed[parsed.length - 1]).slice(0, 10) || "jpg";
  })();
  const fileName = `${Date.now()}-${sanitiseFileName(file.name.replace(/\.[^.]+$/, ""))}.${fileExt}`;
  const objectPath = `${params.eventId}/${fileName}`;

  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage.from(EVENT_IMAGE_BUCKET).upload(objectPath, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false
  });

  if (uploadError) {
    console.error("Failed to upload event image", uploadError);
    return { error: "Could not upload event image right now." };
  }

  if (params.existingPath && params.existingPath !== objectPath) {
    const { error: removeError } = await admin.storage.from(EVENT_IMAGE_BUCKET).remove([params.existingPath]);
    if (removeError) {
      console.warn("Failed to remove previous event image", removeError);
    }
  }

  return { path: objectPath };
}

async function removeEventImageObject(path: string | null | undefined): Promise<void> {
  if (!path || !path.trim().length) return;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.storage.from(EVENT_IMAGE_BUCKET).remove([path]);
    if (error) {
      console.warn("Failed to remove event image object", error);
    }
  } catch (error) {
    console.warn("Could not initialise service role client for event image cleanup", error);
  }
}

async function autoApproveEvent(params: {
  eventId: string;
  actorId: string;
  previousStatus: string | null;
  previousAssignee: string | null;
}): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const supabase = await createSupabaseActionClient();
  const nowIso = new Date().toISOString();

  const eventBeforeApproval = await fetchWebsiteCopyEventRecord(supabase, params.eventId);
  if (!eventBeforeApproval) {
    throw new Error("Event not found.");
  }
  const generatedWebsiteCopy = await generateWebsiteCopyFromEventRecord(eventBeforeApproval);
  const websiteCopyPayload = generatedWebsiteCopy ? buildWebsiteCopyUpdatePayload(generatedWebsiteCopy) : null;
  if (!generatedWebsiteCopy) {
    console.warn("Auto-approval continuing without AI website copy.");
    warnings.push("Website copy could not be generated automatically");
  }

  await updateEventWithFallback({
    supabase,
    eventId: params.eventId,
    payload: {
      status: "approved",
      assignee_id: null,
      submitted_at: nowIso,
      ...(websiteCopyPayload ?? {})
    },
    contextLabel: "auto-approval"
  });

  await recordApproval({
    eventId: params.eventId,
    reviewerId: params.actorId,
    decision: "approved"
  });

  const changes: string[] = [];
  if (params.previousStatus !== "approved") {
    changes.push("Status");
  }
  if ((params.previousAssignee ?? null) !== null) {
    changes.push("Assignee");
  }

  if (changes.length) {
    await recordAuditLogEntry({
      entity: "event",
      entityId: params.eventId,
      action: "event.status_changed",
      actorId: params.actorId,
      meta: {
        status: "approved",
        previousStatus: params.previousStatus,
        assigneeId: null,
        previousAssigneeId: params.previousAssignee,
        autoApproved: true,
        changes
      }
    });
  }

  if (websiteCopyPayload) {
    await recordWebsiteCopyGeneratedAudit({
      eventId: params.eventId,
      actorId: params.actorId,
      triggeredByApproval: true,
      autoApproved: true
    });
  }

  const versionPayload: Record<string, unknown> = {
    status: "approved",
    submitted_at: nowIso,
    autoApproved: true
  };
  if (websiteCopyPayload) {
    versionPayload["websiteCopyGenerated"] = true;
    Object.assign(versionPayload, websiteCopyPayload);
  }

  await appendEventVersion(params.eventId, params.actorId, versionPayload);

  return { warnings };
}

export async function saveEventDraftAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const startedAt = Date.now();
  const operationId = readOperationId(formData);
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const rawEventIdRaw = formData.get("eventId");
  const rawEventId = typeof rawEventIdRaw === "string" ? rawEventIdRaw.trim() : "";
  const isCreate = !rawEventId;

  if (isCreate) {
    if (!canProposeEvents(user.role)) {
      return { success: false, message: "You don't have permission to create events.", operationId };
    }
  } else {
    const parsedId = z.string().uuid().safeParse(rawEventId);
    if (!parsedId.success) {
      return { success: false, message: "Missing event reference.", operationId };
    }
    const ctx = await loadEventEditContext(parsedId.data);
    if (!ctx) {
      return { success: false, message: "Event not found.", operationId };
    }
    if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
      return { success: false, message: "You don't have permission to edit this event.", operationId };
    }
  }

  const eventId = rawEventId || undefined;

  // Multi-venue: read the full list of picked venue IDs. Fall back to the
  // legacy single `venueId` field so existing callers keep working.
  const rawVenueIds = formData
    .getAll("venueIds")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const fallbackVenueIdValue = formData.get("venueId");
  const fallbackVenueId = typeof fallbackVenueIdValue === "string" ? fallbackVenueIdValue : "";
  const requestedVenueIds =
    rawVenueIds.length > 0 ? rawVenueIds : fallbackVenueId ? [fallbackVenueId] : [];
  const sopNotRequiredTemplateIds = normaliseSopNotRequiredTemplateIds(
    formData.getAll("sopNotRequiredTemplateIds")
  );

  const venueIds = requestedVenueIds;
  if (!canOfficeWorkerUseVenueSelection(user, venueIds)) {
    return {
      success: false,
      message: "You can only create or edit events for your assigned venue.",
      fieldErrors: { venueId: "Choose your assigned venue" },
      operationId
    };
  }
  const venueId = venueIds[0] ?? "";
  const titleValue = formData.get("title");
  const title = typeof titleValue === "string" ? titleValue : "";
  const eventTypeValue = formData.get("eventType");
  const eventType = typeof eventTypeValue === "string" ? eventTypeValue : "";
  const startAtValue = formData.get("startAt");
  const startAt = typeof startAtValue === "string" ? startAtValue : "";
  const endAtValue = formData.get("endAt");
  const endAt = typeof endAtValue === "string" ? endAtValue : "";
  const eventImageEntry = formData.get("eventImage");
  const eventImageFile = eventImageEntry instanceof File && eventImageEntry.size > 0 ? eventImageEntry : null;

  const parsed = eventDraftSchema.safeParse({
    eventId,
    venueId,
    title,
    eventType,
    startAt,
    endAt,
    venueSpace: normaliseVenueSpacesField(formData.get("venueSpace")),
    expectedHeadcount: formData.get("expectedHeadcount") ?? undefined,
    wetPromo: formData.get("wetPromo") ?? undefined,
    foodPromo: formData.get("foodPromo") ?? undefined,
    bookingType: formData.get("bookingType") ?? undefined,
    ticketPrice: formData.get("ticketPrice") ?? undefined,
    checkInCutoffMinutes: formData.get("checkInCutoffMinutes") ?? undefined,
    agePolicy: formData.get("agePolicy") ?? undefined,
    accessibilityNotes: formData.get("accessibilityNotes") ?? undefined,
    cancellationWindowHours: formData.get("cancellationWindowHours") ?? undefined,
    termsAndConditions: formData.get("termsAndConditions") ?? undefined,
    artistNames: formData.get("artistNames") ?? undefined,
    goalFocus: formData.getAll("goalFocus").length
      ? formData.getAll("goalFocus").join(",")
      : formData.get("goalFocus") ?? undefined,
    costTotal: formData.get("costTotal") ?? undefined,
    costDetails: formData.get("costDetails") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    managerResponsibleId: formData.get("managerResponsibleId") ?? undefined,
    publicTitle: formData.get("publicTitle") ?? undefined,
    publicTeaser: formData.get("publicTeaser") ?? undefined,
    publicDescription: formData.get("publicDescription") ?? undefined,
    publicHighlights: formData.get("publicHighlights") ?? undefined,
    bookingUrl: formData.get("bookingUrl") ?? undefined,
    seoTitle: formData.get("seoTitle") ?? undefined,
    seoDescription: formData.get("seoDescription") ?? undefined,
    seoSlug: formData.get("seoSlug") ?? undefined
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error),
      operationId
    };
  }

  const values = parsed.data;
  const startAtIso = normaliseEventDateTimeForStorage(values.startAt);
  const endAtIso = normaliseEventDateTimeForStorage(values.endAt);

  if (!values.venueId) {
    return {
      success: false,
      message: "Choose a venue before saving.",
      fieldErrors: { venueId: "Choose a venue" },
      operationId
    };
  }

  // Phase B′ atomic-save path. When the feature flag is enabled, the entire
  // events row + venue/artist join writes are committed inside a single
  // SECURITY DEFINER RPC. Image upload runs as a compensating second phase
  // (see attachEventImageAfterRpc). The legacy multi-write path below stays
  // available behind the same flag and will be removed once the RPC has
  // burned in for a release.
  if (shouldUseSaveEventRpc()) {
    const idempotencyKey = readIdempotencyKey(formData);
    const expectedUpdatedAt = readExpectedUpdatedAt(formData);
    const requestedArtistIds = normaliseArtistIdList(formData.get("artistIds"));

    const payload = buildSaveEventDraftPayload({
      eventId: values.eventId ?? null,
      venueId: values.venueId,
      venueIds,
      artistIds: requestedArtistIds,
      title: values.title,
      eventType: values.eventType ?? null,
      startAtIso,
      endAtIso,
      venueSpace: values.venueSpace,
      expectedHeadcount: values.expectedHeadcount ?? null,
      wetPromo: values.wetPromo ?? null,
      foodPromo: values.foodPromo ?? null,
      goalFocus: values.goalFocus ?? null,
      notes: values.notes ?? null,
      bookingType: values.bookingType ?? null,
      ticketPrice: normaliseTicketPriceForBookingFormat(values.bookingType ?? null, values.ticketPrice ?? null),
      checkInCutoffMinutes: values.checkInCutoffMinutes ?? null,
      agePolicy: values.agePolicy ?? null,
      accessibilityNotes: values.accessibilityNotes ?? null,
      cancellationWindowHours: values.cancellationWindowHours ?? null,
      termsAndConditions: values.termsAndConditions ?? null,
      costTotal: values.costTotal ?? null,
      costDetails: values.costDetails ?? null,
      managerResponsibleId: values.managerResponsibleId || null,
      publicTitle: values.publicTitle ?? null,
      publicTeaser: values.publicTeaser ?? null,
      publicDescription: values.publicDescription ?? null,
      publicHighlights: values.publicHighlights ?? null,
      bookingUrl: values.bookingUrl ?? null,
      seoTitle: values.seoTitle ?? null,
      seoDescription: values.seoDescription ?? null,
      seoSlug: values.seoSlug ?? null
    });

    const result: SaveEventDraftRpcResult = await callSaveEventDraftRpc({
      payload,
      idempotencyKey,
      operationId,
      expectedUpdatedAt
    });

    if (result.success && result.eventId && eventImageFile) {
      const imageOutcome = await attachEventImageAfterRpc({
        eventId: result.eventId,
        file: eventImageFile,
        operationId
      });
      if (imageOutcome.warning) {
        result.warnings = [...(result.warnings ?? []), imageOutcome.warning];
      }
    }

    if (result.success) {
      if (isCreate && result.eventId) {
        try {
          await ensureEventPlanningItem(result.eventId, user.id, {
            venueIds,
            notRequiredTemplateIds: sopNotRequiredTemplateIds
          });
        } catch (sopError) {
          console.error(`[event-save:${operationId.slice(0, 8)}] RPC planning item generation failed:`, sopError);
        }
      }
      revalidatePath("/events");
      if (result.eventId) revalidatePath(`/events/${result.eventId}`);
      logEventAction({
        operation_id: result.operationId ?? operationId,
        user_id: user.id,
        action: "save_event_draft",
        duration_ms: Date.now() - startedAt,
        outcome: "success",
        warning_count: result.warnings?.length ?? 0,
        failed_count: Array.isArray(result.failed) ? result.failed.length : 0
      });
      if (!values.eventId && result.eventId) {
        redirect(`/events/${result.eventId}`);
      }
    } else {
      logEventAction({
        operation_id: result.operationId ?? operationId,
        user_id: user.id,
        action: "save_event_draft",
        duration_ms: Date.now() - startedAt,
        outcome: result.conflict ? "conflict" : "failure",
        warning_count: result.warnings?.length ?? 0,
        failed_count: Array.isArray(result.failed) ? result.failed.length : 0
      });
    }

    return result;
  }

  let redirectUrl: string | null = null;
  try {
    if (values.eventId) {
      let updated: Awaited<ReturnType<typeof updateEventDraft>>["event"];
      let strippedColumns: string[];
      let mismatches: string[];

      // Only admin or event creator can set manager_responsible_id
      let managerResponsibleIdValue: string | null = values.managerResponsibleId || null;
      // Fetch created_by + status in one go so we can also decide whether to
      // transition approved_pending_details → draft on this save.
      const supabaseCheck = await createSupabaseActionClient();
      const { data: ownerCheck } = await supabaseCheck
        .from("events")
        .select("created_by, status")
        .eq("id", values.eventId)
        .single();
      if (managerResponsibleIdValue && user.role !== "administrator") {
        if (ownerCheck?.created_by !== user.id) {
          managerResponsibleIdValue = null; // Strip — user is not admin or creator
        }
      }

      // Pre-event completion: when the current status is approved_pending_details
      // and the venue manager provides the required fields (event_type, end_at,
      // venue_space), transition the row back to normal draft state. The DB
      // trigger enforces that the required fields are actually present.
      const shouldTransitionToDraft =
        (ownerCheck as { status?: string } | null)?.status === "approved_pending_details" &&
        Boolean(values.eventType) &&
        Boolean(values.venueSpace) &&
        Boolean(endAtIso);

      try {
        const result = await updateEventDraft(values.eventId, {
          venue_id: values.venueId,
          title: values.title,
          event_type: values.eventType,
          start_at: startAtIso,
          end_at: endAtIso,
          venue_space: values.venueSpace,
          ...(shouldTransitionToDraft ? { status: "draft" as EventStatus } : {}),
          expected_headcount: values.expectedHeadcount ?? null,
          wet_promo: values.wetPromo ?? null,
          food_promo: values.foodPromo ?? null,
          booking_type: values.bookingType ?? null,
          ticket_price: normaliseTicketPriceForBookingFormat(values.bookingType ?? null, values.ticketPrice ?? null),
          check_in_cutoff_minutes: values.checkInCutoffMinutes ?? null,
          age_policy: values.agePolicy ?? null,
          accessibility_notes: values.accessibilityNotes ?? null,
          cancellation_window_hours: values.cancellationWindowHours ?? null,
          terms_and_conditions: values.termsAndConditions ?? null,
          cost_total: values.costTotal ?? null,
          cost_details: values.costDetails ?? null,
          goal_focus: values.goalFocus ?? null,
          notes: values.notes ?? null,
          manager_responsible_id: managerResponsibleIdValue,
          public_title: values.publicTitle ?? null,
          public_teaser: values.publicTeaser ?? null,
          public_description: values.publicDescription ?? null,
          public_highlights: values.publicHighlights ?? null,
          // booking_url is owned by BookingSettingsCard / updateBookingSettingsAction;
          // intentionally omitted here so saving the event form does not clobber the URL.
          seo_title: values.seoTitle ?? null,
          seo_description: values.seoDescription ?? null,
          seo_slug: values.seoSlug ?? null
        }, user.id);
        updated = result.event;
        strippedColumns = result.strippedColumns;
        mismatches = result.mismatches;
      } catch (updateError) {
        const msg = updateError instanceof Error ? updateError.message : "Unknown error";
        if (msg.includes("no rows were affected")) {
          return {
            success: false,
            message: "Could not save — the event's current status may prevent editing. Try reverting to draft first, then editing.",
            operationId
          };
        }
        throw updateError; // Let outer catch handle
      }

      // Sync multi-venue attachments — mirror what the create path does.
      await syncEventVenueAttachments(values.eventId, venueIds);

      const artistIds = normaliseArtistIdList(formData.get("artistIds"));
      const artistNames = normaliseArtistNameList(values.artistNames ?? null);
      let artistVersionNames = artistNames;
      let artistSyncWarning = false;
      try {
        if (artistIds.length || artistNames.length) {
          const artistSync = await syncEventArtists({
            eventId: values.eventId,
            actorId: user.id,
            artistIds,
            artistNames
          });
          artistVersionNames = artistSync.nextNames;
          if (artistListsDiffer(artistSync.previousNames, artistSync.nextNames)) {
            await recordAuditLogEntry({
              entity: "event",
              entityId: values.eventId,
              action: "event.artists_updated",
              actorId: user.id,
              meta: {
                previousArtists: artistSync.previousNames,
                artists: artistSync.nextNames,
                changes: ["Artists"],
                operationId
              }
            });
          }
        }
      } catch (error) {
        artistSyncWarning = true;
        console.error(`[event-save:${operationId.slice(0, 8)}] Draft saved but artist sync failed`, error);
      }

      let imageWarning = false;
      if (eventImageFile) {
        const uploadResult = await uploadEventImage({
          eventId: values.eventId,
          file: eventImageFile,
          existingPath: updated.event_image_path
        });
        if ("error" in uploadResult) {
          return { success: false, message: uploadResult.error, operationId };
        }
        if (uploadResult.path !== updated.event_image_path) {
          try {
            const { event: _imageUpdated } = await updateEventDraft(
              values.eventId,
              {
                event_image_path: uploadResult.path
              },
              user.id
            );
            void _imageUpdated;
          } catch (error) {
            imageWarning = true;
            console.error(`[event-save:${operationId.slice(0, 8)}] Draft saved but event image path update failed`, error);
          }
        }
      }

      let versionWarning = false;
      try {
        await appendEventVersion(values.eventId, user.id, {
          ...values,
          artistNames: artistVersionNames,
          status: updated.status
        });
      } catch (error) {
        versionWarning = true;
        console.error(`[event-save:${operationId.slice(0, 8)}] Draft saved but event version append failed`, error);
      }
      await recordAuditLogEntry({
        entity: "event",
        entityId: values.eventId,
        action: "event.draft_saved",
        actorId: user.id,
        meta: { title: values.title, isUpdate: true, operationId }
      });
      revalidatePath(`/events/${values.eventId}`);
      if (artistSyncWarning || imageWarning || versionWarning) {
        return {
          success: true,
          message: "Draft updated, but some optional linked data could not be synced.",
          operationId
        };
      }
      const warnings: string[] = [];
      if (strippedColumns.length > 0) {
        warnings.push(`These fields could not be saved: ${strippedColumns.join(", ")}`);
      }
      if (mismatches.length > 0) {
        warnings.push(`These fields may not have saved correctly: ${mismatches.join(", ")}`);
      }
      const warningText = warnings.length ? ` (${warnings.join("; ")})` : "";
      return { success: true, message: `Draft updated.${warningText}`, operationId };
    }

    const created = await createEventDraft({
      venueId: values.venueId,
      createdBy: user.id,
      title: values.title,
      eventType: values.eventType,
      startAt: startAtIso,
      endAt: endAtIso,
      venueSpace: values.venueSpace,
      expectedHeadcount: values.expectedHeadcount ?? null,
      wetPromo: values.wetPromo ?? null,
      foodPromo: values.foodPromo ?? null,
      bookingType: values.bookingType ?? null,
      ticketPrice: normaliseTicketPriceForBookingFormat(values.bookingType ?? null, values.ticketPrice ?? null),
      checkInCutoffMinutes: values.checkInCutoffMinutes ?? null,
      agePolicy: values.agePolicy ?? null,
      accessibilityNotes: values.accessibilityNotes ?? null,
      cancellationWindowHours: values.cancellationWindowHours ?? null,
      termsAndConditions: values.termsAndConditions ?? null,
      costTotal: values.costTotal ?? null,
      costDetails: values.costDetails ?? null,
      goalFocus: values.goalFocus ?? null,
      notes: values.notes ?? null,
      managerResponsibleId: values.managerResponsibleId || null,
      publicTitle: values.publicTitle ?? null,
      publicTeaser: values.publicTeaser ?? null,
      publicDescription: values.publicDescription ?? null,
      publicHighlights: values.publicHighlights ?? null,
      bookingUrl: values.bookingUrl ?? null,
      seoTitle: values.seoTitle ?? null,
      seoDescription: values.seoDescription ?? null,
      seoSlug: values.seoSlug ?? null
    });

    // Sync multi-venue attachments via the helper RPC (primary = venueIds[0]
    // which matches the events.venue_id we just wrote).
    await syncEventVenueAttachments(created.id, venueIds);

    // Create linked planning item and generate SOP checklist
    try {
      await createEventPlanningItem(
        created.id,
        created.title,
        created.start_at,
        created.venue_id,
        user.id,
        {
          venueIds,
          notRequiredTemplateIds: sopNotRequiredTemplateIds
        }
      );
    } catch (sopError) {
      console.error(`[event-save:${operationId.slice(0, 8)}] SOP checklist generation failed:`, sopError);
    }

    const artistIds = normaliseArtistIdList(formData.get("artistIds"));
    const artistNames = normaliseArtistNameList(values.artistNames ?? null);
    if (artistIds.length || artistNames.length) {
      try {
        const artistSync = await syncEventArtists({
          eventId: created.id,
          actorId: user.id,
          artistIds,
          artistNames
        });
        if (artistSync.nextNames.length > 0) {
          await recordAuditLogEntry({
            entity: "event",
            entityId: created.id,
            action: "event.artists_updated",
            actorId: user.id,
            meta: {
              artists: artistSync.nextNames,
              changes: ["Artists"],
              operationId
            }
          });
        }
      } catch (error) {
        console.error(`[event-save:${operationId.slice(0, 8)}] Draft created but artist sync failed`, error);
      }
    }

    if (eventImageFile) {
      const uploadResult = await uploadEventImage({
        eventId: created.id,
        file: eventImageFile,
        existingPath: null
      });
      if (!("error" in uploadResult)) {
        try {
          const { event: _imgUpdated } = await updateEventDraft(
            created.id,
            {
              event_image_path: uploadResult.path
            },
            user.id
          );
          void _imgUpdated;
        } catch (error) {
          console.error(`[event-save:${operationId.slice(0, 8)}] Draft created but event image path update failed`, error);
        }
      } else {
        console.warn(`[event-save:${operationId.slice(0, 8)}] Event image upload failed after draft create`, uploadResult.error);
      }
    }

    await recordAuditLogEntry({
      entity: "event",
      entityId: created.id,
      action: "event.draft_saved",
      actorId: user.id,
      meta: { title: values.title, isNew: true, operationId }
    });
    revalidatePath(`/events/${created.id}`);
    revalidatePath("/events");
    redirectUrl = `/events/${created.id}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error(`[event-save:${operationId.slice(0, 8)}] Draft save failed:`, detail, error);
    return { success: false, message: "Could not save the draft. Please try again.", operationId };
  }
  if (redirectUrl) {
    redirect(redirectUrl);
  }
  return { success: true, message: "Draft saved.", operationId };
}

export async function submitEventForReviewAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const startedAt = Date.now();
  const operationId = readOperationId(formData);
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const eventId = formData.get("eventId");
  const rawEventId = typeof eventId === "string" ? eventId.trim() : "";

  if (!rawEventId) {
    if (!canProposeEvents(user.role)) {
      return { success: false, message: "You don't have permission to submit events.", operationId };
    }
  } else {
    const parsedId = z.string().uuid().safeParse(rawEventId);
    if (!parsedId.success) {
      return { success: false, message: "Missing event reference.", operationId };
    }
    const ctx = await loadEventEditContext(parsedId.data);
    if (!ctx) {
      return { success: false, message: "Event not found.", operationId };
    }
    if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
      return { success: false, message: "You don't have permission to edit this event.", operationId };
    }
  }

  const assigneeField = formData.get("assigneeId") ?? formData.get("assignedReviewerId") ?? undefined;
  const assigneeOverride = typeof assigneeField === "string" ? assigneeField : undefined;
  const eventImageEntry = formData.get("eventImage");
  const eventImageFile = eventImageEntry instanceof File && eventImageEntry.size > 0 ? eventImageEntry : null;
  const requestedArtistIds = normaliseArtistIdList(formData.get("artistIds"));
  const requestedArtistNames = normaliseArtistNameList(formData.get("artistNames"));

  // Phase B′ atomic-submit path. Only the existing-event submit case is
  // routed through the RPC for now; the create-then-submit fast path stays
  // on the legacy multi-write so that branch can keep its full validation +
  // assignee-resolution logic while we burn the RPC in. The legacy path
  // remains the fallback when the flag is off.
  if (rawEventId && shouldUseSaveEventRpc()) {
    const parsedId = z.string().uuid().safeParse(rawEventId);
    if (!parsedId.success) {
      return { success: false, message: "Missing event reference.", operationId };
    }
    const idempotencyKey = readIdempotencyKey(formData);
    const expectedUpdatedAt = readExpectedUpdatedAt(formData);
    const preSubmitContext = await loadEventEditContext(parsedId.data);
    const assigneeId = (() => {
      const parsed = reviewerFallback.safeParse(assigneeOverride);
      return parsed.success ? parsed.data ?? null : null;
    })();

    const result = await callSubmitEventForReviewRpc({
      eventId: parsedId.data,
      idempotencyKey,
      operationId,
      expectedUpdatedAt,
      assigneeId
    });

    if (result.success && eventImageFile) {
      const imageOutcome = await attachEventImageAfterRpc({
        eventId: parsedId.data,
        file: eventImageFile,
        operationId
      });
      if (imageOutcome.warning) {
        result.warnings = [...(result.warnings ?? []), imageOutcome.warning];
      }
    }

    if (result.success) {
      if (preSubmitContext?.status === "draft") {
        void sendNewEventAnnouncementEmail(parsedId.data);
      }
      revalidatePath(`/events/${parsedId.data}`);
      revalidatePath("/events");
      revalidatePath("/reviews");
    }

    logEventAction({
      operation_id: result.operationId ?? operationId,
      user_id: user.id,
      action: "submit_event_for_review",
      duration_ms: Date.now() - startedAt,
      outcome: result.success ? "success" : result.conflict ? "conflict" : "failure",
      warning_count: result.warnings?.length ?? 0,
      failed_count: result.missingFields?.length ?? 0
    });

    return result;
  }

  let targetEventId: string | null = null;
  let redirectUrl: string | null = null;
  let finalResult: ActionResult | null = null;

  try {
    if (rawEventId) {
      const parsedId = z.string().uuid().safeParse(rawEventId);
      if (!parsedId.success) {
        return { success: false, message: "Missing event reference.", operationId };
      }
      targetEventId = parsedId.data;
    } else {
      const rawVenueIds = formData
        .getAll("venueIds")
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      const fallbackVenueIdValue = formData.get("venueId");
      const fallbackVenueId = typeof fallbackVenueIdValue === "string" ? fallbackVenueIdValue : "";
      const requestedVenueIds =
        rawVenueIds.length > 0 ? rawVenueIds : fallbackVenueId ? [fallbackVenueId] : [];
      const sopNotRequiredTemplateIds = normaliseSopNotRequiredTemplateIds(
        formData.getAll("sopNotRequiredTemplateIds")
      );
      const venueIds = requestedVenueIds;
      if (!canOfficeWorkerUseVenueSelection(user, venueIds)) {
        return {
          success: false,
          message: "You can only submit events for your assigned venue.",
          fieldErrors: { venueId: "Choose your assigned venue" },
          operationId
        };
      }
      const venueId = venueIds[0] ?? "";
      const requestedVenueId = venueId;

      const titleValue = formData.get("title");
      const title = typeof titleValue === "string" ? titleValue : "";
      const eventTypeValue = formData.get("eventType");
      const eventType = typeof eventTypeValue === "string" ? eventTypeValue : "";
      const startAtValue = formData.get("startAt");
      const startAt = typeof startAtValue === "string" ? startAtValue : "";
      const endAtValue = formData.get("endAt");
      const endAt = typeof endAtValue === "string" ? endAtValue : "";

      const parsed = eventFormSchema
        .omit({ eventId: true })
        .safeParse({
          venueId,
          title,
          eventType,
          startAt,
          endAt,
          venueSpace: normaliseVenueSpacesField(formData.get("venueSpace")),
          expectedHeadcount: formData.get("expectedHeadcount") ?? undefined,
          wetPromo: formData.get("wetPromo") ?? undefined,
          foodPromo: formData.get("foodPromo") ?? undefined,
          bookingType: formData.get("bookingType") ?? undefined,
          ticketPrice: formData.get("ticketPrice") ?? undefined,
          checkInCutoffMinutes: formData.get("checkInCutoffMinutes") ?? undefined,
          agePolicy: formData.get("agePolicy") ?? undefined,
          accessibilityNotes: formData.get("accessibilityNotes") ?? undefined,
          cancellationWindowHours: formData.get("cancellationWindowHours") ?? undefined,
          termsAndConditions: formData.get("termsAndConditions") ?? undefined,
          artistNames: formData.get("artistNames") ?? undefined,
          goalFocus: formData.getAll("goalFocus").length
            ? formData.getAll("goalFocus").join(",")
            : formData.get("goalFocus") ?? undefined,
          costTotal: formData.get("costTotal") ?? undefined,
          costDetails: formData.get("costDetails") ?? undefined,
          notes: formData.get("notes") ?? undefined,
          managerResponsibleId: formData.get("managerResponsibleId") ?? undefined,
          publicTitle: formData.get("publicTitle") ?? undefined,
          publicTeaser: formData.get("publicTeaser") ?? undefined,
          publicDescription: formData.get("publicDescription") ?? undefined,
          publicHighlights: formData.get("publicHighlights") ?? undefined,
          bookingUrl: formData.get("bookingUrl") ?? undefined,
          seoTitle: formData.get("seoTitle") ?? undefined,
          seoDescription: formData.get("seoDescription") ?? undefined,
          seoSlug: formData.get("seoSlug") ?? undefined
        });

      if (!parsed.success) {
        return {
          success: false,
          message: "Check the highlighted fields.",
          fieldErrors: getFieldErrors(parsed.error),
          operationId
        };
      }

      const values = parsed.data;
      const startAtIso = normaliseEventDateTimeForStorage(values.startAt);
      const endAtIso = normaliseEventDateTimeForStorage(values.endAt);
      if (!values.venueId) {
        return {
          success: false,
          message: "Choose a venue before submitting.",
          fieldErrors: { venueId: "Choose a venue" },
          operationId
        };
      }

      const created = await createEventDraft({
        venueId: values.venueId,
        createdBy: user.id,
        title: values.title,
        eventType: values.eventType,
        startAt: startAtIso,
        endAt: endAtIso,
        venueSpace: values.venueSpace,
        expectedHeadcount: values.expectedHeadcount ?? null,
        wetPromo: values.wetPromo ?? null,
        foodPromo: values.foodPromo ?? null,
        bookingType: values.bookingType ?? null,
        ticketPrice: normaliseTicketPriceForBookingFormat(values.bookingType ?? null, values.ticketPrice ?? null),
        checkInCutoffMinutes: values.checkInCutoffMinutes ?? null,
        agePolicy: values.agePolicy ?? null,
        accessibilityNotes: values.accessibilityNotes ?? null,
        cancellationWindowHours: values.cancellationWindowHours ?? null,
        termsAndConditions: values.termsAndConditions ?? null,
        costTotal: values.costTotal ?? null,
        costDetails: values.costDetails ?? null,
        goalFocus: values.goalFocus ?? null,
        notes: values.notes ?? null,
        managerResponsibleId: values.managerResponsibleId || null,
        publicTitle: values.publicTitle ?? null,
        publicTeaser: values.publicTeaser ?? null,
        publicDescription: values.publicDescription ?? null,
        publicHighlights: values.publicHighlights ?? null,
        bookingUrl: values.bookingUrl ?? null,
        seoTitle: values.seoTitle ?? null,
        seoDescription: values.seoDescription ?? null,
        seoSlug: values.seoSlug ?? null
      });
      targetEventId = created.id;

      await syncEventVenueAttachments(created.id, venueIds);

      try {
        await createEventPlanningItem(
          created.id,
          created.title,
          created.start_at,
          created.venue_id,
          user.id,
          {
            venueIds,
            notRequiredTemplateIds: sopNotRequiredTemplateIds
          }
        );
      } catch (sopError) {
        console.error(`[event-submit:${operationId.slice(0, 8)}] SOP checklist generation failed:`, sopError);
      }

      const artistSync = await syncEventArtists({
        eventId: created.id,
        actorId: user.id,
        artistIds: requestedArtistIds,
        artistNames: normaliseArtistNameList(values.artistNames ?? null)
      });
      if (artistSync.nextNames.length > 0) {
        await recordAuditLogEntry({
          entity: "event",
          entityId: created.id,
          action: "event.artists_updated",
          actorId: user.id,
          meta: {
            artists: artistSync.nextNames,
            changes: ["Artists"],
            operationId
          }
        });
      }

      if (eventImageFile) {
        const uploadResult = await uploadEventImage({
          eventId: created.id,
          file: eventImageFile,
          existingPath: null
        });
        if (!("error" in uploadResult)) {
          const { event: _submitImgUpdated } = await updateEventDraft(
            created.id,
            {
              event_image_path: uploadResult.path
            },
            user.id
          );
          void _submitImgUpdated;
        } else {
          console.warn(`[event-submit:${operationId.slice(0, 8)}] Event image upload failed before submit`, uploadResult.error);
        }
      }
    }

    if (!targetEventId) {
      return { success: false, message: "Missing event reference.", operationId };
    }

    const supabase = await createSupabaseActionClient();

    const { data: existingEvent, error: existingEventError } = await supabase
      .from("events")
      .select("status, assignee_id, venue_id, created_by, event_image_path")
      .eq("id", targetEventId)
      .single();

    if (existingEventError) {
      throw existingEventError;
    }

    if (user.role === "office_worker" && existingEvent?.created_by !== user.id) {
      return { success: false, message: "You can only submit events you created.", operationId };
    }

    if (!existingEvent) {
      throw new Error("Event not found.");
    }

    if (!["draft", "needs_revisions"].includes(existingEvent.status)) {
      if (existingEvent.status === "approved") {
        revalidatePath(`/events/${targetEventId}`);
        revalidatePath("/events");
        revalidatePath("/reviews");
        return { success: true, message: "Event already approved.", operationId };
      }
      return { success: false, message: "This event cannot be submitted in its current state.", operationId };
    }

    if (rawEventId) {
      const artistSync = await syncEventArtists({
        eventId: targetEventId,
        actorId: user.id,
        artistIds: requestedArtistIds,
        artistNames: requestedArtistNames
      });
      if (artistListsDiffer(artistSync.previousNames, artistSync.nextNames)) {
        await recordAuditLogEntry({
          entity: "event",
          entityId: targetEventId,
          action: "event.artists_updated",
          actorId: user.id,
          meta: {
            previousArtists: artistSync.previousNames,
            artists: artistSync.nextNames,
            changes: ["Artists"],
            operationId
          }
        });
      }

      if (eventImageFile) {
        const uploadResult = await uploadEventImage({
          eventId: targetEventId,
          file: eventImageFile,
          existingPath: existingEvent?.event_image_path ?? null
        });
        if ("error" in uploadResult) {
          return { success: false, message: uploadResult.error, operationId };
        }

        if (uploadResult.path !== (existingEvent?.event_image_path ?? null)) {
          const { event: _resubmitImgUpdated } = await updateEventDraft(
            targetEventId,
            {
              event_image_path: uploadResult.path
            },
            user.id
          );
          void _resubmitImgUpdated;
        }
      }
    }

    if (user.role === "administrator") {

      const approvalResult = await autoApproveEvent({
        eventId: targetEventId,
        actorId: user.id,
        previousStatus: (existingEvent.status as string | null) ?? null,
        previousAssignee: (existingEvent.assignee_id as string | null) ?? null
      });

      await sendReviewDecisionEmail(targetEventId, "approved");
      if (existingEvent.status === "draft") {
        void sendNewEventAnnouncementEmail(targetEventId);
      }

      revalidatePath(`/events/${targetEventId}`);
      revalidatePath("/events");
      revalidatePath("/reviews");
      const warningText = approvalResult.warnings.length
        ? ` Note: ${approvalResult.warnings.join("; ")}.`
        : "";
      finalResult = { success: true, message: `Event approved instantly.${warningText}`, operationId };
      if (!rawEventId) {
        redirectUrl = `/events/${targetEventId}`;
      }
    } else {

      if (existingEvent?.created_by !== user.id) {
        return { success: false, message: "You can only submit events you created.", operationId };
      }

      async function resolveAssignee(): Promise<string | null> {
        const parsedAssignee = reviewerFallback.parse(assigneeOverride) ?? null;
        if (parsedAssignee) return parsedAssignee;

        const venueId = existingEvent?.venue_id ?? null;
        if (venueId) {
          const { data: venueRow, error: venueError } = await supabase
            .from("venues")
            .select("default_approver_id")
            .eq("id", venueId)
            .maybeSingle();

          if (venueError) {
            console.error(`[event-submit:${operationId.slice(0, 8)}] Could not load venue default approver`, venueError);
          } else if (venueRow?.default_approver_id) {
            return venueRow.default_approver_id;
          }
        }

        const { data } = await supabase
          .from("users")
          .select("id")
          .eq("role", "administrator")
          .order("full_name", { ascending: true })
          .limit(1)
          .maybeSingle();
        return data?.id ?? null;
      }

      const assigneeId = await resolveAssignee();
      const { error } = await supabase
        .from("events")
        .update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          assignee_id: assigneeId
        })
        .eq("id", targetEventId);

      if (error) {
        throw error;
      }

      const statusBefore = existingEvent?.status ?? null;
      const assigneeBefore = existingEvent?.assignee_id ?? null;
      const changes: string[] = [];
      if (statusBefore !== "submitted") {
        changes.push("Status");
      }
      if ((assigneeBefore ?? null) !== assigneeId) {
        changes.push("Assignee");
      }

      if (changes.length) {
        await recordAuditLogEntry({
          entity: "event",
          entityId: targetEventId,
          action: "event.submitted",
          actorId: user.id,
          meta: {
            status: "submitted",
            previousStatus: statusBefore,
            assigneeId: assigneeId ?? null,
            previousAssigneeId: assigneeBefore ?? null,
            changes,
            operationId
          }
        });
      }

      await appendEventVersion(targetEventId, user.id, {
        status: "submitted",
        submitted_at: new Date().toISOString()
      });

      await sendEventSubmittedEmail(targetEventId);
      if (statusBefore === "draft") {
        void sendNewEventAnnouncementEmail(targetEventId);
      }

      revalidatePath(`/events/${targetEventId}`);
      revalidatePath("/events");
      revalidatePath("/reviews");
      finalResult = { success: true, message: "Sent to review.", operationId };
      if (!rawEventId) {
        redirectUrl = `/events/${targetEventId}`;
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error(`[event-submit:${operationId.slice(0, 8)}] Submit for review failed:`, detail, error);
    if (!rawEventId && targetEventId) {
      revalidatePath(`/events/${targetEventId}`);
      revalidatePath("/events");
      redirect(`/events/${targetEventId}`);
    }
    return { success: false, message: "Could not submit right now. Please try again.", operationId };
  }
  if (redirectUrl) {
    redirect(redirectUrl);
  }
  return finalResult ?? { success: true, message: "Sent to review.", operationId };
}

export async function reviewerDecisionAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canReviewEvents(user.role)) {
    return { success: false, message: "Only administrators can record decisions." };
  }

  const decision = formData.get("decision");
  const eventId = formData.get("eventId");
  const feedback = formData.get("feedback") ?? undefined;
  const generateWebsiteCopyConfirmed = formData.get("generateWebsiteCopy") === "true";

  const parsedId = z.string().uuid().safeParse(typeof eventId === "string" ? eventId : "");
  if (!parsedId.success) {
    return { success: false, message: "Decision could not be processed." };
  }

  const parsedDecision = z.enum(["approved", "needs_revisions", "rejected"]).safeParse(
    typeof decision === "string" ? decision : ""
  );
  if (!parsedDecision.success) {
    return {
      success: false,
      message: "Choose a decision before saving.",
      fieldErrors: { decision: "Choose a decision" }
    };
  }

  const newStatus = parsedDecision.data as EventStatus;
  const supabase = await createSupabaseActionClient();

  try {
    const eventBeforeDecision = await fetchWebsiteCopyEventRecord(supabase, parsedId.data);
    if (!eventBeforeDecision) {
      return { success: false, message: "Event not found." };
    }

    if (!["submitted", "needs_revisions"].includes(eventBeforeDecision.status ?? "")) {
      return { success: false, message: "This event is not currently awaiting review." };
    }

    const currentAssignee = eventBeforeDecision?.assignee_id ?? null;
    let nextAssignee: string | null = currentAssignee;

    if (newStatus === "needs_revisions" || newStatus === "rejected") {
      nextAssignee = eventBeforeDecision?.created_by ?? null;
    } else if (newStatus === "approved") {
      nextAssignee = null;
    }

    let websiteCopyPayload: Record<string, unknown> | null = null;
    if (newStatus === "approved") {
      const alreadyHasCopy = Boolean(eventBeforeDecision.public_title);
      if (!alreadyHasCopy) {
        if (!generateWebsiteCopyConfirmed) {
          return {
            success: false,
            message: "Approving an event requires AI website copy generation.",
            fieldErrors: { decision: "Confirm AI website copy generation" }
          };
        }

        const generatedWebsiteCopy = await generateWebsiteCopyFromEventRecord(eventBeforeDecision, formData);
        if (!generatedWebsiteCopy) {
          return {
            success: false,
            message: "Could not generate website copy. Approval was not saved. Check the AI service credentials and try again."
          };
        }
        websiteCopyPayload = buildWebsiteCopyUpdatePayload(generatedWebsiteCopy);
      }
    }

    await updateEventWithFallback({
      supabase,
      eventId: parsedId.data,
      payload: {
        status: newStatus,
        assignee_id: nextAssignee,
        ...(websiteCopyPayload ?? {})
      },
      contextLabel: "decision",
      reviewerAssigneeId: null
    });

    const statusBefore = eventBeforeDecision?.status ?? null;
    const trimmedFeedback =
      typeof feedback === "string" && feedback.trim().length ? feedback.trim() : null;
    await recordApproval({
      eventId: parsedId.data,
      reviewerId: user.id,
      decision: newStatus,
      feedback: trimmedFeedback
    });

    const changes: string[] = [];
    if (statusBefore !== newStatus) {
      changes.push("Status");
    }
    if (trimmedFeedback) {
      changes.push("Feedback");
    }
    if ((currentAssignee ?? null) !== nextAssignee) {
      changes.push("Assignee");
    }

    if (changes.length) {
      await recordAuditLogEntry({
        entity: "event",
        entityId: parsedId.data,
        action: newStatus === "approved" ? "event.approved" : newStatus === "needs_revisions" ? "event.needs_revisions" : "event.rejected",
        actorId: user.id,
        meta: {
          status: newStatus,
          previousStatus: statusBefore,
          feedback: trimmedFeedback,
          assigneeId: nextAssignee,
          previousAssigneeId: currentAssignee,
          changes
        }
      });
    }

    if (websiteCopyPayload) {
      await recordWebsiteCopyGeneratedAudit({
        eventId: parsedId.data,
        actorId: user.id,
        triggeredByApproval: true
      });
    }

    await appendEventVersion(parsedId.data, user.id, {
      status: newStatus,
      feedback: trimmedFeedback,
      ...(websiteCopyPayload ?? {}),
      websiteCopyGenerated: Boolean(websiteCopyPayload)
    });

    await sendReviewDecisionEmail(parsedId.data, newStatus);

    revalidatePath(`/events/${parsedId.data}`);
    revalidatePath("/reviews");
    revalidatePath("/");
    return {
      success: true,
      message: websiteCopyPayload ? "Decision recorded and website copy generated." : "Decision recorded."
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("reviewerDecisionAction failed:", detail, error);
    return { success: false, message: "Could not save the decision. Please try again." };
  }
}

export async function generateWebsiteCopyAction(
  _: WebsiteCopyActionResult | undefined,
  formData: FormData
): Promise<WebsiteCopyActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!canReviewEvents(user.role)) {
    return { success: false, message: "Only administrators can generate website copy." };
  }

  const eventIdValue = formData.get("eventId");
  const parsedEventId = z.string().uuid().safeParse(typeof eventIdValue === "string" ? eventIdValue : "");
  if (!parsedEventId.success) {
    return { success: false, message: "Missing event reference." };
  }
  const supabase = await createSupabaseActionClient();

  try {
    const record = await fetchWebsiteCopyEventRecord(supabase, parsedEventId.data);
    if (!record) {
      return { success: false, message: "Event not found." };
    }
    // Admin-only function (canReviewEvents gates above) — no per-assignee scoping needed

    if (record.status !== "approved" && record.status !== "completed") {
      return { success: false, message: "Approve the event before generating website copy." };
    }

    const generated = await generateWebsiteCopyFromEventRecord(record, formData);

    if (!generated) {
      return { success: false, message: "Could not generate website copy. Check the AI service credentials and try again." };
    }

    await updateEventWithFallback({
      supabase,
      eventId: parsedEventId.data,
      payload: buildWebsiteCopyUpdatePayload(generated),
      contextLabel: "website copy"
    });
    await recordWebsiteCopyGeneratedAudit({ eventId: parsedEventId.data, actorId: user.id });

    revalidatePath(`/events/${parsedEventId.data}`);
    return {
      success: true,
      message: "Website copy generated.",
      values: toWebsiteCopyValues(generated)
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("generateWebsiteCopyAction failed:", detail, error);
    return { success: false, message: "Could not generate website copy right now. Please try again." };
  }
}

export async function generateWebsiteCopyFromFormAction(
  _: WebsiteCopyActionResult | undefined,
  formData: FormData
): Promise<WebsiteCopyActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // LLM utility with no event context — capability alone gates it.
  if (!canProposeEvents(user.role)) {
    return { success: false, message: "You don't have permission to generate website copy." };
  }

  try {
    const venueIdValue = formData.get("venueId");
    const parsedVenueId = z.string().uuid().safeParse(typeof venueIdValue === "string" ? venueIdValue : "");

    let venueName: string | null = null;
    let venueAddress: string | null = null;
    if (parsedVenueId.success) {
      const supabase = await createSupabaseActionClient();
      const { data: venue } = await supabase
        .from("venues")
        .select("name,address")
        .eq("id", parsedVenueId.data)
        .maybeSingle();
      if (venue) {
        venueName = typeof venue.name === "string" ? venue.name : null;
        venueAddress = typeof venue.address === "string" ? venue.address : null;
      }
    }

    const venueSpaces = normaliseVenueSpacesField(getFormValue(formData, "venueSpace"))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const goalFocus = getFormValues(formData, "goalFocus")
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);

    const artistNames = normaliseArtistNameList(getFormValue(formData, "artistNames"));
    const bookingType = normaliseOptionalBookingTypeField(getFormValue(formData, "bookingType"));
    const publicHighlights = normaliseOptionalHighlightsField(getFormValue(formData, "publicHighlights"));

    const startAtRaw = normaliseOptionalTextField(getFormValue(formData, "startAt")) ?? "";
    const endAtRaw = normaliseOptionalTextField(getFormValue(formData, "endAt")) ?? "";

    const input = {
      title: normaliseOptionalTextField(getFormValue(formData, "title")) ?? "",
      eventType: normaliseOptionalTextField(getFormValue(formData, "eventType")) ?? "",
      startAt: startAtRaw ? normaliseEventDateTimeForStorage(startAtRaw) : "",
      endAt: endAtRaw ? normaliseEventDateTimeForStorage(endAtRaw) : "",
      artistNames,
      venueName,
      venueAddress,
      venueSpaces,
      goalFocus,
      expectedHeadcount: normaliseOptionalNumberField(getFormValue(formData, "expectedHeadcount")) ?? null,
      wetPromo: normaliseOptionalTextField(getFormValue(formData, "wetPromo")) ?? null,
      foodPromo: normaliseOptionalTextField(getFormValue(formData, "foodPromo")) ?? null,
      costTotal: normaliseOptionalNumberField(getFormValue(formData, "costTotal")) ?? null,
      costDetails: normaliseOptionalTextField(getFormValue(formData, "costDetails")) ?? null,
      bookingType,
      ticketPrice: normaliseTicketPriceForBookingFormat(
        bookingType,
        normaliseOptionalNumberField(getFormValue(formData, "ticketPrice"))
      ),
      checkInCutoffMinutes: normaliseOptionalIntegerField(getFormValue(formData, "checkInCutoffMinutes")) ?? null,
      agePolicy: normaliseOptionalTextField(getFormValue(formData, "agePolicy")) ?? null,
      accessibilityNotes: normaliseOptionalTextField(getFormValue(formData, "accessibilityNotes")) ?? null,
      cancellationWindowHours: normaliseOptionalIntegerField(getFormValue(formData, "cancellationWindowHours")) ?? null,
      termsAndConditions: normaliseOptionalTextField(getFormValue(formData, "termsAndConditions")) ?? null,
      bookingUrl: normaliseOptionalTextField(getFormValue(formData, "bookingUrl")) ?? null,
      details: normaliseOptionalTextField(getFormValue(formData, "notes")) ?? null,
      existingPublicTitle: normaliseOptionalTextField(getFormValue(formData, "publicTitle")) ?? null,
      existingPublicTeaser: normaliseOptionalTextField(getFormValue(formData, "publicTeaser")) ?? null,
      existingPublicDescription: normaliseOptionalTextField(getFormValue(formData, "publicDescription")) ?? null,
      existingPublicHighlights: publicHighlights
    };

    const generated = await generateWebsiteCopy(input);
    if (!generated) {
      return { success: false, message: "Could not generate website copy. Check the AI service credentials and try again." };
    }

    return {
      success: true,
      message: "Website copy generated.",
      values: toWebsiteCopyValues(generated)
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("generateWebsiteCopyFromFormAction failed:", detail, error);
    return { success: false, message: "Could not generate website copy right now. Please try again." };
  }
}

export async function generateTermsAndConditionsAction(
  _: TermsActionResult | undefined,
  formData: FormData
): Promise<TermsActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // If called from within an existing event (metadata update), require
  // full edit rights on that event. If called for an unsaved draft,
  // capability alone is sufficient.
  const termsEventIdRaw = formData.get("eventId");
  const termsEventIdStr = typeof termsEventIdRaw === "string" ? termsEventIdRaw.trim() : "";
  if (termsEventIdStr) {
    const parsedId = z.string().uuid().safeParse(termsEventIdStr);
    if (!parsedId.success) {
      return { success: false, message: "Invalid event reference." };
    }
    const ctx = await loadEventEditContext(parsedId.data);
    if (!ctx) {
      return { success: false, message: "Event not found." };
    }
    if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
      return { success: false, message: "You don't have permission to edit this event." };
    }
  } else {
    if (!canProposeEvents(user.role)) {
      return { success: false, message: "You don't have permission to generate terms." };
    }
  }

  const bookingType = normaliseOptionalBookingTypeField(formData.get("bookingType"));
  const ticketPrice = normaliseTicketPriceForBookingFormat(
    bookingType,
    normaliseOptionalNumberField(formData.get("ticketPrice"))
  );
  const checkInCutoffMinutes = normaliseOptionalIntegerField(formData.get("checkInCutoffMinutes"));
  const cancellationWindowHours = normaliseOptionalIntegerField(formData.get("cancellationWindowHours"));
  const agePolicy = normaliseOptionalTextField(formData.get("agePolicy"));
  const accessibilityNotes = normaliseOptionalTextField(formData.get("accessibilityNotes"));
  const extraNotes = normaliseOptionalTextField(formData.get("extraNotes"));
  const allowsWalkInsValue = formData.get("allowsWalkIns");
  const refundAllowedValue = formData.get("refundAllowed");
  const rescheduleAllowedValue = formData.get("rescheduleAllowed");

  const toNullableBoolean = (value: FormDataEntryValue | null): boolean | null => {
    if (value === "yes") return true;
    if (value === "no") return false;
    return null;
  };

  try {
    const terms = await generateTermsAndConditions({
      bookingType,
      ticketPrice,
      checkInCutoffMinutes,
      cancellationWindowHours,
      agePolicy,
      accessibilityNotes,
      allowsWalkIns: toNullableBoolean(allowsWalkInsValue),
      refundAllowed: toNullableBoolean(refundAllowedValue),
      rescheduleAllowed: toNullableBoolean(rescheduleAllowedValue),
      extraNotes
    });

    if (!terms) {
      return { success: false, message: "Could not generate terms right now." };
    }

    const parsedEventId = z.string().uuid().safeParse(formData.get("eventId"));
    if (parsedEventId.success) {
      await recordAuditLogEntry({
        entity: "event",
        entityId: parsedEventId.data,
        action: "event.terms_generated",
        actorId: user.id,
        meta: { changes: ["Terms and conditions"] }
      });
    }

    return {
      success: true,
      message: "Terms generated.",
      terms
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("generateTermsAndConditionsAction failed:", detail, error);
    return { success: false, message: "Could not generate terms right now. Please try again." };
  }
}

export async function updateAssigneeAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "administrator") {
    return { success: false, message: "Only administrators can update assignees." };
  }

  const eventId = formData.get("eventId");
  const assigneeField = formData.get("assigneeId") ?? formData.get("reviewerId") ?? null;

  const parsedEvent = z.string().uuid().safeParse(eventId);
  const parsedAssignee = assigneeField ? z.string().uuid().safeParse(assigneeField) : { success: true, data: null };

  if (!parsedEvent.success || !parsedAssignee.success) {
    return { success: false, message: "Provide a valid user." };
  }

  try {
    const supabase = await createSupabaseActionClient();
    const { data: eventRow, error: eventFetchError } = await supabase
      .from("events")
      .select("assignee_id")
      .eq("id", parsedEvent.data)
      .single();

    if (eventFetchError) {
      throw eventFetchError;
    }

    const previousAssigneeId = eventRow?.assignee_id ?? null;
    const nextAssigneeId = parsedAssignee.data;

    if (previousAssigneeId === nextAssigneeId) {
      return { success: true, message: "Assignee unchanged." };
    }

    await updateEventAssignee(parsedEvent.data, nextAssigneeId);
    await sendAssigneeReassignmentEmail(parsedEvent.data, nextAssigneeId, previousAssigneeId);
    await recordAuditLogEntry({
      entity: "event",
      entityId: parsedEvent.data,
      action: "event.assignee_changed",
      actorId: user.id,
      meta: {
        assigneeId: nextAssigneeId,
        previousAssigneeId,
        changes: ["Assignee"]
      }
    });
    revalidatePath(`/events/${parsedEvent.data}`);
    revalidatePath("/reviews");
    return { success: true, message: "Assignee updated." };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("updateAssigneeAction failed:", detail, error);
    return { success: false, message: "Could not update assignee. Please try again." };
  }
}

export async function deleteEventAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const eventId = formData.get("eventId");
  const parsedEvent = z.string().uuid().safeParse(eventId);

  if (!parsedEvent.success) {
    return { success: false, message: "Invalid event reference." };
  }

  const ctx = await loadEventEditContext(parsedEvent.data);
  if (!ctx) {
    return { success: false, message: "Event not found." };
  }
  if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
    return { success: false, message: "You don't have permission to delete this event." };
  }

  const supabase = await createSupabaseActionClient();

  let redirectUrl: string | null = null;
  try {
    const { data: event, error: fetchError } = await supabase
      .from("events")
      .select("id, created_by, status, event_image_path")
      .eq("id", parsedEvent.data)
      .single();

    if (fetchError || !event) {
      return { success: false, message: "Event not found." };
    }

    // Record audit entry before deletion so the event ID is captured
    await recordAuditLogEntry({
      entity: "event",
      entityId: event.id,
      action: "event.deleted",
      actorId: user.id,
      meta: {
        status: event.status,
        changes: ["Event"]
      }
    });

    // Hard delete: removes event and all related records via FK cascades
    await softDeleteEvent(event.id, user.id);

    revalidatePath("/events");
    revalidatePath("/reviews");
    redirectUrl = "/events";
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("deleteEventAction failed:", detail, error);
    return { success: false, message: "Could not delete the event. Please try again." };
  }
  if (redirectUrl) {
    redirect(redirectUrl);
  }
  return { success: true, message: "Event deleted." };
}

// Permissive UUID format check (8-4-4-4-12 hex groups) without enforcing RFC 4122 version/variant bits.
// z.string().uuid() in Zod v4 enforces strict RFC 4122 which rejects synthetic test UUIDs.
const uuidFormatSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Invalid UUID"
);

const archiveDraftEventSchema = z.object({
  eventId: uuidFormatSchema,
});

export type ArchiveDraftEventInput = z.infer<typeof archiveDraftEventSchema>;

export async function archiveDraftEventAction(input: ArchiveDraftEventInput): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const parsed = archiveDraftEventSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Invalid event reference." };
  }

  const { eventId } = parsed.data;
  const ctx = await loadEventEditContext(eventId);
  if (!ctx) {
    return { success: false, message: "Event not found." };
  }
  if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
    return { success: false, message: "You don't have permission to archive this draft event." };
  }
  if (ctx.status !== "draft") {
    return { success: false, message: "Only draft events can be archived from the planning board." };
  }

  const supabase = createSupabaseAdminClient();
  const archivedAt = new Date().toISOString();

  try {
    const { data: archivedEvent, error: updateError } = await supabase
      .from("events")
      .update({
        deleted_at: archivedAt,
        deleted_by: user.id,
        updated_at: archivedAt,
      })
      .eq("id", eventId)
      .eq("status", "draft")
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (updateError || !archivedEvent) {
      return { success: false, message: "Could not archive the draft event." };
    }

    await recordAuditLogEntry({
      entity: "event",
      entityId: eventId,
      action: "event.deleted",
      actorId: user.id,
      meta: {
        status: "draft",
        archivedFrom: "planning_board",
        changes: ["Draft archived"],
      },
    });

    revalidatePath("/planning");
    revalidatePath("/events");
    revalidatePath(`/events/${eventId}`);
    revalidatePath("/");

    return { success: true, message: "Draft event archived." };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("archiveDraftEventAction failed:", detail, error);
    return { success: false, message: "Could not archive the draft event. Please try again." };
  }
}

export async function revertToDraftAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // Only administrator can revert approved events — office_workers are blocked by
  // RLS on approved-status events, and reverting approval is a privileged action.
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can revert approved events to draft." };
  }

  const eventId = formData.get("eventId");
  const parsedEvent = uuidFormatSchema.safeParse(eventId);
  if (!parsedEvent.success) {
    return { success: false, message: "Invalid event reference." };
  }

  const supabase = await createSupabaseActionClient();

  try {
    const { data: event, error: fetchError } = await supabase
      .from("events")
      .select("id, status")
      .eq("id", parsedEvent.data)
      .single();

    if (fetchError || !event) {
      return { success: false, message: "Event not found." };
    }

    if (event.status !== "approved") {
      return { success: false, message: "Event is not currently approved." };
    }

    const { error: updateError } = await supabase
      .from("events")
      .update({ status: "draft", assignee_id: null, updated_at: new Date().toISOString() })
      .eq("id", event.id);

    if (updateError) {
      return { success: false, message: "Could not revert event to draft." };
    }

    await recordAuditLogEntry({

      entity: "event",
      entityId: event.id,
      action: "event.status_changed",
      actorId: user.id,
      meta: {
        status: "draft",
        previousStatus: "approved",
        changes: ["Status"],
      },
    });

    revalidatePath(`/events/${event.id}`);
    revalidatePath("/events");
    revalidatePath("/reviews");
    revalidatePath("/");

    return { success: true, message: "Event reverted to draft." };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("revertToDraftAction failed:", detail, error);
    return { success: false, message: "Could not revert event to draft. Please try again." };
  }
}


const bookingSettingsSchema = z.object({
  eventId: z.string().uuid("Invalid event ID"),
  bookingEnabled: z.boolean(),
  totalCapacity: z.number().int().positive().nullable(),
  maxTicketsPerBooking: z.number().int().min(1).max(50),
  bookingNotesEnabled: z.boolean().optional(),
  smsPromoEnabled: z.boolean().optional(),
  bookingUrl: bookingUrlSchema,
});

export type UpdateBookingSettingsInput = z.infer<typeof bookingSettingsSchema>;
export type UpdateBookingSettingsResult = ActionResult & {
  seoSlug?: string | null;
  bookingUrl?: string | null;
  bookingUrlTrackingStatus?: TrackedBookingUrlStatus;
};

/**
 * Save booking settings (booking_enabled, total_capacity, max_tickets_per_booking).
 * Auto-generates seo_slug when booking is first enabled and no slug exists yet.
 * Only administrator and office_worker (for their own venue's events) may call this.
 */
export async function updateBookingSettingsAction(
  input: UpdateBookingSettingsInput,
): Promise<UpdateBookingSettingsResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = bookingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Invalid booking settings." };
  }

  const {
    eventId,
    bookingEnabled,
    totalCapacity,
    maxTicketsPerBooking,
    bookingNotesEnabled,
    smsPromoEnabled,
    bookingUrl
  } = parsed.data;

  // This action uses the admin client below, so the server-side guard is
  // the sole enforcement point. Validate permission via the true row.
  const ctx = await loadEventEditContext(eventId);
  if (!ctx) {
    return { success: false, message: "Event not found." };
  }
  if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
    return { success: false, message: "You don't have permission to update booking settings for this event." };
  }

  const supabase = createSupabaseAdminClient();

  // Fetch the current event for slug/title/start_at. Permission already
  // verified above via loadEventEditContext.
  const { data: event, error: fetchError } = await supabase
    .from("events")
    .select("id, title, public_title, start_at, venue_id, seo_slug, booking_type")
    .eq("id", eventId)
    .maybeSingle();

  if (fetchError || !event) {
    return { success: false, message: "Event not found." };
  }

  let trackedBookingUrl: Awaited<ReturnType<typeof getOrCreateTrackedBookingUrl>>;
  try {
    trackedBookingUrl = await getOrCreateTrackedBookingUrl({
      url: bookingUrl ?? null,
      eventId,
      eventTitle: event.public_title?.trim() || event.title,
      eventStartAt: event.start_at,
      eventCampaignName: event.seo_slug ?? event.public_title ?? event.title,
      createdBy: user.id
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    if (detail.startsWith("Booking link") || detail.startsWith("That short link")) {
      return { success: false, message: detail };
    }
    console.error("updateBookingSettings tracked link creation failed:", error);
    return { success: false, message: "Could not prepare the tracked booking link. Please try again." };
  }
  const nextBookingUrl = trackedBookingUrl.url;

  // Auto-generate slug when enabling bookings for the first time
  let seoSlug: string | null = event.seo_slug ?? null;
  if (bookingEnabled && !seoSlug) {
    try {
      seoSlug = await generateUniqueEventSlug(event.title, new Date(event.start_at));
    } catch (err) {
      console.error("Failed to generate event slug:", err);
      return { success: false, message: "Could not generate booking page URL. Please try again." };
    }
  }

  // Build update payload — only administrators can toggle sms_promo_enabled
  const updatePayload: Record<string, unknown> = {
    booking_enabled: bookingEnabled,
    total_capacity: totalCapacity,
    max_tickets_per_booking: maxTicketsPerBooking,
    booking_notes_enabled: bookingNotesEnabled ?? false,
    seo_slug: seoSlug,
    booking_url: nextBookingUrl,
  };
  if (user.role === "administrator" && smsPromoEnabled !== undefined) {
    updatePayload.sms_promo_enabled = smsPromoEnabled;
  }

  const { error: updateError } = await supabase
    .from("events")
    .update(updatePayload)
    .eq("id", eventId);

  if (updateError) {
    console.error("updateBookingSettings failed:", updateError);
    return { success: false, message: "Could not save booking settings." };
  }

  try {
    await recordAuditLogEntry({
      entity: "event",
      entityId: eventId,
      action: "event.booking_settings_updated",
      actorId: user.id,
      meta: {
        bookingEnabled,
        totalCapacity,
        maxTicketsPerBooking,
        bookingNotesEnabled: bookingNotesEnabled ?? false,
        bookingUrl: nextBookingUrl,
        bookingUrlTrackingStatus: trackedBookingUrl.status
      }
    });
  } catch (auditError) {
    // Booking settings save itself succeeded — audit failure is logged but
    // does not roll the user-visible result back. Surfacing the failure
    // would confuse the user since the settings change took effect.
    console.error("updateBookingSettings audit log entry failed:", auditError);
  }
  revalidatePath(`/events/${eventId}`);
  const trackedMessage =
    trackedBookingUrl.status === "created"
      ? " Booking link was shortened for tracking."
      : trackedBookingUrl.status === "reused"
        ? " Booking link was replaced with an existing tracked short link."
        : "";

  return {
    success: true,
    message: `Booking settings saved.${trackedMessage}`,
    seoSlug,
    bookingUrl: nextBookingUrl,
    bookingUrlTrackingStatus: trackedBookingUrl.status
  };
}
