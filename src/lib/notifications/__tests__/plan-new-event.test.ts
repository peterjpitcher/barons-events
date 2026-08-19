import { describe, it, expect } from "vitest";
import { planNewEventNotifications, type NotificationPerson } from "../plan-new-event";

const CREATOR: NotificationPerson = {
  userId: "u-creator",
  email: "creator@barons.test",
  fullName: "Casey Creator"
};

const ASSIGNEE: NotificationPerson = {
  userId: "u-assignee",
  email: "assignee@barons.test",
  fullName: "Ari Assignee"
};

describe("planNewEventNotifications", () => {
  it("tells the creator their event was approved when an administrator publishes", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      actorUserId: "u-admin",
      creator: CREATOR,
      assignee: ASSIGNEE
    });

    expect(plan.message).toEqual({
      kind: "review_decision",
      sendTo: "creator@barons.test",
      userId: "u-creator",
      fullName: "Casey Creator"
    });
    expect(plan.suppressed).toEqual([]);
  });

  it("tells the assignee when a manager submits for review", () => {
    const plan = planNewEventNotifications({
      transition: "manager_submit",
      actorUserId: "u-creator",
      creator: CREATOR,
      assignee: ASSIGNEE
    });

    expect(plan.message).toMatchObject({
      kind: "submitted_for_review",
      sendTo: "assignee@barons.test",
      userId: "u-assignee"
    });
  });

  it("says nothing when the publisher is the creator", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      actorUserId: "u-creator",
      creator: CREATOR,
      assignee: null
    });

    expect(plan.message).toBeNull();
    expect(plan.suppressed).toEqual([
      { userId: "u-creator", kind: "review_decision", reason: "self_notification" }
    ]);
  });

  it("says nothing when the submitter assigned the event to themselves", () => {
    const plan = planNewEventNotifications({
      transition: "manager_submit",
      actorUserId: "u-assignee",
      creator: CREATOR,
      assignee: ASSIGNEE
    });

    expect(plan.message).toBeNull();
    expect(plan.suppressed[0]?.reason).toBe("self_notification");
  });

  it("ignores the creator on a submit and the assignee on a publish", () => {
    const publish = planNewEventNotifications({
      transition: "admin_publish",
      actorUserId: "u-admin",
      creator: null,
      assignee: ASSIGNEE
    });
    expect(publish.message).toBeNull();

    const submit = planNewEventNotifications({
      transition: "manager_submit",
      actorUserId: "u-admin",
      creator: CREATOR,
      assignee: null
    });
    expect(submit.message).toBeNull();
  });

  it("never broadcasts: only the one targeted recipient can be returned", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      actorUserId: "u-admin",
      creator: CREATOR,
      assignee: ASSIGNEE
    });

    // The announcement to every active user was retired on 2026-08-19. If this
    // ever returns a second recipient, the broadcast has crept back in.
    expect(plan.message?.userId).toBe("u-creator");
    expect(Object.keys(plan)).toEqual(["message", "suppressed"]);
  });

  it("trims the stored address before sending and skips a blank one", () => {
    const padded = planNewEventNotifications({
      transition: "admin_publish",
      actorUserId: "u-admin",
      creator: { ...CREATOR, email: "  creator@barons.test  " },
      assignee: null
    });
    expect(padded.message?.sendTo).toBe("creator@barons.test");

    const blank = planNewEventNotifications({
      transition: "admin_publish",
      actorUserId: "u-admin",
      creator: { ...CREATOR, email: "   " },
      assignee: null
    });
    expect(blank.message).toBeNull();
  });
});
