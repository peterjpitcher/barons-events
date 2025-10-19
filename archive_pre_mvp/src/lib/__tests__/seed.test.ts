import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const seedPath = "supabase/seed.sql";

describe("supabase seed data", () => {
  const seed = readFileSync(seedPath, "utf-8");

  it("includes executive demo account", () => {
    expect(seed).toMatch(/executive@barons\.example/);
  });

  it("seeds AI content and publish queue entries", () => {
    expect(seed).toMatch(/insert into public.ai_content/i);
    expect(seed).toMatch(/insert into public.ai_publish_queue/i);
  });

  it("keeps ai_content columns aligned with the enrichment schema", () => {
    const match = seed.match(/insert into public\.ai_content\s*\(([^)]+)\)/i);
    expect(match).toBeTruthy();

    const columns = match![1]
      .split(",")
      .map((column) => column.trim())
      .filter((column) => column.length > 0);

    const expectedColumns = [
      "id",
      "event_id",
      "version",
      "synopsis",
      "hero_copy",
      "seo_keywords",
      "audience_tags",
      "talent_bios",
      "generated_at",
      "generated_by",
      "published_at",
    ];

    expect(columns).toEqual(expectedColumns);
  });

  it("documents reviewer regions for venue managers", () => {
    expect(seed).toMatch(/Update region to mirror your venue manager territories/);
  });
});
