import { describe, expect, it } from "vitest";
import { diffSnapshot } from "@/lib/events/diff";

describe("diffSnapshot", () => {
  it("returns empty array when both snapshots are empty", () => {
    expect(diffSnapshot(null, null)).toEqual([]);
  });

  it("flags added fields", () => {
    const diff = diffSnapshot(null, { title: "New event" });

    expect(diff).toEqual([
      {
        field: "title",
        before: undefined,
        after: "New event",
      },
    ]);
  });

  it("flags removed fields", () => {
    const diff = diffSnapshot({ venue_id: "venue-1" }, {});

    expect(diff).toEqual([
      {
        field: "venue_id",
        before: "venue-1",
        after: undefined,
      },
    ]);
  });

  it("ignores reserved fields", () => {
    const diff = diffSnapshot(
      { updated_at: "yesterday", title: "Original" },
      { updated_at: "today", title: "Original" }
    );

    expect(diff).toEqual([]);
  });

  it("detects changed scalar values", () => {
    const diff = diffSnapshot(
      { title: "Original" },
      { title: "Updated" }
    );

    expect(diff).toEqual([
      {
        field: "title",
        before: "Original",
        after: "Updated",
      },
    ]);
  });

  it("handles array comparison", () => {
    const diff = diffSnapshot(
      { promo_tags: ["music", "food"] },
      { promo_tags: ["food", "music", "vip"] }
    );

    expect(diff).toEqual([
      {
        field: "promo_tags",
        before: ["food", "music"],
        after: ["food", "music", "vip"],
      },
    ]);
  });

  it("handles nested objects", () => {
    const diff = diffSnapshot(
      { venue: { name: "Old", space: "Main" } },
      { venue: { name: "Old", space: "Garden" } }
    );

    expect(diff).toEqual([
      {
        field: "venue",
        before: { name: "Old", space: "Main" },
        after: { name: "Old", space: "Garden" },
      },
    ]);
  });

  it("respects ignored fields option", () => {
    const diff = diffSnapshot(
      { title: "Old", status: "draft" },
      { title: "New", status: "submitted" },
      { ignoredFields: ["status"] }
    );

    expect(diff).toEqual([
      {
        field: "title",
        before: "Old",
        after: "New",
      },
    ]);
  });

  it("tags diffs with a source identifier", () => {
    const diff = diffSnapshot(
      { title: "Old" },
      { title: "New" },
      { sourceTag: "manual" }
    );

    expect(diff).toEqual([
      {
        field: "title",
        before: "Old",
        after: "New",
        source: "manual",
      },
    ]);
  });
});
