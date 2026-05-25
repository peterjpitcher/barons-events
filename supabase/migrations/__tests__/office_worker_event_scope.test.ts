/**
 * Migration integration tests for office_worker event scope.
 *
 * Covers:
 *   - 20260420170000_office_worker_event_scope.sql (RLS + trigger + event_artists)
 *   - 20260420170500_propose_any_venue.sql (proposal RPC)
 *   - 20260420171000_reject_event_proposal_rpc.sql (atomic reject RPC)
 *
 * These tests require a live Supabase instance with the migrations applied and
 * are gated behind the `RUN_SUPABASE_MIGRATION_TESTS=1` env var. They are
 * skipped in the default test run so CI / unit-test loops are unaffected.
 *
 * Required env:
 *   RUN_SUPABASE_MIGRATION_TESTS=1
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_OW_JWT              (JWT for an office_worker WITH a venue_id)
 *   SUPABASE_OTHER_OW_JWT        (JWT for a different office_worker at a different venue)
 *   SUPABASE_OW_NO_VENUE_JWT     (JWT for an office_worker WITHOUT a venue_id)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY (required for anon direct-read assertions)
 *   SUPABASE_EXECUTIVE_JWT        (optional JWT for executive read-deny assertions)
 *
 * All other fixtures (users, venues, pending event) are created in beforeAll
 * using the service-role client and cleaned up in afterAll.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const OW_JWT = process.env.SUPABASE_OW_JWT ?? "";
const OTHER_OW_JWT = process.env.SUPABASE_OTHER_OW_JWT ?? "";
const OW_NO_VENUE_JWT = process.env.SUPABASE_OW_NO_VENUE_JWT ?? "";
const EXECUTIVE_JWT = process.env.SUPABASE_EXECUTIVE_JWT ?? "";
const EXPLICIT_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const RUN_FLAG =
  process.env.RUN_SUPABASE_MIGRATION_TESTS === "1" ||
  process.env.RUN_MIGRATION_INTEGRATION_TESTS === "1";

const shouldRun =
  RUN_FLAG &&
  Boolean(SUPABASE_URL) &&
  Boolean(SERVICE_ROLE) &&
  Boolean(OW_JWT) &&
  Boolean(OTHER_OW_JWT) &&
  Boolean(OW_NO_VENUE_JWT);

// Anon key is only used for authenticated-session client construction; any valid
// anon key works for JWT-auth headers since the bearer token overrides it.
const ANON_KEY = EXPLICIT_ANON_KEY || SERVICE_ROLE;

function serviceRoleClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function jwtClient(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function anonymousClient(): SupabaseClient {
  return createClient(SUPABASE_URL, EXPLICIT_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Fixture = {
  venueA: string;
  venueB: string;
  venueDeleted: string;
  owId: string; // office_worker at venueA (has the SUPABASE_OW_JWT)
  otherOwId: string; // office_worker at venueB (has the SUPABASE_OTHER_OW_JWT)
  owNoVenueId: string; // office_worker with venue_id = null
  executiveId: string | null;
  pendingEventId: string; // event in pending_approval for reject RPC test
  createdEventIds: string[];
  createdPlanningItemIds: string[];
  createdBatchKeys: string[];
};

const describeFn = shouldRun ? describe : describe.skip;

function expectNoRows(result: { data: unknown[] | null; error: { message?: string } | null }) {
  expect(result.error).toBeNull();
  expect(result.data ?? []).toHaveLength(0);
}

describeFn("migration: office_worker_event_scope", () => {
  let admin: SupabaseClient;
  const fx: Fixture = {
    venueA: "",
    venueB: "",
    venueDeleted: "",
    owId: "",
    otherOwId: "",
    owNoVenueId: "",
    executiveId: null,
    pendingEventId: "",
    createdEventIds: [],
    createdPlanningItemIds: [],
    createdBatchKeys: [],
  };

  beforeAll(async () => {
    admin = serviceRoleClient();

    // --- Resolve OW user ids from their JWTs -------------------------------
    // We use auth.getUser(jwt) via service-role admin to avoid relying on
    // shape of custom claims.
    const owUser = await admin.auth.getUser(OW_JWT);
    const otherOwUser = await admin.auth.getUser(OTHER_OW_JWT);
    const noVenueOwUser = await admin.auth.getUser(OW_NO_VENUE_JWT);
    if (owUser.error || !owUser.data.user) {
      throw new Error(`SUPABASE_OW_JWT is invalid: ${owUser.error?.message ?? "no user"}`);
    }
    if (otherOwUser.error || !otherOwUser.data.user) {
      throw new Error(
        `SUPABASE_OTHER_OW_JWT is invalid: ${otherOwUser.error?.message ?? "no user"}`,
      );
    }
    if (noVenueOwUser.error || !noVenueOwUser.data.user) {
      throw new Error(
        `SUPABASE_OW_NO_VENUE_JWT is invalid: ${noVenueOwUser.error?.message ?? "no user"}`,
      );
    }
    fx.owId = owUser.data.user.id;
    fx.otherOwId = otherOwUser.data.user.id;
    fx.owNoVenueId = noVenueOwUser.data.user.id;
    if (EXECUTIVE_JWT) {
      const executiveUser = await admin.auth.getUser(EXECUTIVE_JWT);
      if (executiveUser.error || !executiveUser.data.user) {
        throw new Error(`SUPABASE_EXECUTIVE_JWT is invalid: ${executiveUser.error?.message ?? "no user"}`);
      }
      fx.executiveId = executiveUser.data.user.id;
    }

    // --- Look up / verify venues for both OWs ------------------------------
    const { data: owRow, error: owRowErr } = await admin
      .from("users")
      .select("venue_id, role")
      .eq("id", fx.owId)
      .single();
    if (owRowErr || !owRow) throw new Error(`Cannot load OW user row: ${owRowErr?.message}`);
    if (owRow.role !== "office_worker" || !owRow.venue_id) {
      throw new Error("SUPABASE_OW_JWT must be for an office_worker WITH a venue_id");
    }
    fx.venueA = owRow.venue_id as string;

    const { data: otherRow, error: otherRowErr } = await admin
      .from("users")
      .select("venue_id, role")
      .eq("id", fx.otherOwId)
      .single();
    if (otherRowErr || !otherRow) throw new Error(`Cannot load other OW user row: ${otherRowErr?.message}`);
    if (otherRow.role !== "office_worker" || !otherRow.venue_id) {
      throw new Error("SUPABASE_OTHER_OW_JWT must be for an office_worker WITH a venue_id");
    }
    if (otherRow.venue_id === fx.venueA) {
      throw new Error("SUPABASE_OW_JWT and SUPABASE_OTHER_OW_JWT must be at different venues");
    }
    fx.venueB = otherRow.venue_id as string;

    const { data: noVenueRow, error: noVenueRowErr } = await admin
      .from("users")
      .select("venue_id, role")
      .eq("id", fx.owNoVenueId)
      .single();
    if (noVenueRowErr || !noVenueRow) {
      throw new Error(`Cannot load no-venue OW user row: ${noVenueRowErr?.message}`);
    }
    if (noVenueRow.role !== "office_worker" || noVenueRow.venue_id) {
      throw new Error("SUPABASE_OW_NO_VENUE_JWT must be for an office_worker WITHOUT a venue_id");
    }

    if (fx.executiveId) {
      const { data: executiveRow, error: executiveRowErr } = await admin
        .from("users")
        .select("role")
        .eq("id", fx.executiveId)
        .single();
      if (executiveRowErr || !executiveRow) {
        throw new Error(`Cannot load executive user row: ${executiveRowErr?.message}`);
      }
      if (executiveRow.role !== "executive") {
        throw new Error("SUPABASE_EXECUTIVE_JWT must be for an executive user");
      }
    }

    // --- Soft-deleted venue fixture ---------------------------------------
    const { data: delVenue, error: delVenueErr } = await admin
      .from("venues")
      .insert({
        name: "DELETED fixture venue",
        deleted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (delVenueErr || !delVenue) throw new Error(`Cannot create deleted venue: ${delVenueErr?.message}`);
    fx.venueDeleted = delVenue.id as string;

    // --- Pending-approval event for reject RPC test ------------------------
    const { data: pending, error: pendingErr } = await admin
      .from("events")
      .insert({
        title: "reject-fixture",
        venue_id: fx.venueA,
        created_by: fx.owId,
        status: "pending_approval",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (pendingErr || !pending) throw new Error(`Cannot create pending event: ${pendingErr?.message}`);
    fx.pendingEventId = pending.id as string;
    fx.createdEventIds.push(fx.pendingEventId);
  });

  afterAll(async () => {
    if (!shouldRun) return;
    // Best-effort cleanup; ignore individual errors.
    for (const id of fx.createdEventIds) {
      await admin.from("events").delete().eq("id", id);
    }
    for (const id of fx.createdPlanningItemIds) {
      await admin.from("planning_items").delete().eq("id", id);
    }
    for (const key of fx.createdBatchKeys) {
      await admin.from("event_creation_batches").delete().eq("idempotency_key", key);
    }
    if (fx.venueDeleted) {
      await admin.from("venues").delete().eq("id", fx.venueDeleted);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // TRIGGER: sensitive-column + status-transition
  // ─────────────────────────────────────────────────────────────────────

  it("non-admin cannot change venue_id (trigger)", async () => {
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "trigger-venue",
        venue_id: fx.venueA,
        created_by: fx.owId,
        manager_responsible_id: fx.owId,
        status: "approved",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const ow = jwtClient(OW_JWT);
    const { error } = await ow.from("events").update({ venue_id: fx.venueB }).eq("id", event!.id);

    expect(error?.message).toMatch(/venue_id/);
  });

  it("service-role session bypasses sensitive-updates trigger", async () => {
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "trigger-bypass",
        venue_id: fx.venueA,
        created_by: fx.owId,
        manager_responsible_id: fx.owId,
        status: "approved",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const { error } = await admin.from("events").update({ venue_id: fx.venueB }).eq("id", event!.id);
    expect(error).toBeNull();
  });

  it("non-admin cannot transition pending_approval → approved", async () => {
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "status-tx",
        venue_id: fx.venueA,
        created_by: fx.owId,
        status: "pending_approval",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const ow = jwtClient(OW_JWT);
    const { error } = await ow.from("events").update({ status: "approved" }).eq("id", event!.id);
    if (error) {
      expect(error.message).toMatch(/transition event status|row-level security|approve or reject/i);
    }

    const { data: after } = await admin.from("events").select("status").eq("id", event!.id).single();
    expect(after?.status).toBe("pending_approval");
  });

  it("non-admin cannot reject a pending proposal directly", async () => {
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "status-reject",
        venue_id: fx.venueA,
        created_by: fx.owId,
        status: "pending_approval",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const ow = jwtClient(OW_JWT);
    const { error } = await ow.from("events").update({ status: "rejected" }).eq("id", event!.id);
    if (error) {
      expect(error.message).toMatch(/transition event status|row-level security|approve or reject/i);
    }

    const { data: after } = await admin.from("events").select("status").eq("id", event!.id).single();
    expect(after?.status).toBe("pending_approval");
  });

  it("non-admin cannot set needs_revisions from any state", async () => {
    const startAt = new Date(Date.now() + 86_400_000).toISOString();
    const endAt = new Date(Date.now() + 90_000_000).toISOString();
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "nr-block",
        venue_id: fx.venueA,
        created_by: fx.owId,
        status: "draft",
        event_type: "Live Music",
        venue_space: "Main Bar",
        start_at: startAt,
        end_at: endAt,
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const ow = jwtClient(OW_JWT);
    const { error } = await ow.from("events").update({ status: "needs_revisions" }).eq("id", event!.id);
    expect(error?.message).toMatch(/transition event status/);
  });

  it("creator office_worker can transition own full-form draft to submitted", async () => {
    const startAt = new Date(Date.now() + 86_400_000).toISOString();
    const endAt = new Date(Date.now() + 90_000_000).toISOString();
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "full-form-submit",
        venue_id: fx.venueA,
        created_by: fx.owId,
        status: "draft",
        event_type: "Live Music",
        venue_space: "Main Bar",
        start_at: startAt,
        end_at: endAt,
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const ow = jwtClient(OW_JWT);
    const { error } = await ow
      .from("events")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", event!.id);
    expect(error).toBeNull();

    const { data: after } = await admin.from("events").select("status").eq("id", event!.id).single();
    expect(after?.status).toBe("submitted");
  });

  // ─────────────────────────────────────────────────────────────────────
  // RLS: SELECT + UPDATE
  // ─────────────────────────────────────────────────────────────────────

  it("anon cannot directly read public API base tables", async () => {
    if (!EXPLICIT_ANON_KEY) {
      console.warn("Skipping anon base-table RLS assertion: NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
      return;
    }

    const { data: event, error: eventErr } = await admin
      .from("events")
      .insert({
        title: "anon-deny-event",
        venue_id: fx.venueA,
        created_by: fx.owId,
        status: "approved",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(eventErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const eventTypeLabel = `RBAC anon fixture ${Date.now()}`;
    const { data: eventType, error: eventTypeErr } = await admin
      .from("event_types")
      .insert({ label: eventTypeLabel })
      .select("id")
      .single();
    expect(eventTypeErr).toBeNull();

    const serviceName = `RBAC anon service ${Date.now()}`;
    const { data: serviceType, error: serviceTypeErr } = await admin
      .from("venue_service_types")
      .insert({ name: serviceName, display_order: 9999 })
      .select("id")
      .single();
    expect(serviceTypeErr).toBeNull();

    const { data: openingHour, error: openingHourErr } = await admin
      .from("venue_opening_hours")
      .insert({
        venue_id: fx.venueA,
        service_type_id: serviceType!.id,
        day_of_week: 0,
        open_time: "10:00",
        close_time: "22:00",
      })
      .select("id")
      .single();
    expect(openingHourErr).toBeNull();

    const { error: venueServiceErr } = await admin
      .from("venue_services")
      .insert({
        venue_id: fx.venueA,
        service_type_id: serviceType!.id,
      });
    expect(venueServiceErr).toBeNull();

    const { data: override, error: overrideErr } = await admin
      .from("venue_opening_overrides")
      .insert({
        override_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        service_type_id: serviceType!.id,
        is_closed: true,
        note: "RBAC anon fixture",
      })
      .select("id")
      .single();
    expect(overrideErr).toBeNull();

    const { error: overrideVenueErr } = await admin
      .from("venue_opening_override_venues")
      .insert({
        override_id: override!.id,
        venue_id: fx.venueA,
      });
    expect(overrideVenueErr).toBeNull();

    try {
      const anon = anonymousClient();
      const checks = await Promise.all([
        anon.from("events").select("id, notes").eq("id", event!.id),
        anon.from("venues").select("id, name").eq("id", fx.venueA),
        anon.from("event_types").select("id, label").eq("id", eventType!.id),
        anon.from("venue_service_types").select("id, name").eq("id", serviceType!.id),
        anon.from("venue_services").select("venue_id, service_type_id").eq("service_type_id", serviceType!.id),
        anon.from("venue_opening_hours").select("id").eq("id", openingHour!.id),
        anon.from("venue_opening_overrides").select("id").eq("id", override!.id),
        anon.from("venue_opening_override_venues").select("override_id").eq("override_id", override!.id),
      ]);

      for (const result of checks) {
        expect(result.error || (result.data ?? []).length === 0).toBeTruthy();
      }
    } finally {
      await admin.from("event_types").delete().eq("id", eventType!.id);
      await admin.from("venue_service_types").delete().eq("id", serviceType!.id);
    }
  });

  it("event child table reads follow parent event visibility", async () => {
    const { data: event, error: eventErr } = await admin
      .from("events")
      .insert({
        title: "child-visibility-other-venue",
        venue_id: fx.venueB,
        created_by: fx.otherOwId,
        manager_responsible_id: fx.otherOwId,
        status: "approved",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(eventErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const { error: versionErr } = await admin.from("event_versions").insert({
      event_id: event!.id,
      version: 1,
      payload: { title: "child-visibility-other-venue" },
      submitted_by: fx.otherOwId,
    });
    expect(versionErr).toBeNull();

    const { error: approvalErr } = await admin.from("approvals").insert({
      event_id: event!.id,
      reviewer_id: fx.otherOwId,
      decision: "approved",
      feedback_text: "fixture",
    });
    expect(approvalErr).toBeNull();

    const { error: debriefErr } = await admin.from("debriefs").insert({
      event_id: event!.id,
      attendance: 42,
      submitted_by: fx.otherOwId,
    });
    expect(debriefErr).toBeNull();

    const { data: artist, error: artistErr } = await admin
      .from("artists")
      .insert({
        name: `RBAC child artist ${Date.now()}`,
        created_by: fx.otherOwId,
      })
      .select("id")
      .single();
    expect(artistErr).toBeNull();

    const { error: eventArtistErr } = await admin.from("event_artists").insert({
      event_id: event!.id,
      artist_id: artist!.id,
      created_by: fx.otherOwId,
    });
    expect(eventArtistErr).toBeNull();

    try {
      const assignedOw = jwtClient(OW_JWT);
      expectNoRows(await assignedOw.from("event_versions").select("id").eq("event_id", event!.id));
      expectNoRows(await assignedOw.from("approvals").select("id").eq("event_id", event!.id));
      expectNoRows(await assignedOw.from("debriefs").select("id").eq("event_id", event!.id));
      expectNoRows(await assignedOw.from("event_artists").select("id").eq("event_id", event!.id));

      const noVenueOw = jwtClient(OW_NO_VENUE_JWT);
      for (const table of ["event_versions", "approvals", "debriefs", "event_artists"] as const) {
        const { data, error } = await noVenueOw.from(table).select("id").eq("event_id", event!.id);
        expect(error).toBeNull();
        expect(data ?? []).toHaveLength(1);
      }

      if (EXECUTIVE_JWT) {
        const executive = jwtClient(EXECUTIVE_JWT);
        for (const table of ["event_versions", "approvals", "debriefs", "event_artists"] as const) {
          const { data, error } = await executive.from(table).select("id").eq("event_id", event!.id);
          expect(error).toBeNull();
          expect(data ?? []).toHaveLength(1);
        }
      }
    } finally {
      await admin.from("artists").delete().eq("id", artist!.id);
    }
  });

  it("planning child table reads follow parent planning item visibility", async () => {
    const { data: item, error: itemErr } = await admin
      .from("planning_items")
      .insert({
        title: "planning-child-other-venue",
        type_label: "Campaign",
        venue_id: fx.venueB,
        target_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        status: "planned",
        created_by: fx.otherOwId,
      })
      .select("id")
      .single();
    expect(itemErr).toBeNull();
    fx.createdPlanningItemIds.push(item!.id as string);

    const dueDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { data: taskA, error: taskAErr } = await admin
      .from("planning_tasks")
      .insert({
        planning_item_id: item!.id,
        title: "Child task A",
        assignee_id: fx.otherOwId,
        due_date: dueDate,
        created_by: fx.otherOwId,
      })
      .select("id")
      .single();
    expect(taskAErr).toBeNull();

    const { data: taskB, error: taskBErr } = await admin
      .from("planning_tasks")
      .insert({
        planning_item_id: item!.id,
        title: "Child task B",
        assignee_id: fx.otherOwId,
        due_date: dueDate,
        created_by: fx.otherOwId,
      })
      .select("id")
      .single();
    expect(taskBErr).toBeNull();

    const { error: assigneeErr } = await admin.from("planning_task_assignees").insert({
      task_id: taskA!.id,
      user_id: fx.otherOwId,
    });
    expect(assigneeErr).toBeNull();

    const { error: dependencyErr } = await admin.from("planning_task_dependencies").insert({
      task_id: taskA!.id,
      depends_on_task_id: taskB!.id,
    });
    expect(dependencyErr).toBeNull();

    const assignedOw = jwtClient(OW_JWT);
    expectNoRows(await assignedOw.from("planning_task_assignees").select("id").eq("task_id", taskA!.id));
    expectNoRows(await assignedOw.from("planning_task_dependencies").select("id").eq("task_id", taskA!.id));

    const noVenueOw = jwtClient(OW_NO_VENUE_JWT);
    const assignees = await noVenueOw.from("planning_task_assignees").select("id").eq("task_id", taskA!.id);
    expect(assignees.error).toBeNull();
    expect(assignees.data ?? []).toHaveLength(1);
    const dependencies = await noVenueOw.from("planning_task_dependencies").select("id").eq("task_id", taskA!.id);
    expect(dependencies.error).toBeNull();
    expect(dependencies.data ?? []).toHaveLength(1);

    if (EXECUTIVE_JWT) {
      const executive = jwtClient(EXECUTIVE_JWT);
      const executiveAssignees = await executive.from("planning_task_assignees").select("id").eq("task_id", taskA!.id);
      expect(executiveAssignees.error).toBeNull();
      expect(executiveAssignees.data ?? []).toHaveLength(1);
      const executiveDependencies = await executive.from("planning_task_dependencies").select("id").eq("task_id", taskA!.id);
      expect(executiveDependencies.error).toBeNull();
      expect(executiveDependencies.data ?? []).toHaveLength(1);
    }
  });

  it("payment rows are readable to office workers but not executives", async () => {
    const { data: event, error: eventErr } = await admin
      .from("events")
      .insert({
        title: "payment-rbac-event",
        venue_id: fx.venueB,
        created_by: fx.otherOwId,
        status: "approved",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(eventErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const { data: booking, error: bookingErr } = await admin
      .from("event_bookings")
      .insert({
        event_id: event!.id,
        first_name: "RBAC",
        mobile: "+447700900000",
        ticket_count: 1,
      })
      .select("id")
      .single();
    expect(bookingErr).toBeNull();

    const unique = Date.now();
    const { data: transaction, error: transactionErr } = await admin
      .from("payment_transactions")
      .insert({
        booking_id: booking!.id,
        event_id: event!.id,
        stripe_checkout_session_id: `cs_test_rbac_${unique}`,
        amount_pence: 1000,
        idempotency_key: `rbac-payment-${unique}`,
      })
      .select("id")
      .single();
    expect(transactionErr).toBeNull();

    const { data: refund, error: refundErr } = await admin
      .from("payment_refunds")
      .insert({
        transaction_id: transaction!.id,
        booking_id: booking!.id,
        event_id: event!.id,
        stripe_refund_id: `re_test_rbac_${unique}`,
        amount_pence: 100,
        idempotency_key: `rbac-refund-${unique}`,
      })
      .select("id")
      .single();
    expect(refundErr).toBeNull();

    const assignedOw = jwtClient(OW_JWT);
    const owTransactions = await assignedOw.from("payment_transactions").select("id").eq("id", transaction!.id);
    expect(owTransactions.error).toBeNull();
    expect(owTransactions.data ?? []).toHaveLength(1);
    const owRefunds = await assignedOw.from("payment_refunds").select("id").eq("id", refund!.id);
    expect(owRefunds.error).toBeNull();
    expect(owRefunds.data ?? []).toHaveLength(1);

    if (!EXECUTIVE_JWT) {
      console.warn("Skipping executive payment RLS assertion: SUPABASE_EXECUTIVE_JWT is not set");
      return;
    }

    const executive = jwtClient(EXECUTIVE_JWT);
    expectNoRows(await executive.from("payment_transactions").select("id").eq("id", transaction!.id));
    expectNoRows(await executive.from("payment_refunds").select("id").eq("id", refund!.id));
  });

  it("venue-assigned OW cannot SELECT an event linked only to another venue", async () => {
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "select-global",
        venue_id: fx.venueB,
        created_by: fx.otherOwId,
        status: "approved",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const ow = jwtClient(OW_JWT);
    const { data, error } = await ow.from("events").select("id").eq("id", event!.id).maybeSingle();
    expect(data).toBeNull();
    if (error) {
      expect(error.message).toMatch(/row|permission|not found|multiple/i);
    }
  });

  it("venue-assigned OW can SELECT an event linked to their venue through event_venues", async () => {
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "select-multi-venue",
        venue_id: fx.venueB,
        created_by: fx.otherOwId,
        status: "approved",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const { error: linkErr } = await admin
      .from("event_venues")
      .upsert(
        [
          { event_id: event!.id, venue_id: fx.venueB, is_primary: true },
          { event_id: event!.id, venue_id: fx.venueA, is_primary: false },
        ],
        { onConflict: "event_id,venue_id" },
      );
    expect(linkErr).toBeNull();

    const ow = jwtClient(OW_JWT);
    const { data, error } = await ow.from("events").select("id").eq("id", event!.id).single();
    expect(error).toBeNull();
    expect(data?.id).toBe(event!.id);
  });

  it("OW without venue_id can SELECT events globally", async () => {
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "select-no-venue-global",
        venue_id: fx.venueB,
        created_by: fx.otherOwId,
        status: "approved",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const noVenue = jwtClient(OW_NO_VENUE_JWT);
    const { data, error } = await noVenue.from("events").select("id").eq("id", event!.id).single();
    expect(error).toBeNull();
    expect(data?.id).toBe(event!.id);
  });

  it("venue-assigned OW planning reads follow primary and linked venues", async () => {
    const { data: own, error: ownErr } = await admin
      .from("planning_items")
      .insert({
        title: "planning-own-venue",
        type_label: "Campaign",
        venue_id: fx.venueA,
        target_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        status: "planned",
        created_by: fx.owId,
      })
      .select("id")
      .single();
    expect(ownErr).toBeNull();
    fx.createdPlanningItemIds.push(own!.id as string);

    const { data: linked, error: linkedErr } = await admin
      .from("planning_items")
      .insert({
        title: "planning-linked-venue",
        type_label: "Campaign",
        venue_id: fx.venueB,
        target_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        status: "planned",
        created_by: fx.otherOwId,
      })
      .select("id")
      .single();
    expect(linkedErr).toBeNull();
    fx.createdPlanningItemIds.push(linked!.id as string);

    const { data: other, error: otherErr } = await admin
      .from("planning_items")
      .insert({
        title: "planning-other-venue",
        type_label: "Campaign",
        venue_id: fx.venueB,
        target_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        status: "planned",
        created_by: fx.otherOwId,
      })
      .select("id")
      .single();
    expect(otherErr).toBeNull();
    fx.createdPlanningItemIds.push(other!.id as string);

    const { error: linkErr } = await admin
      .from("planning_item_venues")
      .upsert(
        [
          { planning_item_id: linked!.id, venue_id: fx.venueB, is_primary: true },
          { planning_item_id: linked!.id, venue_id: fx.venueA, is_primary: false },
        ],
        { onConflict: "planning_item_id,venue_id" },
      );
    expect(linkErr).toBeNull();

    const ow = jwtClient(OW_JWT);
    const { data, error } = await ow
      .from("planning_items")
      .select("id")
      .in("id", [own!.id, linked!.id, other!.id]);
    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id).sort()).toEqual([linked!.id, own!.id].sort());
  });

  it("OW without venue_id can SELECT planning globally", async () => {
    const { data: item, error: insErr } = await admin
      .from("planning_items")
      .insert({
        title: "planning-no-venue-global",
        type_label: "Campaign",
        venue_id: fx.venueB,
        target_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        status: "planned",
        created_by: fx.otherOwId,
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdPlanningItemIds.push(item!.id as string);

    const noVenue = jwtClient(OW_NO_VENUE_JWT);
    const { data, error } = await noVenue.from("planning_items").select("id").eq("id", item!.id).single();
    expect(error).toBeNull();
    expect(data?.id).toBe(item!.id);
  });

  it("venue-assigned OW can INSERT only for their assigned venue", async () => {
    const ow = jwtClient(OW_JWT);

    const ok = await ow
      .from("events")
      .insert({
        title: "insert-own-venue",
        venue_id: fx.venueA,
        created_by: fx.owId,
        status: "draft",
        event_type: "Live Music",
        venue_space: "Main Bar",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
        end_at: new Date(Date.now() + 90_000_000).toISOString(),
      })
      .select("id")
      .single();
    expect(ok.error).toBeNull();
    fx.createdEventIds.push(ok.data!.id as string);

    const fail = await ow
      .from("events")
      .insert({
        title: "insert-other-venue",
        venue_id: fx.venueB,
        created_by: fx.owId,
        status: "draft",
        event_type: "Live Music",
        venue_space: "Main Bar",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
        end_at: new Date(Date.now() + 90_000_000).toISOString(),
      })
      .select("id")
      .single();
    expect(fail.error).toBeTruthy();
  });

  it("OW without venue_id can INSERT events for any active venue", async () => {
    const noVenue = jwtClient(OW_NO_VENUE_JWT);
    const result = await noVenue
      .from("events")
      .insert({
        title: "insert-no-venue-global",
        venue_id: fx.venueB,
        created_by: fx.owNoVenueId,
        status: "draft",
        event_type: "Live Music",
        venue_space: "Main Bar",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
        end_at: new Date(Date.now() + 90_000_000).toISOString(),
      })
      .select("id")
      .single();

    expect(result.error).toBeNull();
    fx.createdEventIds.push(result.data!.id as string);
  });

  it("OW manager on approved event can UPDATE notes; non-manager at another venue cannot", async () => {
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "edit-scope",
        venue_id: fx.venueA,
        created_by: fx.owId,
        manager_responsible_id: fx.owId,
        status: "approved",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const manager = jwtClient(OW_JWT);
    const other = jwtClient(OTHER_OW_JWT);

    const ok = await manager.from("events").update({ notes: "updated" }).eq("id", event!.id);
    expect(ok.error).toBeNull();

    const fail = await other.from("events").update({ notes: "sneaky" }).eq("id", event!.id);
    // RLS-blocked update returns no error but also no rows updated; assert both paths.
    if (!fail.error) {
      const { data: after } = await admin.from("events").select("notes").eq("id", event!.id).single();
      expect(after?.notes).toBe("updated");
    } else {
      expect(fail.error).toBeTruthy();
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // RPC: create_multi_venue_event_proposals
  // ─────────────────────────────────────────────────────────────────────

  it("proposal RPC accepts OW without venue_id for any venue (service-role only)", async () => {
    const key = crypto.randomUUID();
    fx.createdBatchKeys.push(key);
    const { data, error } = await admin.rpc("create_multi_venue_event_proposals", {
      p_payload: {
        created_by: fx.owNoVenueId,
        venue_ids: [fx.venueB],
        title: "cross-venue proposal",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
        notes: "test",
      },
      p_idempotency_key: key,
    });
    expect(error).toBeNull();
    if (data && typeof data === "object" && "event_id" in data) {
      fx.createdEventIds.push((data as { event_id: string }).event_id);
    }
  });

  it("proposal RPC rejects deleted venue id", async () => {
    const key = crypto.randomUUID();
    fx.createdBatchKeys.push(key);
    const { error } = await admin.rpc("create_multi_venue_event_proposals", {
      p_payload: {
        created_by: fx.owId,
        venue_ids: [fx.venueDeleted],
        title: "invalid venue",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
        notes: "test",
      },
      p_idempotency_key: key,
    });
    expect(error?.message).toMatch(/invalid or deleted/);
  });

  it("proposal RPC is re-entrant on crash-after-claim", async () => {
    const key = crypto.randomUUID();
    fx.createdBatchKeys.push(key);

    // Simulate crash: insert batch row with null result directly.
    const { error: claimErr } = await admin.from("event_creation_batches").insert({
      idempotency_key: key,
      created_by: fx.owId,
      batch_payload: {},
    });
    expect(claimErr).toBeNull();

    // Now call the RPC with the same key — it should execute rather than raise.
    const { data, error } = await admin.rpc("create_multi_venue_event_proposals", {
      p_payload: {
        created_by: fx.owId,
        venue_ids: [fx.venueA],
        title: "retry after crash",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
        notes: "test",
      },
      p_idempotency_key: key,
    });
    expect(error).toBeNull();
    if (data && typeof data === "object" && "event_id" in data) {
      fx.createdEventIds.push((data as { event_id: string }).event_id);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // RPC: reject_event_proposal
  // ─────────────────────────────────────────────────────────────────────

  it("reject_event_proposal RPC rejects non-admin p_admin_id", async () => {
    const { error } = await admin.rpc("reject_event_proposal", {
      p_event_id: fx.pendingEventId,
      p_admin_id: fx.owId,
      p_reason: "wrong user",
    });
    expect(error?.message).toMatch(/not an active administrator/);
  });
});
