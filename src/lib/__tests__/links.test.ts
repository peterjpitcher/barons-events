import { describe, it, expect } from "vitest";
import {
  slugifyForUtm,
  parseVariantName,
  groupLinks,
  isShortLinkExpired,
  findTouchpoint,
  getVariantLabel,
  type ShortLink,
} from "@/lib/links";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLink(overrides: Partial<ShortLink> = {}): ShortLink {
  return {
    id: "link-1",
    code: "abcd1234",
    name: "Menu",
    destination: "https://baronspubs.com/menu",
    link_type: "menu",
    clicks: 0,
    expires_at: null,
    created_by: "user-1",
    created_at: "2026-06-01T00:00:00+00:00",
    updated_at: "2026-06-01T00:00:00+00:00",
    parent_link_id: null,
    touchpoint: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// slugifyForUtm (QA S-cases, D010 input side)
// ---------------------------------------------------------------------------

describe("slugifyForUtm", () => {
  it("should slugify a typical name (S4)", () => {
    expect(slugifyForUtm("Summer Menu 2026")).toBe("summer_menu_2026");
  });

  it("should strip leading/trailing punctuation (S3)", () => {
    expect(slugifyForUtm("--Summer Menu--")).toBe("summer_menu");
  });

  it("should collapse repeated symbol runs (S7)", () => {
    expect(slugifyForUtm("!!a!!b!!")).toBe("a_b");
  });

  it("should return an empty string for symbol-only names (S1/S2/S5 — callers must apply the code fallback)", () => {
    expect(slugifyForUtm("!!!")).toBe("");
    expect(slugifyForUtm("🎉🎉")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseVariantName (QA P-cases) — display fallback only
// ---------------------------------------------------------------------------

describe("parseVariantName", () => {
  it("should parse a legacy variant name (P1)", () => {
    expect(parseVariantName("Summer Menu — Facebook")).toEqual({
      parentName: "Summer Menu",
      touchpointLabel: "Facebook",
    });
  });

  it("should reject separator look-alikes (P4/P5, T083)", () => {
    expect(parseVariantName("Menu - Poster")).toBeNull();
    expect(parseVariantName("Menu —Poster")).toBeNull();
  });

  it("should reject suffixes that are not touchpoint labels", () => {
    expect(parseVariantName("Menu — Unknown Channel")).toBeNull();
  });

  it("should split on the LAST separator (P2)", () => {
    expect(parseVariantName("X — Poster — Facebook")).toEqual({
      parentName: "X — Poster",
      touchpointLabel: "Facebook",
    });
  });
});

// ---------------------------------------------------------------------------
// groupLinks — FK-driven grouping (D002/D003/D004; T070-T075)
// ---------------------------------------------------------------------------

describe("groupLinks", () => {
  it("should group FK variants under their parent regardless of list order", () => {
    const parent = makeLink({ id: "p1", name: "Menu" });
    const variant = makeLink({
      id: "v1",
      code: "ffff0001",
      name: "Menu — Poster",
      parent_link_id: "p1",
      touchpoint: "poster",
    });
    // DESC lists put newer variants before their parent.
    const groups = groupLinks([variant, parent]);
    expect(groups).toHaveLength(1);
    expect(groups[0].parent.id).toBe("p1");
    expect(groups[0].variants.map((v) => v.id)).toEqual(["v1"]);
  });

  it("should NOT absorb a null-FK link literally named 'Menu — Poster' when a 'Menu' parent exists (T070/D003)", () => {
    const menu = makeLink({ id: "p1", name: "Menu" });
    const lookalike = makeLink({ id: "p2", code: "ffff0002", name: "Menu — Poster" });
    const groups = groupLinks([lookalike, menu]);
    expect(groups).toHaveLength(2);
    const ids = groups.map((g) => g.parent.id);
    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
    expect(groups.every((g) => g.variants.length === 0)).toBe(true);
  });

  it("should keep a lone variant-named link independent when its 'parent' is created later (T071)", () => {
    const lookalike = makeLink({ id: "p2", name: "Menu — Poster" });
    expect(groupLinks([lookalike])).toHaveLength(1);
    const menu = makeLink({ id: "p1", name: "Menu" });
    const groups = groupLinks([lookalike, menu]);
    expect(groups).toHaveLength(2);
  });

  it("should render legacy null-FK orphans as standalone top-level rows (the 4 production rows)", () => {
    const orphan = makeLink({ id: "o1", name: "Old Campaign — Flyer" });
    const groups = groupLinks([orphan]);
    expect(groups).toHaveLength(1);
    expect(groups[0].parent.id).toBe("o1");
    expect(groups[0].variants).toHaveLength(0);
  });

  it("should show BOTH parents when two links share a name (T072/D004)", () => {
    const newer = makeLink({ id: "p2", code: "ffff0003", name: "Menu", created_at: "2026-06-02T00:00:00+00:00" });
    const older = makeLink({ id: "p1", name: "Menu" });
    const groups = groupLinks([newer, older]);
    expect(groups.map((g) => g.parent.id)).toEqual(["p2", "p1"]);
  });

  it("should attach a variant to the correct same-named parent by id, not name (D004)", () => {
    const newer = makeLink({ id: "p2", code: "ffff0003", name: "Menu" });
    const older = makeLink({ id: "p1", name: "Menu" });
    const variantOfOlder = makeLink({
      id: "v1",
      code: "ffff0004",
      name: "Menu — Poster",
      parent_link_id: "p1",
      touchpoint: "poster",
    });
    const groups = groupLinks([variantOfOlder, newer, older]);
    expect(groups).toHaveLength(2);
    const olderGroup = groups.find((g) => g.parent.id === "p1");
    const newerGroup = groups.find((g) => g.parent.id === "p2");
    expect(olderGroup?.variants.map((v) => v.id)).toEqual(["v1"]);
    expect(newerGroup?.variants).toHaveLength(0);
  });

  it("should resolve a variant-of-a-variant (legacy data) upward to the ROOT parent (T075)", () => {
    const root = makeLink({ id: "g1", name: "X" });
    const mid = makeLink({ id: "m1", code: "ffff0005", name: "X — Poster", parent_link_id: "g1", touchpoint: "poster" });
    const leaf = makeLink({
      id: "l1",
      code: "ffff0006",
      name: "X — Poster — Facebook",
      parent_link_id: "m1",
      touchpoint: "facebook",
    });
    const groups = groupLinks([leaf, mid, root]);
    expect(groups).toHaveLength(1);
    expect(groups[0].parent.id).toBe("g1");
    expect(groups[0].variants.map((v) => v.id).sort()).toEqual(["l1", "m1"]);
  });

  it("should render a variant standalone when its FK parent is not in the list (defensive — no row may ever be hidden)", () => {
    const stranded = makeLink({ id: "v1", name: "Menu — Poster", parent_link_id: "gone", touchpoint: "poster" });
    const groups = groupLinks([stranded]);
    expect(groups).toHaveLength(1);
    expect(groups[0].parent.id).toBe("v1");
  });
});

// ---------------------------------------------------------------------------
// isShortLinkExpired — Europe/London end-of-day semantics (D008; T048-T052)
// ---------------------------------------------------------------------------

describe("isShortLinkExpired", () => {
  it("should never expire links without an expiry", () => {
    expect(isShortLinkExpired(null, new Date("2026-06-11T12:00:00Z"))).toBe(false);
  });

  it("should keep a date-only link active at 23:59 UK on its expiry day during BST (T048)", () => {
    // 23:59 UK on 11 Jun = 22:59 UTC.
    expect(isShortLinkExpired("2026-06-11T00:00:00+00:00", new Date("2026-06-11T22:59:00Z"))).toBe(false);
  });

  it("should expire a date-only link at 00:30 UK the NEXT day during BST (T051/D008 — the old +24h-UTC rule overshot by an hour)", () => {
    // 00:30 UK on 12 Jun = 23:30 UTC on 11 Jun.
    expect(isShortLinkExpired("2026-06-11T00:00:00+00:00", new Date("2026-06-11T23:30:00Z"))).toBe(true);
  });

  it("should flip exactly at London midnight during BST (23:00 UTC)", () => {
    expect(isShortLinkExpired("2026-06-11T00:00:00+00:00", new Date("2026-06-11T22:59:59.999Z"))).toBe(false);
    expect(isShortLinkExpired("2026-06-11T00:00:00+00:00", new Date("2026-06-11T23:00:00.000Z"))).toBe(true);
  });

  it("should flip exactly at UK midnight in winter (GMT, T052)", () => {
    expect(isShortLinkExpired("2026-01-10T00:00:00+00:00", new Date("2026-01-10T23:59:59.999Z"))).toBe(false);
    expect(isShortLinkExpired("2026-01-10T00:00:00+00:00", new Date("2026-01-11T00:00:00.000Z"))).toBe(true);
  });

  it("should treat yesterday's date-only expiry as expired (T049) and tomorrow's as active (T050)", () => {
    const now = new Date("2026-06-11T12:00:00Z");
    expect(isShortLinkExpired("2026-06-10T00:00:00+00:00", now)).toBe(true);
    expect(isShortLinkExpired("2026-06-12T00:00:00+00:00", now)).toBe(false);
  });

  it("should compare timed expiries (system links) against the exact instant", () => {
    expect(isShortLinkExpired("2026-06-11T15:30:00+00:00", new Date("2026-06-11T15:29:00Z"))).toBe(false);
    expect(isShortLinkExpired("2026-06-11T15:30:00+00:00", new Date("2026-06-11T15:31:00Z"))).toBe(true);
  });

  it("should treat malformed values as non-expiring rather than killing the link", () => {
    expect(isShortLinkExpired("not-a-date", new Date("2026-06-11T12:00:00Z"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Touchpoint helpers
// ---------------------------------------------------------------------------

describe("findTouchpoint / getVariantLabel", () => {
  it("should resolve touchpoint values to definitions", () => {
    expect(findTouchpoint("poster")?.label).toBe("Poster");
    expect(findTouchpoint("facebook")?.utm_medium).toBe("social");
    expect(findTouchpoint("nope")).toBeNull();
    expect(findTouchpoint(null)).toBeNull();
  });

  it("should label variants from the touchpoint column first, then legacy name parse, then the raw name", () => {
    expect(getVariantLabel(makeLink({ touchpoint: "poster", name: "Whatever" }))).toBe("Poster");
    expect(getVariantLabel(makeLink({ touchpoint: null, name: "Menu — Flyer" }))).toBe("Flyer");
    expect(getVariantLabel(makeLink({ touchpoint: null, name: "Just a name" }))).toBe("Just a name");
  });
});
