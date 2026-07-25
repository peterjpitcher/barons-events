import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260725100000_clear_brand_site_booking_urls.sql"),
  "utf8"
);

describe("clear brand site booking urls migration", () => {
  it("clears only booking_url, never source_url", () => {
    expect(migration).toContain("set booking_url = null");
    // source_url is import provenance and must survive the cleanup.
    expect(migration).not.toMatch(/set\s+source_url/i);
    expect(migration).not.toMatch(/source_url\s*=\s*null/i);
  });

  it("spares our own tracked short links", () => {
    // Without both exclusions the cleanup would wipe the l.baronspubs.com
    // short links, which are the correct booking destination.
    expect(migration).toContain("not ilike '%//l.baronspubs.com/%'");
    expect(migration).toContain("not ilike '%//l.baronspubs.com'");
  });

  it("targets brand-site hosts case-insensitively", () => {
    expect(migration).toContain("booking_url ilike '%baronspubs.com%'");
  });

  it("presents a service_role claim so the events write guard does not abort it", () => {
    // events_require_admin_or_service_write raises for any writer that is
    // neither service_role nor an administrator, and auth.role() is null under
    // `supabase db push`.
    expect(migration).toContain("set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
    // The elevated claim must not leak to later statements.
    expect(migration).toContain("set_config('request.jwt.claims', null, true)");
  });

  it("scopes the update to events only", () => {
    expect(migration).toContain("update public.events");
    expect(migration).not.toMatch(/delete\s+from/i);
    expect(migration).not.toMatch(/drop\s+(table|column)/i);
  });
});
