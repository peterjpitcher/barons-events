import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before the SUT import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn(),
  createSupabaseActionClient: vi.fn(),
}));

import { listShortLinks, deleteShortLink, createShortLink } from "@/lib/links-server";
import {
  insertShortLinkWithUniqueCode,
  isUniqueViolation,
  ShortLinkInsertError,
  generateShortLinkCode,
} from "@/lib/short-link-codes";
import { createSupabaseReadonlyClient, createSupabaseActionClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const mockReadonly = vi.mocked(createSupabaseReadonlyClient);
const mockAction = vi.mocked(createSupabaseActionClient);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(i: number) {
  return {
    id: `id-${String(i).padStart(5, "0")}`,
    code: i.toString(16).padStart(8, "0"),
    name: `Link ${i}`,
    destination: "https://baronspubs.com/x",
    link_type: "general",
    clicks: 0,
    expires_at: null,
    created_by: null,
    created_at: "2026-06-01T00:00:00+00:00",
    updated_at: "2026-06-01T00:00:00+00:00",
    parent_link_id: null,
    touchpoint: null,
  };
}

/**
 * Cap-aware mock client for pagination tests (mirrors the weekly-digest
 * pagination test style): awaiting WITH .range(from, to) resolves
 * rows.slice(from, to + 1); every chained call is recorded for assertions.
 */
function setupPagedClient(rows: unknown[], error: unknown = null) {
  const calls: { method: string; args: unknown[] }[] = [];

  function makeChain() {
    let range: [number, number] | null = null;
    const chain: Record<string, unknown> = {
      range(from: number, to: number) {
        calls.push({ method: "range", args: [from, to] });
        range = [from, to];
        return chain;
      },
      then(resolve: (v: unknown) => void) {
        const data = error ? null : range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000);
        resolve({ data, error });
      },
    };
    for (const method of ["select", "eq", "order", "limit", "maybeSingle", "single"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      };
    }
    return chain;
  }

  const client = { from: vi.fn(() => makeChain()) };
  mockReadonly.mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createSupabaseReadonlyClient>>);
  return { client, calls };
}

// ---------------------------------------------------------------------------
// listShortLinks — pagination past the PostgREST 1000-row cap (D001/T077)
// ---------------------------------------------------------------------------

describe("listShortLinks", () => {
  it("should return every row past the 1000-row cap (T077/D001 — 1000 + 1 boundary)", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => makeRow(i));
    const { calls } = setupPagedClient(rows);

    const result = await listShortLinks();

    expect(result).toHaveLength(1001);
    expect(result[1000]).toEqual(makeRow(1000));
    const rangeCalls = calls.filter((c) => c.method === "range").map((c) => c.args);
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("should page a second time when the result exactly fills the first page (1000)", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => makeRow(i));
    const { calls } = setupPagedClient(rows);

    const result = await listShortLinks();

    expect(result).toHaveLength(1000);
    expect(calls.filter((c) => c.method === "range")).toHaveLength(2);
  });

  it("should issue a single page for short results", async () => {
    const { calls } = setupPagedClient([makeRow(1), makeRow(2)]);

    const result = await listShortLinks();

    expect(result).toHaveLength(2);
    expect(calls.filter((c) => c.method === "range")).toHaveLength(1);
  });

  it("should order by created_at desc with an id tiebreak so range paging is stable", async () => {
    const { calls } = setupPagedClient([makeRow(1)]);

    await listShortLinks();

    const orderCalls = calls.filter((c) => c.method === "order").map((c) => c.args);
    expect(orderCalls).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("should throw on query errors", async () => {
    setupPagedClient([], { message: "boom" });
    await expect(listShortLinks()).rejects.toThrow("listShortLinks: boom");
  });
});

// ---------------------------------------------------------------------------
// insertShortLinkWithUniqueCode — insert-first generator (D006/T079, L-5)
// ---------------------------------------------------------------------------

type InsertResult = { data: unknown; error: { message: string; code?: string } | null };

function makeInsertClient(results: InsertResult[]) {
  let call = 0;
  const insertedRows: Array<Record<string, unknown>> = [];
  const client = {
    from: vi.fn(() => ({
      insert: vi.fn((row: Record<string, unknown>) => {
        insertedRows.push(row);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => results[Math.min(call++, results.length - 1)]),
          })),
        };
      }),
    })),
  };
  return { client: client as unknown as SupabaseClient, insertedRows };
}

const baseRow = {
  name: "Menu",
  destination: "https://baronspubs.com/menu",
  link_type: "menu" as const,
  expires_at: null,
  created_by: "user-1",
};

const codeCollision = {
  data: null,
  error: { message: 'duplicate key value violates unique constraint "short_links_code_unique"', code: "23505" },
};

describe("insertShortLinkWithUniqueCode", () => {
  it("should insert first time without any availability pre-check", async () => {
    const { client, insertedRows } = makeInsertClient([{ data: makeRow(1), error: null }]);

    const link = await insertShortLinkWithUniqueCode(client, baseRow);

    expect(link.id).toBe("id-00001");
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].code).toMatch(/^[0-9a-f]{8}$/);
    expect(insertedRows[0]).toMatchObject({ parent_link_id: null, touchpoint: null });
  });

  it("should retry with a fresh code on a code-unique collision (T079/D006)", async () => {
    const { client, insertedRows } = makeInsertClient([
      codeCollision,
      codeCollision,
      { data: makeRow(3), error: null },
    ]);

    const link = await insertShortLinkWithUniqueCode(client, baseRow);

    expect(link.id).toBe("id-00003");
    expect(insertedRows).toHaveLength(3);
    const codes = insertedRows.map((r) => r.code);
    expect(new Set(codes).size).toBe(3); // a fresh code per attempt
  });

  it("should give up after 5 code collisions with a clear error", async () => {
    const { client, insertedRows } = makeInsertClient([codeCollision]);

    await expect(insertShortLinkWithUniqueCode(client, baseRow)).rejects.toThrow(
      /unique link code after 5 attempts/,
    );
    expect(insertedRows).toHaveLength(5);
  });

  it("should propagate a (parent, touchpoint) unique violation immediately without retrying (D005 backstop)", async () => {
    const { client, insertedRows } = makeInsertClient([
      {
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint "short_links_parent_touchpoint_uniq"',
          code: "23505",
        },
      },
    ]);

    const promise = insertShortLinkWithUniqueCode(client, {
      ...baseRow,
      parent_link_id: "p1",
      touchpoint: "poster",
    });
    await expect(promise).rejects.toSatisfy(
      (error: unknown) => error instanceof ShortLinkInsertError && isUniqueViolation(error),
    );
    expect(insertedRows).toHaveLength(1);
  });

  it("should propagate non-collision errors immediately — never swallowed, never retried (L-5)", async () => {
    const { client, insertedRows } = makeInsertClient([
      { data: null, error: { message: "permission denied for table short_links", code: "42501" } },
    ]);

    await expect(insertShortLinkWithUniqueCode(client, baseRow)).rejects.toThrow(/permission denied/);
    expect(insertedRows).toHaveLength(1);
  });

  it("isUniqueViolation should be false for non-23505 failures", () => {
    expect(isUniqueViolation(new ShortLinkInsertError("x", "42501"))).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
  });

  it("generateShortLinkCode should produce 8 lowercase hex chars", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateShortLinkCode()).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// createShortLink — passes FK fields through the generator
// ---------------------------------------------------------------------------

describe("createShortLink", () => {
  it("should pass parent_link_id and touchpoint through to the insert", async () => {
    const { client, insertedRows } = makeInsertClient([{ data: makeRow(7), error: null }]);
    mockAction.mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createSupabaseActionClient>>);

    await createShortLink({
      name: "Menu — Poster",
      destination: "https://baronspubs.com/menu?utm_source=poster",
      link_type: "menu",
      expires_at: null,
      created_by: "user-1",
      parent_link_id: "p1",
      touchpoint: "poster",
    });

    expect(insertedRows[0]).toMatchObject({ parent_link_id: "p1", touchpoint: "poster" });
  });
});

// ---------------------------------------------------------------------------
// deleteShortLink — must report 0-row deletes (Flow 5, L-6)
// ---------------------------------------------------------------------------

function setupDeleteClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ select }));
  const del = vi.fn(() => ({ eq }));
  const client = { from: vi.fn(() => ({ delete: del })) };
  mockAction.mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createSupabaseActionClient>>);
  return { select };
}

describe("deleteShortLink", () => {
  it("should return the deleted row", async () => {
    const { select } = setupDeleteClient({ data: { id: "id-1", name: "Menu", code: "abcd1234" }, error: null });

    const deleted = await deleteShortLink("id-1");

    expect(deleted).toEqual({ id: "id-1", name: "Menu", code: "abcd1234" });
    expect(select).toHaveBeenCalledWith("id, name, code");
  });

  it("should return null when no row was deleted (previously a false success + false audit)", async () => {
    setupDeleteClient({ data: null, error: null });

    expect(await deleteShortLink("missing")).toBeNull();
  });

  it("should throw on delete errors", async () => {
    setupDeleteClient({ data: null, error: { message: "boom" } });

    await expect(deleteShortLink("id-1")).rejects.toThrow("deleteShortLink: boom");
  });
});
