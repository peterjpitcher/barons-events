/**
 * Integration tests for `public.submit_event_for_review` (Phase B′ task B2).
 *
 * Run via `RUN_INTEGRATION_TESTS=1 npm run test:integration` against a real
 * Supabase stack. See docs/testing/integration.md for prerequisites.
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

async function seedDraft(): Promise<{ eventId: string; updatedAt: string }> {
  if (!user || !venueId) {
    throw new Error("Integration fixtures missing — see docs/testing/integration.md");
  }
  const payload = {
    venue_id: venueId,
    venue_ids: [venueId],
    artist_ids: [],
    title: `Submit fixture ${crypto.randomUUID().slice(0, 8)}`,
    event_type: "Live Music",
    start_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    end_at: null,
    public_title: "Public title",
    public_description: "Public description",
    public_teaser: "Teaser"
  };
  const result = await user.rpc("save_event_draft", {
    p_payload: payload as never,
    p_idempotency_key: crypto.randomUUID(),
    p_operation_id: crypto.randomUUID()
  });
  if (result.error) throw result.error;
  const data = result.data as { event_id: string; updated_at: string };
  return { eventId: data.event_id, updatedAt: data.updated_at };
}

describe.skipIf(!enabled)("submit_event_for_review RPC", () => {
  beforeAll(async () => {
    if (!enabled) return;
    admin = getLocalAdminClient();
    venueId = process.env.INTEGRATION_TEST_VENUE_ID;
    const seededJwt = process.env.INTEGRATION_TEST_USER_JWT;
    if (seededJwt) user = getLocalUserClient(seededJwt);
  });

  it("transitions an eligible draft to submitted and returns success", async () => {
    if (!user || !admin) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }
    const { eventId, updatedAt } = await seedDraft();

    const { data, error } = await user.rpc("submit_event_for_review", {
      p_event_id: eventId,
      p_idempotency_key: crypto.randomUUID(),
      p_operation_id: crypto.randomUUID(),
      p_expected_updated_at: updatedAt
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true });

    const { data: row } = await admin
      .from("events")
      .select("status")
      .eq("id", eventId)
      .single();
    expect(row?.status === "submitted" || row?.status === "pending_approval").toBe(true);

    await admin.from("events").delete().eq("id", eventId);
  });

  it("returns conflict:true when expected_updated_at is stale", async () => {
    if (!user || !admin) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }
    const { eventId } = await seedDraft();

    const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await user.rpc("submit_event_for_review", {
      p_event_id: eventId,
      p_idempotency_key: crypto.randomUUID(),
      p_operation_id: crypto.randomUUID(),
      p_expected_updated_at: staleTimestamp
    });

    expect(error).toBeNull();
    const response = data as { success: boolean; conflict?: boolean };
    expect(response.success).toBe(false);
    expect(response.conflict).toBe(true);

    await admin.from("events").delete().eq("id", eventId);
  });

  it("returns the same response on idempotency replay", async () => {
    if (!user || !admin) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }
    const { eventId, updatedAt } = await seedDraft();

    const idempotencyKey = crypto.randomUUID();
    const operationId = crypto.randomUUID();

    const first = await user.rpc("submit_event_for_review", {
      p_event_id: eventId,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId,
      p_expected_updated_at: updatedAt
    });
    const second = await user.rpc("submit_event_for_review", {
      p_event_id: eventId,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId,
      p_expected_updated_at: updatedAt
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect((first.data as { success: boolean }).success).toBe(true);
    expect((second.data as { success: boolean }).success).toBe(true);
    expect((first.data as { event_id: string }).event_id).toBe(
      (second.data as { event_id: string }).event_id
    );

    await admin.from("events").delete().eq("id", eventId);
  });
});
