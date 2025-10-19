import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/ai-dispatch/route";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/cron/auth", () => ({
  validateCronRequest: vi.fn(() => null),
}));

vi.mock("@/lib/cron/alert", () => ({
  reportCronFailure: vi.fn(),
}));

const createSupabaseServiceRoleClient = vi.mocked(
  (await import("@/lib/supabase/server")).createSupabaseServiceRoleClient
);
const validateCronRequest = vi.mocked(
  (await import("@/lib/cron/auth")).validateCronRequest
);
const reportCronFailure = vi.mocked(
  (await import("@/lib/cron/alert")).reportCronFailure
);

const supabaseMock = {
  from: vi.fn<(table: string) => unknown>(),
};
const updateCalls: Array<{ payload: unknown; id: string }> = [];

const buildRequest = (authorized: boolean) =>
  new Request("https://example.com/api/cron/ai-dispatch", {
    headers: authorized ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
  });

beforeEach(() => {
  process.env.CRON_SECRET = "secret";
  delete process.env.AI_PUBLISH_WEBHOOK_URL;
  delete process.env.AI_PUBLISH_WEBHOOK_TOKEN;
  validateCronRequest.mockImplementation((request: Request) => {
    const header = request.headers.get("authorization");
    return header === `Bearer ${process.env.CRON_SECRET}` ? null : new Response(null, { status: 401 });
  });
  supabaseMock.from.mockReset();
  updateCalls.length = 0;
  reportCronFailure.mockReset();
  createSupabaseServiceRoleClient.mockReturnValue(supabaseMock as never);
});

describe("GET /api/cron/ai-dispatch", () => {
  it("rejects unauthorized requests", async () => {
    const response = await GET(buildRequest(false));

    expect(response.status).toBe(401);
  });

  it("marks pending items as dispatched", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "ai_publish_queue") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  data: [
                    {
                      id: "queue-1",
                      event_id: "event-1",
                      content_id: "content-1",
                      payload: {},
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
          update: (payload: unknown) => ({
            eq: (_column: string, value: string) => {
              updateCalls.push({ payload, id: value });
              return Promise.resolve({ error: null });
            },
          }),
        } as never;
      }
      return {} as never;
    });

    const response = await GET(buildRequest(true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 1, dispatched: 1, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([
      {
        id: "queue-1",
        payload: expect.objectContaining({
          status: "dispatched",
          dispatched_at: expect.any(String),
        }),
      },
    ]);

    fetchSpy.mockRestore();
  });

  it("posts payloads to webhook before marking dispatched", async () => {
    process.env.AI_PUBLISH_WEBHOOK_URL = "https://example.com/ai-webhook";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "ai_publish_queue") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  data: [
                    {
                      id: "queue-1",
                      event_id: "event-1",
                      content_id: "content-1",
                      payload: { version: 4, synopsis: "Syn", heroCopy: "Hero" },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
          update: (payload: unknown) => ({
            eq: (_column: string, value: string) => {
              updateCalls.push({ payload, id: value });
              return Promise.resolve({ error: null });
            },
          }),
        } as never;
      }
      return {} as never;
    });

    const response = await GET(buildRequest(true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 1, dispatched: 1, failed: 0 });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/ai-webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
    const fetchArgs = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(fetchArgs?.body).toBeDefined();
    const parsedBody = JSON.parse(String(fetchArgs?.body));
    expect(parsedBody).toMatchObject({
      contentId: "content-1",
      eventId: "event-1",
    });
    expect(updateCalls[0]).toEqual({
      id: "queue-1",
      payload: expect.objectContaining({
        status: "dispatched",
        dispatched_at: expect.any(String),
      }),
    });
    expect(reportCronFailure).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("marks queue item as failed when webhook rejects", async () => {
    process.env.AI_PUBLISH_WEBHOOK_URL = "https://example.com/ai-webhook";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("fail", { status: 500 }));

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "ai_publish_queue") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  data: [
                    {
                      id: "queue-1",
                      event_id: "event-1",
                      content_id: "content-1",
                      payload: { version: 4 },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
          update: (payload: unknown) => ({
            eq: (_column: string, value: string) => {
              updateCalls.push({ payload, id: value });
              return Promise.resolve({ error: null });
            },
          }),
        } as never;
      }
      return {} as never;
    });

    const response = await GET(buildRequest(true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 1, dispatched: 0, failed: 1 });
    expect(fetchSpy).toHaveBeenCalled();
    expect(updateCalls).toEqual([
      {
        id: "queue-1",
        payload: expect.objectContaining({
          status: "failed",
        }),
      },
    ]);
    expect(reportCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        job: "ai-dispatch",
        message: "AI publish dispatch webhook failed",
      })
    );

    fetchSpy.mockRestore();
  });

  it("reports failure when queue lookup fails", async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "ai_publish_queue") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  data: null,
                  error: { message: "select failed" },
                }),
              }),
            }),
          }),
        } as never;
      }
      return {} as never;
    });

    const response = await GET(buildRequest(true));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "select failed" });
    expect(reportCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        job: "ai-dispatch",
        message: "Failed to fetch pending AI publish queue items",
      })
    );
  });

  it("reports when marking dispatched fails", async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "ai_publish_queue") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  data: [
                    {
                      id: "queue-1",
                      event_id: "event-1",
                      content_id: "content-1",
                      payload: {},
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () =>
              Promise.resolve({
                error: { message: "update failed" },
              }),
          }),
        } as never;
      }
      return {} as never;
    });

    const response = await GET(buildRequest(true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 1, dispatched: 0, failed: 1 });
    expect(reportCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        job: "ai-dispatch",
        message: "Failed to update AI publish queue status to dispatched",
      })
    );
  });
});
