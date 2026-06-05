import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260605103000_backfill_event_sop_planning_items.sql"),
  "utf8"
);

describe("event SOP backfill migration", () => {
  it("creates missing event-linked planning items without touching existing links", () => {
    expect(migration).toContain("not exists (\n      select 1\n      from public.planning_items pi\n      where pi.event_id = e.id");
    expect(migration).toContain("insert into public.planning_items");
    expect(migration).toContain("'Event'");
    expect(migration).toContain("'planned'");
    expect(migration).toContain("'planning.item_created'");
  });

  it("preserves event/planning venue links and event timing", () => {
    expect(migration).toContain("start_at = coalesce(pi.start_at, e.start_at)");
    expect(migration).toContain("end_at = coalesce(pi.end_at, e.end_at)");
    expect(migration).toContain("insert into public.planning_item_venues");
    expect(migration).toContain("join public.event_venues ev on ev.event_id = pi.event_id");
    expect(migration).toContain("on conflict do nothing");
  });

  it("generates missing SOP tasks and skips already-generated checklists", () => {
    expect(migration).toContain("public.generate_sop_checklist_v2");
    expect(migration).toContain("and pt.sop_template_task_id is not null");
    expect(migration).toContain("_event_sop_backfill_generation_results");
  });

  it("marks stale event SOP work as not required except debrief", () => {
    expect(migration).toContain("pi.event_id is not null");
    expect(migration).toContain("pi.target_date < current_date");
    expect(migration).toContain("status = 'not_required'");
    expect(migration).toContain("stt.template_key = 'debrief'");
    expect(migration).toContain("'sop_backfill_completed'");
  });
});
