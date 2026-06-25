import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260625201000_allow_incomplete_reverted_drafts.sql"),
  "utf8"
);

describe("allow incomplete reverted drafts migration", () => {
  it("allows draft rows to be incomplete while keeping required fields for later statuses", () => {
    expect(migration).toContain("drop constraint if exists events_required_fields_after_proposal");
    expect(migration).toContain("add constraint events_required_fields_after_proposal");
    expect(migration).toContain("status in ('pending_approval', 'approved_pending_details', 'draft', 'rejected')");
    expect(migration).toContain("event_type is not null and venue_space is not null and end_at is not null");
  });
});
