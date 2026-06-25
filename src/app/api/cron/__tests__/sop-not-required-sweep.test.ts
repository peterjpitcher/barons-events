import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cron-auth", () => ({ verifyCronSecret: vi.fn() }));
vi.mock("@/lib/datetime", () => ({ getTodayLondonIsoDate: vi.fn(() => "2026-06-25") }));
vi.mock("@/lib/planning/sop", () => ({ markPastEventOpenTodosNotRequired: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({
  recordSystemAuditLogEntry: vi.fn(),
}));

import { verifyCronSecret } from "@/lib/cron-auth";
import { recordSystemAuditLogEntry } from "@/lib/audit-log";
import { markPastEventOpenTodosNotRequired } from "@/lib/planning/sop";
import { GET } from "../sop-not-required-sweep/route";

describe("sop-not-required-sweep cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyCronSecret).mockReturnValue(true);
    vi.mocked(markPastEventOpenTodosNotRequired).mockResolvedValue({
      processed: 1,
      nowIso: "2026-06-25T12:00:00.000Z",
      tasks: [
        {
          id: "task-1",
          planningItemId: "planning-1",
          eventId: "event-1",
          reason: "event_passed",
        },
      ],
    });
  });

  it("records auto-not-required task changes with the system audit helper", async () => {
    const response = await GET(new Request("https://example.test/api/cron/sop-not-required-sweep", {
      headers: { authorization: "Bearer test" },
    }));

    expect(response.status).toBe(200);
    expect(recordSystemAuditLogEntry).toHaveBeenCalledWith({
      entity: "planning_task",
      entityId: "task-1",
      action: "planning_task.auto_not_required",
      actorId: null,
      meta: {
        planning_item_id: "planning-1",
        event_id: "event-1",
        reason: "event_passed",
        today: "2026-06-25",
      },
    });
  });
});
