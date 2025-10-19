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
