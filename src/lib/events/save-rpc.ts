import "server-only";

import { createSupabaseActionClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { ActionResult } from "@/lib/types";

/**
 * Phase B′ atomic-save plumbing.
 *
 * Wraps the `save_event_draft` and `submit_event_for_review` SECURITY DEFINER
 * RPCs with a strongly typed payload + return contract so callers in the
 * action layer don't have to thread the Supabase client around. All identity
 * (user id, role, venue) is derived inside the RPC from `auth.uid()`; the
 * caller only supplies the form payload, idempotency key, operation id, and
 * the optimistic-concurrency `expected_updated_at` gate.
 *
 * The RPC returns a `jsonb` envelope. We mirror that shape into TypeScript
 * (`SaveEventDraftRpcResponse` / `SubmitEventForReviewRpcResponse`) so the
 * call site can branch on `success` without parsing strings, and we expose
 * a small adapter (`callSaveEventDraftRpc` / `callSubmitEventForReviewRpc`)
 * that returns an `ActionResult` with the right `eventId`, `warnings`,
 * `failed`, and `conflict` fields populated for downstream UI.
 */

/**
 * Allowlisted snake_case payload accepted by `public.save_event_draft`.
 *
 * The keys mirror the columns the RPC writes on the `events` row plus the
 * helper arrays (`venue_ids`, `artist_ids`) it consumes. Anything not on
 * this list is dropped before the RPC call so a caller cannot accidentally
 * write a column the RPC does not expect.
 */
export type SaveEventDraftPayload = {
  event_id?: string | null;
  venue_id: string;
  venue_ids?: string[];
  artist_ids?: string[];
  title: string;
  event_type: string | null;
  start_at: string;
  end_at: string | null;
  venue_space?: string | null;
  expected_headcount?: number | null;
  wet_promo?: string | null;
  food_promo?: string | null;
  goal_focus?: string | null;
  notes?: string | null;
  booking_type?: string | null;
  ticket_price?: number | null;
  check_in_cutoff_minutes?: number | null;
  age_policy?: string | null;
  accessibility_notes?: string | null;
  cancellation_window_hours?: number | null;
  terms_and_conditions?: string | null;
  cost_total?: number | null;
  cost_details?: string | null;
  manager_responsible_id?: string | null;
  public_title?: string | null;
  public_teaser?: string | null;
  public_description?: string | null;
  public_highlights?: string[] | null;
  booking_url?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_slug?: string | null;
};

/** Shape of the jsonb returned by `save_event_draft`. */
type SaveEventDraftRpcResponse = {
  success: boolean;
  event_id?: string | null;
  operation_id?: string;
  message?: string;
  failed?: unknown[];
  warnings?: string[];
  conflict?: boolean;
};

/** Shape of the jsonb returned by `submit_event_for_review`. */
type SubmitEventForReviewRpcResponse = {
  success: boolean;
  event_id?: string | null;
  operation_id?: string;
  message?: string;
  conflict?: boolean;
  missing_fields?: string[];
};

/** Action-layer result returned from the save RPC adapter. */
export type SaveEventDraftRpcResult = ActionResult & {
  eventId?: string;
  failed?: unknown[];
  conflict?: boolean;
};

/** Action-layer result returned from the submit RPC adapter. */
export type SubmitEventForReviewRpcResult = ActionResult & {
  eventId?: string;
  conflict?: boolean;
  missingFields?: string[];
};

/**
 * Build the snake_case payload accepted by `save_event_draft` from a parsed
 * draft form. Caller is responsible for Zod validation and date
 * normalisation up-front; this helper just forwards the values into the
 * shape the RPC expects.
 */
export function buildSaveEventDraftPayload(args: {
  eventId?: string | null;
  venueId: string;
  venueIds: string[];
  artistIds: string[];
  title: string;
  eventType: string | null;
  startAtIso: string;
  endAtIso: string | null;
  venueSpace?: string | null;
  expectedHeadcount?: number | null;
  wetPromo?: string | null;
  foodPromo?: string | null;
  goalFocus?: string | null;
  notes?: string | null;
  bookingType?: string | null;
  ticketPrice?: number | null;
  checkInCutoffMinutes?: number | null;
  agePolicy?: string | null;
  accessibilityNotes?: string | null;
  cancellationWindowHours?: number | null;
  termsAndConditions?: string | null;
  costTotal?: number | null;
  costDetails?: string | null;
  managerResponsibleId?: string | null;
  publicTitle?: string | null;
  publicTeaser?: string | null;
  publicDescription?: string | null;
  publicHighlights?: string[] | null;
  bookingUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoSlug?: string | null;
}): SaveEventDraftPayload {
  return {
    event_id: args.eventId ?? null,
    venue_id: args.venueId,
    venue_ids: args.venueIds,
    artist_ids: args.artistIds,
    title: args.title,
    event_type: args.eventType,
    start_at: args.startAtIso,
    end_at: args.endAtIso,
    venue_space: args.venueSpace ?? null,
    expected_headcount: args.expectedHeadcount ?? null,
    wet_promo: args.wetPromo ?? null,
    food_promo: args.foodPromo ?? null,
    goal_focus: args.goalFocus ?? null,
    notes: args.notes ?? null,
    booking_type: args.bookingType ?? null,
    ticket_price: args.ticketPrice ?? null,
    check_in_cutoff_minutes: args.checkInCutoffMinutes ?? null,
    age_policy: args.agePolicy ?? null,
    accessibility_notes: args.accessibilityNotes ?? null,
    cancellation_window_hours: args.cancellationWindowHours ?? null,
    terms_and_conditions: args.termsAndConditions ?? null,
    cost_total: args.costTotal ?? null,
    cost_details: args.costDetails ?? null,
    manager_responsible_id: args.managerResponsibleId ?? null,
    public_title: args.publicTitle ?? null,
    public_teaser: args.publicTeaser ?? null,
    public_description: args.publicDescription ?? null,
    public_highlights: args.publicHighlights ?? null,
    booking_url: args.bookingUrl ?? null,
    seo_title: args.seoTitle ?? null,
    seo_description: args.seoDescription ?? null,
    seo_slug: args.seoSlug ?? null
  };
}

type SaveEventDraftRpcArgs = Database["public"]["Functions"]["save_event_draft"]["Args"];
type SubmitEventForReviewRpcArgs = Database["public"]["Functions"]["submit_event_for_review"]["Args"];

function toResponseObject<T>(value: unknown): T | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as T;
  }
  return null;
}

/**
 * Calls `public.save_event_draft` with a strongly typed payload + idempotency
 * key + correlation id. Returns an `ActionResult` extended with `eventId`,
 * `failed`, and `conflict` so the caller can branch on the same shape it
 * already returns from the legacy path.
 */
export async function callSaveEventDraftRpc(args: {
  payload: SaveEventDraftPayload;
  idempotencyKey: string;
  operationId: string;
  expectedUpdatedAt?: string | null;
}): Promise<SaveEventDraftRpcResult> {
  const supabase = await createSupabaseActionClient();
  const rpcArgs: SaveEventDraftRpcArgs = {
    p_payload: args.payload as unknown as Json,
    p_idempotency_key: args.idempotencyKey,
    p_operation_id: args.operationId
  };
  if (args.expectedUpdatedAt) {
    rpcArgs.p_expected_updated_at = args.expectedUpdatedAt;
  }

  const { data, error } = await supabase.rpc("save_event_draft", rpcArgs);

  if (error) {
    console.error(
      `[event-save-rpc:${args.operationId.slice(0, 8)}] save_event_draft RPC failed:`,
      error
    );
    return {
      success: false,
      message: "Could not save the draft. Please try again.",
      operationId: args.operationId
    };
  }

  const response = toResponseObject<SaveEventDraftRpcResponse>(data);
  if (!response) {
    return {
      success: false,
      message: "Save failed — unexpected response.",
      operationId: args.operationId
    };
  }

  const responseOperationId = typeof response.operation_id === "string" ? response.operation_id : args.operationId;

  if (response.success) {
    return {
      success: true,
      message: "Draft saved.",
      operationId: responseOperationId,
      warnings: Array.isArray(response.warnings) ? response.warnings : undefined,
      eventId: typeof response.event_id === "string" ? response.event_id : undefined
    };
  }

  return {
    success: false,
    message: response.message ?? "Save failed.",
    operationId: responseOperationId,
    conflict: response.conflict === true,
    failed: Array.isArray(response.failed) ? response.failed : undefined
  };
}

/**
 * Calls `public.submit_event_for_review` with a strongly typed event id +
 * idempotency key + correlation id. Returns an `ActionResult` extended with
 * `eventId`, `conflict`, and `missingFields`.
 */
export async function callSubmitEventForReviewRpc(args: {
  eventId: string;
  idempotencyKey: string;
  operationId: string;
  expectedUpdatedAt?: string | null;
  assigneeId?: string | null;
}): Promise<SubmitEventForReviewRpcResult> {
  const supabase = await createSupabaseActionClient();
  const rpcArgs: SubmitEventForReviewRpcArgs = {
    p_event_id: args.eventId,
    p_idempotency_key: args.idempotencyKey,
    p_operation_id: args.operationId
  };
  if (args.expectedUpdatedAt) {
    rpcArgs.p_expected_updated_at = args.expectedUpdatedAt;
  }
  if (args.assigneeId) {
    rpcArgs.p_assignee_id = args.assigneeId;
  }

  const { data, error } = await supabase.rpc("submit_event_for_review", rpcArgs);

  if (error) {
    console.error(
      `[event-submit-rpc:${args.operationId.slice(0, 8)}] submit_event_for_review RPC failed:`,
      error
    );
    return {
      success: false,
      message: "Could not submit right now. Please try again.",
      operationId: args.operationId
    };
  }

  const response = toResponseObject<SubmitEventForReviewRpcResponse>(data);
  if (!response) {
    return {
      success: false,
      message: "Submit failed — unexpected response.",
      operationId: args.operationId
    };
  }

  const responseOperationId = typeof response.operation_id === "string" ? response.operation_id : args.operationId;

  if (response.success) {
    return {
      success: true,
      message: "Sent to review.",
      operationId: responseOperationId,
      eventId: typeof response.event_id === "string" ? response.event_id : args.eventId
    };
  }

  return {
    success: false,
    message: response.message ?? "Submit failed.",
    operationId: responseOperationId,
    conflict: response.conflict === true,
    missingFields: Array.isArray(response.missing_fields)
      ? response.missing_fields.filter((f): f is string => typeof f === "string")
      : undefined
  };
}
