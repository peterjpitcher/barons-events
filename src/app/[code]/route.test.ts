import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before the SUT import
// ---------------------------------------------------------------------------

// Capture after() callbacks so tests can assert WHEN the click increment is
// queued and flush it deliberately.
const { afterCallbacks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void> | void>,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((cb: () => Promise<void> | void) => {
      afterCallbacks.push(cb);
    }),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { GET } from "./route";

const mockAdmin = vi.mocked(createSupabaseAdminClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LinkRow = { id: string; destination: string; expires_at: string | null };

function setupDb(opts: { link?: LinkRow | null; lookupError?: { message: string } | null; rpcError?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null });
  const maybeSingle = vi.fn(async () => ({ data: opts.link ?? null, error: opts.lookupError ?? null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  mockAdmin.mockReturnValue({ from, rpc } as unknown as ReturnType<typeof createSupabaseAdminClient>);
  return { rpc };
}

function makeRequest(path: string, host = "l.baronspubs.com"): NextRequest {
  return new NextRequest(`https://${host}${path}`, { headers: { host } });
}

function call(code: string, opts: { path?: string; host?: string } = {}) {
  return GET(makeRequest(opts.path ?? `/${code}`, opts.host), {
    params: Promise.resolve({ code }),
  });
}

async function flushAfterCallbacks(): Promise<void> {
  for (const cb of afterCallbacks) await cb();
}

const activeLink: LinkRow = {
  id: "link-1",
  destination: "https://baronspubs.com/menu",
  expires_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Status discipline + branded error pages (T093-T097, L-8)
// ---------------------------------------------------------------------------

describe("GET /[code] — status discipline", () => {
  it("should 404 on the wrong host with a branded HTML page (T097)", async () => {
    setupDb({ link: activeLink });

    const res = await call("abcd1234", { host: "baronshub.example.com" });

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Barons Pubs");
    expect(html).toContain("https://baronspubs.com");
  });

  it("should 404 on malformed codes without touching the database", async () => {
    const { rpc } = setupDb({ link: activeLink });

    const res = await call("ZZZZ9999");

    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("should 404 for unknown codes without counting a click (T093)", async () => {
    const { rpc } = setupDb({ link: null });

    const res = await call("abcd1234");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(afterCallbacks).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("should 503 (not 404) when the lookup itself fails (T096)", async () => {
    setupDb({ lookupError: { message: "connection refused" } });

    const res = await call("abcd1234");

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(afterCallbacks).toHaveLength(0);
  });

  it("should 502 on a malformed destination WITHOUT counting a click (T095/D011)", async () => {
    const { rpc } = setupDb({ link: { ...activeLink, destination: "not a url" } });

    const res = await call("abcd1234");

    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toContain("text/html");
    // The increment must never be queued on failure paths.
    expect(afterCallbacks).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Expiry — Europe/London end-of-day (T048/T051/T094, D008)
// ---------------------------------------------------------------------------

describe("GET /[code] — expiry", () => {
  it("should still redirect at 23:59 UK on the expiry day during BST (T048)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T22:59:00Z")); // 23:59 UK
    setupDb({ link: { ...activeLink, expires_at: "2026-06-11T00:00:00+00:00" } });

    const res = await call("abcd1234");

    expect(res.status).toBe(302);
  });

  it("should 410 at 00:30 UK the NEXT day during BST — no 1-hour spillover (T051/D008)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T23:30:00Z")); // 00:30 UK on 12 Jun
    const { rpc } = setupDb({ link: { ...activeLink, expires_at: "2026-06-11T00:00:00+00:00" } });

    const res = await call("abcd1234");

    expect(res.status).toBe(410);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("expired");
    // Expired visits must not count clicks.
    expect(afterCallbacks).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("should 410 for yesterday's expiry (T049/T094)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));
    setupDb({ link: { ...activeLink, expires_at: "2026-06-10T00:00:00+00:00" } });

    expect((await call("abcd1234")).status).toBe(410);
  });
});

// ---------------------------------------------------------------------------
// Happy path — redirect, utm forwarding, click counting via after()
// (T008/T009/T010/T114, D011)
// ---------------------------------------------------------------------------

describe("GET /[code] — redirect and click counting", () => {
  it("should 302 to the destination and count the click via after() (T008/T010)", async () => {
    const { rpc } = setupDb({ link: activeLink });

    const res = await call("abcd1234");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://baronspubs.com/menu");

    // Queued inside after(), not fire-and-forget — and only after success.
    expect(afterCallbacks).toHaveLength(1);
    expect(rpc).not.toHaveBeenCalled(); // not yet run
    await flushAfterCallbacks();
    expect(rpc).toHaveBeenCalledWith("increment_link_clicks", { p_code: "abcd1234" });
  });

  it("should log (not throw) when the click RPC fails (T114)", async () => {
    setupDb({ link: activeLink, rpcError: { message: "rpc down" } });

    const res = await call("abcd1234");

    expect(res.status).toBe(302);
    await flushAfterCallbacks();
    expect(console.error).toHaveBeenCalledWith("increment_link_clicks failed:", { message: "rpc down" });
  });

  it("should forward utm_* params to the destination, overriding duplicates, and drop non-utm params (T009)", async () => {
    setupDb({ link: { ...activeLink, destination: "https://baronspubs.com/menu?utm_source=old&keep=1" } });

    const res = await call("abcd1234", { path: "/abcd1234?utm_source=qr&utm_medium=print&foo=bar" });

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("utm_source")).toBe("qr");
    expect(location.searchParams.get("utm_medium")).toBe("print");
    expect(location.searchParams.get("keep")).toBe("1"); // pre-existing destination params survive
    expect(location.searchParams.get("foo")).toBeNull(); // request params that aren't utm_* are dropped
  });
});
