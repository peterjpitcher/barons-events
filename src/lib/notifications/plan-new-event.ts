export type NewEventTransition = "admin_publish" | "manager_submit";

export type NotificationPerson = {
  userId: string;
  email: string;
  fullName: string | null;
  venueId: string | null;
  isCentralEventsLead: boolean;
  isAdministrator: boolean;
};

export type PlannedMessageKind = "review_decision" | "submitted_for_review" | "announcement";

export type PlannedMessage = {
  kind: PlannedMessageKind;
  /** trim().toLowerCase(). The identity key. Never used as the send address. */
  emailKey: string;
  /** The address exactly as stored. This is what goes in `to`. */
  sendTo: string;
  userId: string;
  fullName: string | null;
};

export type SuppressionReason = "self_notification" | "already_targeted" | "duplicate_email";

export type SuppressedMessage = {
  emailKey: string;
  userId: string;
  kind: PlannedMessageKind;
  reason: SuppressionReason;
};

export type PlanNewEventNotificationsInput = {
  transition: NewEventTransition;
  /** True only when the row's status immediately BEFORE this transition was "draft". */
  isFirstPublish: boolean;
  actorUserId: string;
  /** events.venue_id plus every event_venues.venue_id. Retained for future scoping. */
  eventVenueIds: string[];
  creator: NotificationPerson | null;
  assignee: NotificationPerson | null;
  /** Active users with an email, stable order (full_name asc). */
  activeUsers: NotificationPerson[];
};

export type NewEventNotificationPlan = {
  /** Invariant: at most one entry per emailKey. Holds by construction. */
  messages: PlannedMessage[];
  suppressed: SuppressedMessage[];
  /** True when this transition is the announcing transition, so it must take the claim. */
  requiresClaim: boolean;
};

function normalise(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Decides the ONE message each normalised inbox receives for a new event.
 *
 * Priority: assignee gets the review email; a creator who is not the actor gets
 * the decision email; everyone else, including the actor, gets the announcement.
 * The actor's own decision email is dropped because telling you that you
 * approved your own event is noise (product decision, 2026-07-23).
 */
export function planNewEventNotifications(
  input: PlanNewEventNotificationsInput
): NewEventNotificationPlan {
  const messages: PlannedMessage[] = [];
  const suppressed: SuppressedMessage[] = [];
  const claimedKeys = new Map<string, PlannedMessageKind>();

  const actorKey = ((): string | null => {
    const found = input.activeUsers.find((u) => u.userId === input.actorUserId)
      ?? (input.creator?.userId === input.actorUserId ? input.creator : null)
      ?? (input.assignee?.userId === input.actorUserId ? input.assignee : null);
    const key = found ? normalise(found.email) : "";
    return key.length > 0 ? key : null;
  })();

  function plan(person: NotificationPerson, kind: PlannedMessageKind): void {
    const emailKey = normalise(person.email);
    if (emailKey.length === 0) return;
    const existing = claimedKeys.get(emailKey);
    if (existing) {
      suppressed.push({
        emailKey,
        userId: person.userId,
        kind,
        reason: existing === "announcement" ? "duplicate_email" : "already_targeted",
      });
      return;
    }
    claimedKeys.set(emailKey, kind);
    messages.push({ kind, emailKey, sendTo: person.email.trim(), userId: person.userId, fullName: person.fullName });
  }

  /**
   * Plans a targeted message, unless it would tell the actor about their own
   * action. Self-notification is noise: the actor knows what they just did.
   * A suppressed actor is not dropped, they fall through to the announcement
   * loop below and receive the broadcast like everyone else.
   */
  function planTargeted(person: NotificationPerson, kind: PlannedMessageKind): void {
    const emailKey = normalise(person.email);
    if (emailKey.length > 0 && emailKey === actorKey) {
      suppressed.push({ emailKey, userId: person.userId, kind, reason: "self_notification" });
      return;
    }
    plan(person, kind);
  }

  // Targeted messages first, so they own their inbox before the broadcast runs.
  if (input.transition === "admin_publish" && input.creator) {
    planTargeted(input.creator, "review_decision");
  }

  // The assignee is normally a different administrator, but assigneeOverride on
  // the submit form allows self-assignment, so guard this branch too.
  if (input.transition === "manager_submit" && input.assignee) {
    planTargeted(input.assignee, "submitted_for_review");
  }

  const requiresClaim = input.isFirstPublish;
  if (!requiresClaim) {
    return { messages, suppressed, requiresClaim };
  }

  // Audience is every active user. Product decision 2026-07-23: the announcement
  // goes to all application users, so there is no venue filter.
  for (const person of input.activeUsers) {
    plan(person, "announcement");
  }

  return { messages, suppressed, requiresClaim };
}
