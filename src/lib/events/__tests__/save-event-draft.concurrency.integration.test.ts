/**
 * Concurrency test for `public.save_event_draft` (Phase C′ task C2).
 *
 * Two simultaneous calls with the same `(idempotency_key, user_id)` must
 * resolve to a single event row — this is the contract idempotency tables
 * exist to enforce. The unit-level idempotency tests cannot exercise true
 * concurrency, so this lives in the integration suite.
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

describe.skipIf(!enabled)("save_event_draft concurrency", () => {
  beforeAll(() => {
    if (!enabled) return;
    admin = getLocalAdminClient();
    venueId = process.env.INTEGRATION_TEST_VENUE_ID;
    const seededJwt = process.env.INTEGRATION_TEST_USER_JWT;
    if (seededJwt) user = getLocalUserClient(seededJwt);
  });

  it("two concurrent saves with the same idempotency_key produce exactly one event row", async () => {
    if (!user || !venueId || !admin) {
      throw new Error("Integration fixtures missing — see docs/testing/integration.md");
    }

    const idempotencyKey = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const payload = {
      venue_id: venueId,
      venue_ids: [venueId],
      artist_ids: [],
      title: `Concurrency ${idempotencyKey.slice(0, 8)}`,
      event_type: "Live Music",
      start_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      end_at: null
    };

    const args = {
      p_payload: payload as never,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId
    };

    const [first, second] = await Promise.all([
      user.rpc("save_event_draft", args),
      user.rpc("save_event_draft", args)
    ]);

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
});
