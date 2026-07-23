import { describe, it, expect } from "vitest";
import { planNewEventNotifications } from "../plan-new-event";
import type { NotificationPerson } from "../plan-new-event";

function person(overrides: Partial<NotificationPerson> & { userId: string; email: string }): NotificationPerson {
  return {
    fullName: null,
    venueId: null,
    isCentralEventsLead: false,
    isAdministrator: false,
    ...overrides,
  };
}

const alice = person({ userId: "u-alice", email: "Alice@barons.test", fullName: "Alice" });
const bob = person({ userId: "u-bob", email: "bob@barons.test", fullName: "Bob" });
const carol = person({ userId: "u-carol", email: "carol@barons.test", fullName: "Carol", venueId: "v-2" });

describe("planNewEventNotifications", () => {
  it("gives the acting admin the announcement, not the decision email", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-alice",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: null,
      activeUsers: [alice, bob],
    });

    const forAlice = plan.messages.filter((m) => m.emailKey === "alice@barons.test");
    expect(forAlice).toHaveLength(1);
    expect(forAlice[0].kind).toBe("announcement");
  });

  it("gives a creator who is not the actor the decision email, not the announcement", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: null,
      activeUsers: [alice, bob],
    });

    const forAlice = plan.messages.filter((m) => m.emailKey === "alice@barons.test");
    expect(forAlice).toHaveLength(1);
    expect(forAlice[0].kind).toBe("review_decision");
  });

  it("gives the assignee the review email, not the announcement", () => {
    const plan = planNewEventNotifications({
      transition: "manager_submit",
      isFirstPublish: true,
      actorUserId: "u-carol",
      eventVenueIds: ["v-1"],
      creator: carol,
      assignee: bob,
      activeUsers: [alice, bob, carol],
    });

    const forBob = plan.messages.filter((m) => m.emailKey === "bob@barons.test");
    expect(forBob).toHaveLength(1);
    expect(forBob[0].kind).toBe("submitted_for_review");
  });

  it("includes every active user regardless of venue_id", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: null,
      assignee: null,
      activeUsers: [alice, bob, carol],
    });

    expect(plan.messages.map((m) => m.emailKey).sort()).toEqual([
      "alice@barons.test",
      "bob@barons.test",
      "carol@barons.test",
    ]);
  });

  it("never plans two messages for one inbox", () => {
    const twin = person({ userId: "u-twin", email: "ALICE@barons.test  " });
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: null,
      activeUsers: [alice, bob, twin],
    });

    const keys = plan.messages.map((m) => m.emailKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("plans no announcement when this is not the first publish", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: false,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: null,
      activeUsers: [alice, bob],
    });

    expect(plan.requiresClaim).toBe(false);
    expect(plan.messages.every((m) => m.kind !== "announcement")).toBe(true);
    expect(plan.messages).toHaveLength(1);
  });

  it("drops people with a blank email", () => {
    const blank = person({ userId: "u-blank", email: "   " });
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: null,
      assignee: null,
      activeUsers: [bob, blank],
    });

    expect(plan.messages).toHaveLength(1);
  });

  it("property: never duplicates an inbox across 200 randomised inputs", () => {
    const emails = ["a@x.test", "A@x.test ", "b@x.test", "c@x.test", " C@X.test"];
    for (let seed = 0; seed < 200; seed++) {
      const users = emails
        .filter((_, i) => (seed >> i) % 2 === 0)
        .map((email, i) => person({ userId: `u-${i}`, email }));
      if (users.length === 0) continue;

      const plan = planNewEventNotifications({
        transition: seed % 2 === 0 ? "admin_publish" : "manager_submit",
        isFirstPublish: seed % 3 !== 0,
        actorUserId: users[seed % users.length].userId,
        eventVenueIds: ["v-1"],
        creator: users[0] ?? null,
        assignee: users[users.length - 1] ?? null,
        activeUsers: users,
      });

      const keys = plan.messages.map((m) => m.emailKey);
      expect(new Set(keys).size, `seed ${seed}`).toBe(keys.length);
    }
  });

  it("gives an actor who assigned the event to themselves the announcement, not the review email", () => {
    const plan = planNewEventNotifications({
      transition: "manager_submit",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: bob,
      activeUsers: [alice, bob],
    });

    const forBob = plan.messages.filter((m) => m.emailKey === "bob@barons.test");
    expect(forBob).toHaveLength(1);
    expect(forBob[0].kind).toBe("announcement");
    expect(plan.suppressed).toContainEqual({
      emailKey: "bob@barons.test",
      userId: "u-bob",
      kind: "submitted_for_review",
      reason: "self_notification",
    });
  });

  it("sends to the address as stored, trimmed, not the lowercased key", () => {
    const shouty = person({ userId: "u-shouty", email: "  Shouty.Person@Barons.test  " });
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: null,
      assignee: null,
      activeUsers: [shouty],
    });

    expect(plan.messages[0].emailKey).toBe("shouty.person@barons.test");
    expect(plan.messages[0].sendTo).toBe("Shouty.Person@Barons.test");
  });

  it("classifies suppression as already_targeted when a targeted message owns the inbox", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: null,
      activeUsers: [alice, bob],
    });

    expect(plan.suppressed).toContainEqual({
      emailKey: "alice@barons.test",
      userId: "u-alice",
      kind: "announcement",
      reason: "already_targeted",
    });
  });

  it("classifies suppression as duplicate_email between two announcement recipients", () => {
    const twin = person({ userId: "u-twin", email: "BOB@barons.test" });
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-alice",
      eventVenueIds: ["v-1"],
      creator: null,
      assignee: null,
      activeUsers: [bob, twin],
    });

    expect(plan.suppressed).toContainEqual({
      emailKey: "bob@barons.test",
      userId: "u-twin",
      kind: "announcement",
      reason: "duplicate_email",
    });
  });

  it("never plans a review_decision on a manager_submit transition", () => {
    const plan = planNewEventNotifications({
      transition: "manager_submit",
      isFirstPublish: true,
      actorUserId: "u-carol",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: bob,
      activeUsers: [alice, bob, carol],
    });

    expect(plan.messages.some((m) => m.kind === "review_decision")).toBe(false);
  });
});
