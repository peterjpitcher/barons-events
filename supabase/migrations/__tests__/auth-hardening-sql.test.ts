import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260525162000_auth_hardening_sessions_and_role_trust.sql"),
  "utf8"
);

describe("auth hardening migration", () => {
  it("adds hashed session-token columns without invalidating existing sessions", () => {
    expect(migration).toContain("add column if not exists session_token_hash text");
    expect(migration).toContain("add column if not exists previous_session_token_hash text");
    expect(migration).toContain("where session_token_hash is not null");
    expect(migration).not.toMatch(/delete\s+from\s+public\.app_sessions/i);
    expect(migration).not.toMatch(/truncate\s+(table\s+)?public\.app_sessions/i);
  });

  it("keeps current_user_role authoritative to active public.users rows", () => {
    expect(migration).toContain("from public.users u");
    expect(migration).toContain("u.id = auth.uid()");
    expect(migration).toContain("u.deactivated_at is null");
    expect(migration).not.toMatch(/request\.jwt\.claims/i);
    expect(migration).not.toMatch(/app_metadata/i);
    expect(migration).not.toMatch(/raw_app_meta_data/i);
  });
});
