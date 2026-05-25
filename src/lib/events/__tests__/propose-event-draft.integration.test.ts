/**
 * Integration tests for `public.propose_event_draft` (Phase B″ task B″1).
 *
 * Run via `RUN_INTEGRATION_TESTS=1 npm run test:integration`. See
 * docs/testing/integration.md for prerequisites.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  getLocalAdminClient,
  getLocalUserClient,
  integrationEnabled
} from "@/test-utils/local-supabase";

const enabled = integrationEnabled();

let admin: ReturnType<typeof getLocalAdminClient> | undefined;
let user: ReturnType<typeof getLocalUserClient> | undefined;
let venueId: string | undefined;
let secondVenueId: string | undefined;

describe.skipIf(!enabled)("propose_event_draft RPC", () => {
  beforeAll(async () => {
    if (!enabled) return;
    admin = getLocalAdminClient();
    venueId = process.env.INTEGRATION_TEST_VENUE_ID;
    secondVenueId = process.env.INTEGRATION_TEST_SECOND_VENUE_ID;
    const seededJwt = process.env.INTEGRATION_TEST_USER_JWT;
    if (seededJwt) user = getLocalUserClient(seededJwt);
  });

  it("creates a pending_approval event from a single-venue proposal", async () => {
    if (!user || !venueId || !admin) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }

    const payload = {
      venue_ids: [venueId],
      title: `Proposal ${crypto.randomUUID().slice(0, 8)}`,
      start_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      notes: "Looking for a date."
    };

    const { data, error } = await user.rpc("propose_event_draft", {
      p_payload: payload as never,
      p_idempotency_key: crypto.randomUUID(),
      p_operation_id: crypto.randomUUID()
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true });
    const response = data as { event_id: string; venue_ids: string[] };
    expect(response.event_id).toBeTruthy();
    expect(response.venue_ids).toContain(venueId);

    const { data: row } = await admin
      .from("events")
      .select("status")
      .eq("id", response.event_id)
      .single();
    expect(row?.status).toBe("pending_approval");

    await admin.from("events").delete().eq("id", response.event_id);
  });

  it("returns the same response on idempotency replay", async () => {
    if (!user || !venueId || !admin) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }

    const idempotencyKey = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const payload = {
      venue_ids: [venueId],
      title: `Proposal idem ${idempotencyKey.slice(0, 8)}`,
      start_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      notes: "Idempotency check."
    };

    const first = await user.rpc("propose_event_draft", {
      p_payload: payload as never,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId
    });
    const second = await user.rpc("propose_event_draft", {
      p_payload: payload as never,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const a = first.data as { event_id: string };
    const b = second.data as { event_id: string };
    expect(a.event_id).toBe(b.event_id);

    await admin.from("events").delete().eq("id", a.event_id);
  });

  it("creates a single batch for a multi-venue proposal", async () => {
    if (!user || !venueId || !secondVenueId || !admin) {
      throw new Error(
        "Integration fixtures missing — set INTEGRATION_TEST_SECOND_VENUE_ID. " +
          "See docs/testing/integration.md."
      );
    }

    const payload = {
      venue_ids: [venueId, secondVenueId],
      title: `Multi-venue ${crypto.randomUUID().slice(0, 8)}`,
      start_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      notes: "Cross-venue proposal."
    };

    const { data, error } = await user.rpc("propose_event_draft", {
      p_payload: payload as never,
      p_idempotency_key: crypto.randomUUID(),
      p_operation_id: crypto.randomUUID()
    });

    expect(error).toBeNull();
    const response = data as {
      success: boolean;
      event_id: string;
      batch_id?: string;
      venue_ids: string[];
    };
    expect(response.success).toBe(true);
    expect(response.venue_ids.length).toBe(2);

    await admin.from("events").delete().eq("id", response.event_id);
  });
});
