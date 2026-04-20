/**
 * Migration integration tests for office_worker event scope.
 *
 * Covers:
 *   - 20260420170000_office_worker_event_scope.sql (RLS + trigger + event_artists)
 *   - 20260420170500_propose_any_venue.sql (proposal RPC)
 *   - 20260420171000_reject_event_proposal_rpc.sql (atomic reject RPC)
 *
 * These tests require a live Supabase instance with the migrations applied and
 * are gated behind the `RUN_MIGRATION_INTEGRATION_TESTS=1` env var. They are
 * skipped in the default test run so CI / unit-test loops are unaffected.
 *
 * Required env:
 *   RUN_MIGRATION_INTEGRATION_TESTS=1
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_OW_JWT              (JWT for an office_worker WITH a venue_id)
 *   SUPABASE_OTHER_OW_JWT        (JWT for a different office_worker at a different venue)
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
const RUN_FLAG = process.env.RUN_MIGRATION_INTEGRATION_TESTS === "1";

const shouldRun =
  RUN_FLAG && Boolean(SUPABASE_URL) && Boolean(SERVICE_ROLE) && Boolean(OW_JWT) && Boolean(OTHER_OW_JWT);

// Anon key is only used for authenticated-session client construction; any valid
// anon key works for JWT-auth headers since the bearer token overrides it.
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? SERVICE_ROLE;

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

type Fixture = {
  venueA: string;
  venueB: string;
  venueDeleted: string;
  owId: string; // office_worker at venueA (has the SUPABASE_OW_JWT)
  otherOwId: string; // office_worker at venueB (has the SUPABASE_OTHER_OW_JWT)
  owNoVenueId: string; // office_worker with venue_id = null
  pendingEventId: string; // event in pending_approval for reject RPC test
  createdEventIds: string[];
  createdBatchKeys: string[];
};

const describeFn = shouldRun ? describe : describe.skip;

describeFn("migration: office_worker_event_scope", () => {
  let admin: SupabaseClient;
  const fx: Fixture = {
    venueA: "",
    venueB: "",
    venueDeleted: "",
    owId: "",
    otherOwId: "",
    owNoVenueId: "",
    pendingEventId: "",
    createdEventIds: [],
    createdBatchKeys: [],
  };

  beforeAll(async () => {
    admin = serviceRoleClient();

    // --- Resolve OW user ids from their JWTs -------------------------------
    // We use auth.getUser(jwt) via service-role admin to avoid relying on
    // shape of custom claims.
    const owUser = await admin.auth.getUser(OW_JWT);
    const otherOwUser = await admin.auth.getUser(OTHER_OW_JWT);
    if (owUser.error || !owUser.data.user) {
      throw new Error(`SUPABASE_OW_JWT is invalid: ${owUser.error?.message ?? "no user"}`);
    }
    if (otherOwUser.error || !otherOwUser.data.user) {
      throw new Error(
        `SUPABASE_OTHER_OW_JWT is invalid: ${otherOwUser.error?.message ?? "no user"}`,
      );
    }
    fx.owId = owUser.data.user.id;
    fx.otherOwId = otherOwUser.data.user.id;

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

    // --- Find-or-create an office_worker with NO venue_id -----------------
    const { data: noVenueRow } = await admin
      .from("users")
      .select("id")
      .eq("role", "office_worker")
      .is("venue_id", null)
      .is("deactivated_at", null)
      .limit(1)
      .maybeSingle();
    if (noVenueRow?.id) {
      fx.owNoVenueId = noVenueRow.id as string;
    } else {
      // Insert a placeholder users row (auth row not required for RPC venue loop).
      const id = crypto.randomUUID();
      const { error } = await admin.from("users").insert({
        id,
        role: "office_worker",
        venue_id: null,
        email: `office-worker-novenue-${id.slice(0, 8)}@example.test`,
        full_name: "Office Worker (no venue) — test fixture",
      });
      if (error) throw new Error(`Cannot provision no-venue OW: ${error.message}`);
      fx.owNoVenueId = id;
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
    for (const key of fx.createdBatchKeys) {
      await admin.from("event_creation_batches").delete().eq("idempotency_key", key);
    }
    if (fx.venueDeleted) {
      await admin.from("venues").delete().eq("id", fx.venueDeleted);
    }
    // Note: we do NOT delete the no-venue OW row as it may pre-exist; leave cleanup
    // to the environment seed script.
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
    expect(error?.message).toMatch(/transition event status/);
  });

  it("non-admin cannot set needs_revisions from any state", async () => {
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "nr-block",
        venue_id: fx.venueA,
        created_by: fx.owId,
        status: "draft",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    fx.createdEventIds.push(event!.id as string);

    const ow = jwtClient(OW_JWT);
    const { error } = await ow.from("events").update({ status: "needs_revisions" }).eq("id", event!.id);
    expect(error?.message).toMatch(/transition event status/);
  });

  // ─────────────────────────────────────────────────────────────────────
  // RLS: SELECT + UPDATE
  // ─────────────────────────────────────────────────────────────────────

  it("OW at another venue can SELECT any event (global read)", async () => {
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
    const { data, error } = await ow.from("events").select("id").eq("id", event!.id).single();
    expect(error).toBeNull();
    expect(data?.id).toBe(event!.id);
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
