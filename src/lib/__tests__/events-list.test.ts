import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn()
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn()
}));
vi.mock("server-only", () => ({}));

import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { listEventsForUser } from "../events";
import type { AppUser } from "@/lib/types";

const mockReadonlyClient = createSupabaseReadonlyClient as ReturnType<typeof vi.fn>;

const officeWorker: AppUser = {
  id: "user-2",
  email: "worker@example.com",
  fullName: "Office Worker",
  role: "office_worker",
  venueId: "venue-abc",
  deactivatedAt: null
};

function buildQueryMock(resolveValue: { data: unknown[]; error: null | { message: string } }) {
  const calls: { method: string; args: unknown[] }[] = [];

  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: typeof resolveValue) => void) => resolve(resolveValue);
        }

        return (...args: unknown[]) => {
          calls.push({ method: prop as string, args });
          return proxy;
        };
      }
    }
  );

  return { proxy, calls };
}

describe("listEventsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not venue-scope office_worker event reads", async () => {
    const { proxy, calls } = buildQueryMock({ data: [], error: null });
    mockReadonlyClient.mockResolvedValue({
      from: () => proxy
    });

    await listEventsForUser(officeWorker);

    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "select" }),
        expect.objectContaining({ method: "is", args: ["deleted_at", null] }),
        expect.objectContaining({ method: "order", args: ["start_at", { ascending: true }] })
      ])
    );
    expect(calls.find((call) => call.method === "eq" && call.args[0] === "venue_id")).toBeUndefined();
  });
});
