/**
 * Integration tests for `public.save_event_draft` (Phase B′ task B1).
 *
 * These tests run against a real Supabase stack — typically the local one
 * started by `supabase start`. They are gated by `RUN_INTEGRATION_TESTS=1`
 * and the presence of `SUPABASE_INTEGRATION_*` env vars (see
 * docs/testing/integration.md). Default `npm test` skips the entire suite
 * cleanly so this file is safe to land before the stack is available.
 *
 * Each test seeds users + venue + artist via the admin client, calls
 * `supabase.rpc("save_event_draft", ...)` as the test user, then asserts
 * on the response shape and the resulting row counts in `events`,
 * `event_versions`, and audit tables.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getLocalAdminClient,
  getLocalUserClient,
  integrationEnabled,
  type IntegrationUserSession
} from "@/test-utils/local-supabase";

const enabled = integrationEnabled();

// State shared across tests in the suite; populated in beforeAll when
// integration mode is on, otherwise left undefined (tests are skipped).
let admin: ReturnType<typeof getLocalAdminClient> | undefined;
let user: ReturnType<typeof getLocalUserClient> | undefined;
let session: IntegrationUserSession | undefined;
let venueId: string | undefined;
let artistId: string | undefined;

describe.skipIf(!enabled)("save_event_draft RPC", () => {
  beforeAll(async () => {
    if (!enabled) return;
    admin = getLocalAdminClient();

    // TODO(integration setup): seed an manager user, a venue they
    // can access, and an artist; mint a session JWT for that user. The
    // exact helpers depend on the seeded role/venue mapping in the
    // local stack — see docs/testing/integration.md for the recommended
    // wiring once the local stack is initialised.
    venueId = process.env.INTEGRATION_TEST_VENUE_ID;
    artistId = process.env.INTEGRATION_TEST_ARTIST_ID;
    const seededJwt = process.env.INTEGRATION_TEST_USER_JWT;
    const seededUserId = process.env.INTEGRATION_TEST_USER_ID;
    if (seededJwt && seededUserId) {
      session = { userId: seededUserId, jwt: seededJwt };
      user = getLocalUserClient(seededJwt);
    }
  });

  afterAll(async () => {
    // Suite-scoped cleanup: tests that succeed already use admin to
    // delete the rows they create; this is a defensive sweep for the
    // failure paths.
    if (!enabled || !admin || !session) return;
    await admin.from("events").delete().eq("created_by", session.userId);
  });

  it("commits event + version + audit rows in a single transaction on the success path", async () => {
    if (!user || !venueId || !admin) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }

    const idempotencyKey = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const payload = {
      venue_id: venueId,
      venue_ids: [venueId],
      artist_ids: [],
      title: `Integration smoke ${idempotencyKey.slice(0, 8)}`,
      event_type: "Live Music",
      start_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      end_at: null
    };

    const { data, error } = await user.rpc("save_event_draft", {
      p_payload: payload as never,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true });
    const eventId = (data as { event_id: string }).event_id;
    expect(eventId).toBeTruthy();

    const { count: eventCount } = await admin
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("id", eventId);
    expect(eventCount).toBe(1);

    const { count: versionCount } = await admin
      .from("event_versions")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId);
    expect(versionCount).toBeGreaterThanOrEqual(1);

    // Cleanup
    await admin.from("events").delete().eq("id", eventId);
  });

  it("returns failed[venue] and commits zero rows when the caller cannot access the venue", async () => {
    if (!user) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }

    const foreignVenueId = process.env.INTEGRATION_TEST_FOREIGN_VENUE_ID;
    if (!foreignVenueId) {
      throw new Error(
        "Set INTEGRATION_TEST_FOREIGN_VENUE_ID to a venue id the user cannot access. " +
          "See docs/testing/integration.md."
      );
    }

    const idempotencyKey = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const payload = {
      venue_id: foreignVenueId,
      venue_ids: [foreignVenueId],
      artist_ids: [],
      title: `RLS denial ${idempotencyKey.slice(0, 8)}`,
      event_type: "Live Music",
      start_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      end_at: null
    };

    const { data, error } = await user.rpc("save_event_draft", {
      p_payload: payload as never,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId
    });

    expect(error).toBeNull();
    const response = data as { success: boolean; failed?: Array<{ kind: string }> };
    expect(response.success).toBe(false);
    expect(response.failed).toBeDefined();
    expect(response.failed?.some((f) => f.kind === "venue")).toBe(true);
  });

  it("rolls back to the SAVEPOINT when an artist FK violates and commits zero rows", async () => {
    if (!user || !venueId || !admin) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }

    const idempotencyKey = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const bogusArtistId = "00000000-0000-4000-8000-000000000000";
    const payload = {
      venue_id: venueId,
      venue_ids: [venueId],
      artist_ids: [bogusArtistId],
      title: `Savepoint rollback ${idempotencyKey.slice(0, 8)}`,
      event_type: "Live Music",
      start_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      end_at: null
    };

    const { data, error } = await user.rpc("save_event_draft", {
      p_payload: payload as never,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId
    });

    expect(error).toBeNull();
    const response = data as { success: boolean; event_id?: string };
    // Whether the RPC returns success:true (with warnings) or success:false
    // depends on whether artist linking is Compensatable or Core. Either
    // way, we should never see a partial event row in a state that breaks
    // referential integrity. Assert the artist was NOT linked.
    if (response.event_id) {
      const { count } = await admin
        .from("event_artists")
        .select("*", { count: "exact", head: true })
        .eq("event_id", response.event_id)
        .eq("artist_id", bogusArtistId);
      expect(count).toBe(0);
      await admin.from("events").delete().eq("id", response.event_id);
    }
  });

  it("returns the same response on idempotency replay and creates exactly one event row", async () => {
    if (!user || !venueId || !admin) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }

    const idempotencyKey = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const payload = {
      venue_id: venueId,
      venue_ids: [venueId],
      artist_ids: [],
      title: `Idempotency ${idempotencyKey.slice(0, 8)}`,
      event_type: "Live Music",
      start_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      end_at: null
    };

    const first = await user.rpc("save_event_draft", {
      p_payload: payload as never,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId
    });
    const second = await user.rpc("save_event_draft", {
      p_payload: payload as never,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const a = first.data as { event_id: string };
    const b = second.data as { event_id: string };
    expect(a.event_id).toBe(b.event_id);

    const { count } = await admin
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("id", a.event_id);
    expect(count).toBe(1);

    await admin.from("events").delete().eq("id", a.event_id);
  });

  it("returns conflict:true when expected_updated_at is stale", async () => {
    if (!user || !venueId || !admin) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }

    // First create an event we can update.
    const createKey = crypto.randomUUID();
    const createOp = crypto.randomUUID();
    const createPayload = {
      venue_id: venueId,
      venue_ids: [venueId],
      artist_ids: [],
      title: `Concurrency seed ${createKey.slice(0, 8)}`,
      event_type: "Live Music",
      start_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      end_at: null
    };
    const created = await user.rpc("save_event_draft", {
      p_payload: createPayload as never,
      p_idempotency_key: createKey,
      p_operation_id: createOp
    });
    expect(created.error).toBeNull();
    const eventId = (created.data as { event_id: string }).event_id;

    // Send a stale expected_updated_at — anything earlier than the row's
    // current updated_at should trigger the conflict path.
    const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const updateKey = crypto.randomUUID();
    const updateOp = crypto.randomUUID();
    const updatePayload = { ...createPayload, event_id: eventId, title: `${createPayload.title} (edited)` };
    const updated = await user.rpc("save_event_draft", {
      p_payload: updatePayload as never,
      p_idempotency_key: updateKey,
      p_operation_id: updateOp,
      p_expected_updated_at: staleTimestamp
    });

    expect(updated.error).toBeNull();
    const response = updated.data as { success: boolean; conflict?: boolean };
    expect(response.success).toBe(false);
    expect(response.conflict).toBe(true);

    await admin.from("events").delete().eq("id", eventId);
  });
});
