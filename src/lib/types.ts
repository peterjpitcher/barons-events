import type { FieldErrors } from "@/lib/form-errors";

export type UserRole =
  | "venue_manager"
  | "reviewer"
  | "central_planner"
  | "executive";

export interface AppUser {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  venueId: string | null;
}

export type EventStatus =
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
 */
export type ActionResult = {
  success: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
};
