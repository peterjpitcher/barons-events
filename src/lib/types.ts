import type { FieldErrors } from "@/lib/form-errors";

export type UserRole =
  | "administrator"
  | "office_worker"
  | "executive";

export interface AppUser {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  venueId: string | null;
  deactivatedAt: string | null;
}

/** Counts of content owned by a user, used in deactivation/deletion confirmation dialogs. */
export interface UserImpactSummary {
  eventsCreated: number;
  eventsAssigned: number;
  planningSeriesOwned: number;
  planningSeriesCreated: number;
  planningItemsOwned: number;
  planningItemsCreated: number;
  planningTasks: number;
  planningTaskAssignees: number;
  taskTemplateDefaults: number;
  artistsCreated: number;
  eventArtistsCreated: number;
  shortLinksCreated: number;
  venueDefaults: number;
  eventsManagerResponsible: number;
  venueDefaultManager: number;
  sopDefaultAssignees: number;
  approvalsReviewed: number;
  eventVersionsSubmitted: number;
  debriefsSubmitted: number;
  eventsDeletedBy: number;
  tasksCompletedBy: number;
  venueOverridesCreated: number;
}

export type EventStatus =
  | "pending_approval"
  | "approved_pending_details"
  | "draft"
  | "submitted"
  | "needs_revisions"
  | "approved"
  | "rejected"
  | "completed";

/** Re-export FieldErrors so consumers only need one import. */
export type { FieldErrors } from "@/lib/form-errors";

/**
 * Standard result type returned by server actions.
 * Extended by action-specific result types (e.g. WebsiteCopyActionResult).
 *
 * `operationId` echoes the form-mount-generated correlation id back to the
 * client so error toasts can surface a short hash for support requests and
 * audit-log lookups. Populated in event-save / event-submit paths.
 *
 * `warnings` is reserved for the Phase B′ image-state-machine and atomic-RPC
 * paths to surface non-blocking soft-failures (e.g. "draft saved but artist
 * sync failed"). Currently unused by Phase A′ but added now to avoid a
 * second type-extension pass.
 */
export type ActionResult = {
  success: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  operationId?: string;
  warnings?: string[];
  updatedAt?: string;
};

/** Status of a customer booking. */
export type BookingStatus = "confirmed" | "cancelled";

/** Payment lifecycle for a booking. */
export type BookingPaymentStatus =
  | "not_required"
  | "pending"
  | "completed"
  | "failed"
  | "refunded"
  | "partially_refunded";

/** A customer record — one per unique mobile number across all bookings. */
export interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  mobile: string;        // E.164
  email: string | null;
  marketingOptIn: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Customer with aggregated booking stats for list views. */
export interface CustomerWithStats extends Customer {
  bookingCount: number;
  ticketCount: number;
  firstSeen: Date;
}

/** A customer booking for an event. camelCase — convert from DB snake_case using fromDb(). */
export interface EventBooking {
  id: string;
  eventId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;          // E.164
  email: string | null;
  customerNotes: string | null;
  ticketCount: number;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  paymentTransactionId: string | null;
  paymentCompletedAt: Date | null;
  paymentFailedAt: Date | null;
  paymentRefundedAt: Date | null;
  paymentAmountPence: number | null;
  paymentRefundedAmountPence: number | null;
  paymentCurrency: string | null;
  stripeCheckoutSessionId: string | null;
  createdAt: Date;
  smsConfirmationSentAt: Date | null;
  smsReminderSentAt: Date | null;
  smsPostEventSentAt: Date | null;
}

/** Booking settings embedded on an Event (from new DB columns). */
export interface EventBookingSettings {
  bookingEnabled: boolean;
  totalCapacity: number | null;   // null = unlimited
  maxTicketsPerBooking: number;
  bookingNotesEnabled: boolean;
  seoSlug: string | null;
}

/** Result from the create_booking Postgres RPC. */
export type BookingRpcResult =
  | { ok: true; bookingId: string }
  | { ok: false; reason: "not_found" | "sold_out" | "booking_limit_reached" | "too_many_tickets" };
