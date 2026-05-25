import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn()
}));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDashboardTodoItems } from "@/lib/dashboard";

const mockCreateSupabaseAdminClient = vi.mocked(createSupabaseAdminClient);

function setupDb(results: Record<string, Array<{ data: unknown[]; error: unknown }>>) {
  const selects: Record<string, string[]> = {};
  const calls: Record<string, number> = {};

  function makeChain(table: string, result: { data: unknown[]; error: unknown }) {
    const chain: any = {
      select: vi.fn((columns: string) => {
        selects[table] = selects[table] ?? [];
        selects[table].push(columns);
        return chain;
      }),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      or: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      then: (resolve: (value: { data: unknown[]; error: unknown }) => void) => resolve(result)
    };
    return chain;
  }

  const db = {
    from: vi.fn((table: string) => {
      const index = calls[table] ?? 0;
      calls[table] = index + 1;
      return makeChain(table, results[table]?.[index] ?? { data: [], error: null });
    })
  };

  mockCreateSupabaseAdminClient.mockReturnValue(db as any);
  return { selects };
}

describe("getDashboardTodoItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads multi-assignee planning tasks with an explicit planning venue join", async () => {
    const { selects } = setupDb({
      planning_task_assignees: [
        {
          error: null,
          data: [
            {
              user_id: "user-1",
              planning_tasks: {
                id: "task-1",
                title: "Book staff room",
                assignee_id: "user-2",
                due_date: "2026-05-25",
                status: "open",
                sop_section: null,
                sop_template_task_id: null,
                planning_item_id: "pi-1",
                planning_items: {
                  id: "pi-1",
                  title: "Staff day",
                  owner_id: "user-2",
                  venue_id: "venue-internal",
                  venue: { name: "Internal" }
                }
              }
            }
          ]
        }
      ],
      planning_tasks: [{ data: [], error: null }],
      events: [
        { data: [], error: null },
        { data: [], error: null }
      ]
    });

    const result = await getDashboardTodoItems(
      {
        id: "user-1",
        email: "user@example.com",
        fullName: "User",
        role: "office_worker",
        venueId: null,
        deactivatedAt: null
      },
      "2026-05-25"
    );

    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: "Book staff room",
      venueName: "Internal",
      planningTaskId: "task-1"
    });
    expect(selects.planning_task_assignees[0]).toContain("venue:venues!planning_items_venue_id_fkey");
  });

  it("uses explicit event venue joins for review, revision, and debrief todos", async () => {
    const { selects } = setupDb({
      planning_task_assignees: [{ data: [], error: null }],
      planning_tasks: [{ data: [], error: null }],
      events: [
        {
          error: null,
          data: [
            {
              id: "event-1",
              title: "Submitted event",
              start_at: "2026-05-26T12:00:00Z",
              venue_id: "venue-1",
              venue: { name: "The Duke" }
            }
          ]
        },
        { data: [], error: null },
        { data: [], error: null }
      ]
    });

    const result = await getDashboardTodoItems(
      {
        id: "admin-1",
        email: "admin@example.com",
        fullName: "Admin",
        role: "administrator",
        venueId: null,
        deactivatedAt: null
      },
      "2026-05-25"
    );

    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ source: "review", venueName: "The Duke" });
    expect(selects.events.every((select) => select.includes("venue:venues!events_venue_id_fkey"))).toBe(true);
  });
});
