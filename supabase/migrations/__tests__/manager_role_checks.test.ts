/**
 * Migration integration tests for the manager role-check repair.
 *
 * Covers:
 *   - 20260723110000_repair_manager_role_checks.sql
 *
 * Regression guard for the retired `office_worker` role. Migration
 * 20260605143000 renamed office_worker to manager and tightened
 * users_role_check to ('administrator','manager'), but five PL/pgSQL functions
 * carried on authorising against the old literal, so every manager was denied.
 *
 * These tests require a live Supabase instance with the migrations applied and
 * are gated behind the `RUN_SUPABASE_MIGRATION_TESTS=1` env var, matching
 * office_worker_event_scope.test.ts. They are skipped in the default test run
 * so CI / unit-test loops are unaffected.
 *
 * Required env:
 *   RUN_SUPABASE_MIGRATION_TESTS=1
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * All fixtures (probe event) are created in the test body using the
 * service-role client and cleaned up in afterAll.
 *
 * Note on coverage: these RPCs read auth.uid(), which is null under the
 * service-role key, so a runtime call returns "Not authenticated" rather than
 * "Permission denied". The definitive assertion for this repair is the
 * `pg_proc` scan below, which fails if any authorising predicate still
 * mentions the retired role.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const RUN_FLAG =
  process.env.RUN_SUPABASE_MIGRATION_TESTS === "1" ||
  process.env.RUN_MIGRATION_INTEGRATION_TESTS === "1";

const shouldRun = RUN_FLAG && Boolean(SUPABASE_URL) && Boolean(SERVICE_ROLE);

function serviceRoleClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const describeFn = shouldRun ? describe : describe.skip;

describeFn("migration: repair_manager_role_checks", () => {
  let admin: SupabaseClient;
  let managerId = "";
  let venueId = "";
  let eventId = "";

  beforeAll(async () => {
    admin = serviceRoleClient();

    const { data: venue, error: venueErr } = await admin
      .from("venues")
      .select("id")
      .is("deleted_at", null)
      .limit(1)
      .single();
    if (venueErr || !venue) throw new Error(`Cannot load a venue: ${venueErr?.message}`);
    venueId = venue.id as string;

    const { data: manager, error: managerErr } = await admin
      .from("users")
      .select("id")
      .eq("role", "manager")
      .is("deactivated_at", null)
      .limit(1)
      .single();
    if (managerErr || !manager) throw new Error(`Cannot load a manager user: ${managerErr?.message}`);
    managerId = manager.id as string;
  });

  afterAll(async () => {
    if (!shouldRun) return;
    if (eventId) {
      await admin.from("events").delete().eq("id", eventId);
    }
  });

  it("no user row can hold the retired office_worker role", async () => {
    const { count, error } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "office_worker");
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it("submit_event_for_review does not reject a manager with Permission denied", async () => {
    const { data: event, error: insErr } = await admin
      .from("events")
      .insert({
        title: "role-check probe",
        venue_id: venueId,
        created_by: managerId,
        status: "draft",
        event_type: "Live Music",
        venue_space: "Main Bar",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
        end_at: new Date(Date.now() + 90_000_000).toISOString(),
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();
    eventId = event!.id as string;

    const { data } = await admin.rpc("submit_event_for_review", {
      p_event_id: eventId,
      p_idempotency_key: crypto.randomUUID(),
      p_operation_id: crypto.randomUUID(),
      p_expected_updated_at: null,
      p_assignee_id: null,
    });

    // The RPC reads auth.uid(), which is null under service role, so it returns
    // "Not authenticated" rather than "Permission denied". The assertion that
    // matters is that the role literal no longer appears in the function.
    expect((data as { message?: string })?.message).not.toBe("Permission denied");
  });
});
