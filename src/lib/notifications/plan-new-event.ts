export type NewEventTransition = "admin_publish" | "manager_submit";

export type NotificationPerson = {
  userId: string;
  email: string;
  fullName: string | null;
};

export type PlannedMessageKind = "review_decision" | "submitted_for_review";

export type PlannedMessage = {
  kind: PlannedMessageKind;
  /** The address exactly as stored, trimmed. This is what goes in `to`. */
  sendTo: string;
  userId: string;
  fullName: string | null;
};

export type SuppressionReason = "self_notification";

export type SuppressedMessage = {
  userId: string;
  kind: PlannedMessageKind;
  reason: SuppressionReason;
};

export type PlanNewEventNotificationsInput = {
  transition: NewEventTransition;
  actorUserId: string;
  creator: NotificationPerson | null;
  assignee: NotificationPerson | null;
};

export type NewEventNotificationPlan = {
  /** At most one message per transition. Null means nobody needs telling. */
  message: PlannedMessage | null;
  suppressed: SuppressedMessage[];
};

/**
 * Decides the single workflow email a new event transition should send.
 *
 * Publishing tells the creator their event was approved. Submitting tells the
 * assignee something is waiting for them. Neither sends when that person is the
 * one who clicked, because telling you what you just did is noise (product
 * decision, 2026-07-23).
 *
 * There is no longer a broadcast to every user. That was removed on 2026-08-19:
 * new events now reach the wider team through the Tuesday update instead
 * (see docs/superpowers/specs/2026-08-19-event-email-changes-scope.md).
 *
 * Identity is compared by `userId`, not by email. `public.users.email` carries a
 * unique constraint (`users_email_key`), so two rows cannot share an inbox and
 * the normalised-email comparison the broadcast needed is redundant here.
 */
export function planNewEventNotifications(
  input: PlanNewEventNotificationsInput
): NewEventNotificationPlan {
  const recipient = input.transition === "admin_publish" ? input.creator : input.assignee;
  const kind: PlannedMessageKind =
    input.transition === "admin_publish" ? "review_decision" : "submitted_for_review";

  if (!recipient) {
    return { message: null, suppressed: [] };
  }

  const sendTo = recipient.email.trim();
  if (sendTo.length === 0) {
    return { message: null, suppressed: [] };
  }

  // The assignee is normally a different administrator, but assigneeOverride on
  // the submit form allows self-assignment, so both branches need this guard.
  if (recipient.userId === input.actorUserId) {
    return {
      message: null,
      suppressed: [{ userId: recipient.userId, kind, reason: "self_notification" }]
    };
  }

  return {
    message: { kind, sendTo, userId: recipient.userId, fullName: recipient.fullName },
    suppressed: []
  };
}
