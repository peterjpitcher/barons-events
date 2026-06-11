// Client-safe: types, constants and pure helpers only — no server imports.

import { normaliseEventDateTimeForStorage } from "@/lib/datetime";

// Single source of truth lives in short-link-config (derived from
// SHORT_LINK_HOST). Re-exported here so client components keep importing it
// from "@/lib/links" without pulling in anything server-only.
export { SHORT_LINK_BASE_URL } from "@/lib/short-link-config";

export const LINK_TYPES = [
  { value: "general",  label: "General"  },
  { value: "event",    label: "Event"    },
  { value: "menu",     label: "Menu"     },
  { value: "social",   label: "Social"   },
  { value: "booking",  label: "Booking"  },
  { value: "other",    label: "Other"    },
] as const;

export type LinkType = (typeof LINK_TYPES)[number]["value"];

export type ShortLink = {
  id:             string;
  code:           string;
  name:           string;
  destination:    string;
  link_type:      LinkType;
  clicks:         number;
  expires_at:     string | null;
  created_by:     string | null;
  created_at:     string;
  updated_at:     string;
  /** FK to the parent link when this row is a UTM variant (migration 20260611195020). */
  parent_link_id: string | null;
  /** Touchpoint value (e.g. "poster") when this row is a UTM variant. */
  touchpoint:     string | null;
};

export type CreateLinkInput = {
  name:            string;
  destination:     string;
  link_type:       LinkType;
  expires_at:      string | null;
  created_by:      string | null; // null for system-generated links
  /** Set both (or neither) — enforced by the short_links_variant_coherence DB check. */
  parent_link_id?: string | null;
  touchpoint?:     string | null;
};

export type UpdateLinkInput = {
  name?:        string;
  destination?: string;
  link_type?:   LinkType;
  expires_at?:  string | null;
};

// ── UTM touchpoints ───────────────────────────────────────────────────────────

export type Touchpoint = {
  value:      string;
  label:      string;
  utm_source: string;
  utm_medium: string;
};

/** Digital channels — copy a UTM-tagged short URL to clipboard. */
export const DIGITAL_TOUCHPOINTS: Touchpoint[] = [
  { value: "facebook",          label: "Facebook",               utm_source: "facebook",          utm_medium: "social"          },
  { value: "facebook_stories",  label: "Facebook Stories",       utm_source: "facebook",          utm_medium: "social_stories"  },
  { value: "instagram_stories", label: "Instagram Stories",      utm_source: "instagram",         utm_medium: "social_stories"  },
  { value: "linkinbio",         label: "Link in Bio",            utm_source: "linkinbio",         utm_medium: "social"          },
  { value: "google_business",   label: "Google Business Profile",utm_source: "google_business",   utm_medium: "organic"         },
  { value: "email",             label: "Email Newsletter",       utm_source: "email",             utm_medium: "email"           },
  { value: "sms",               label: "SMS",                    utm_source: "sms",               utm_medium: "sms"             },
  { value: "whatsapp",          label: "WhatsApp",               utm_source: "whatsapp",          utm_medium: "messaging"       },
  { value: "twitter",           label: "Twitter / X",            utm_source: "twitter",           utm_medium: "social"          },
  { value: "tiktok",            label: "TikTok",                 utm_source: "tiktok",            utm_medium: "social"          },
  { value: "linkedin",          label: "LinkedIn",               utm_source: "linkedin",          utm_medium: "social"          },
];

/** Physical touchpoints — download a UTM-tagged QR code PNG. */
export const PRINT_TOUCHPOINTS: Touchpoint[] = [
  { value: "poster",         label: "Poster",             utm_source: "poster",         utm_medium: "print" },
  { value: "bar_strut",      label: "Bar Strut",          utm_source: "bar_strut",      utm_medium: "print" },
  { value: "table_talker",   label: "Table Talker",       utm_source: "table_talker",   utm_medium: "print" },
  { value: "business_card",  label: "Business Card",      utm_source: "business_card",  utm_medium: "print" },
  { value: "review_card",    label: "Review Card",        utm_source: "review_card",    utm_medium: "print" },
  { value: "window_sticker", label: "Window Sticker",     utm_source: "window_sticker", utm_medium: "print" },
  { value: "menu_insert",    label: "Menu Insert",        utm_source: "menu_insert",    utm_medium: "print" },
  { value: "flyer",          label: "Flyer",              utm_source: "flyer",          utm_medium: "print" },
  { value: "receipt",        label: "Receipt",            utm_source: "receipt",        utm_medium: "print" },
  { value: "chalkboard",     label: "Chalkboard",         utm_source: "chalkboard",     utm_medium: "print" },
];

/** All touchpoints (digital + print) in display order. */
export const ALL_TOUCHPOINTS: Touchpoint[] = [...DIGITAL_TOUCHPOINTS, ...PRINT_TOUCHPOINTS];

/** Looks up a touchpoint definition by its stored value (e.g. "poster"). */
export function findTouchpoint(value: string | null): Touchpoint | null {
  if (!value) return null;
  return ALL_TOUCHPOINTS.find((t) => t.value === value) ?? null;
}

// ── UTM helpers ───────────────────────────────────────────────────────────────

/** Converts a link name to a safe utm_campaign value, e.g. "Summer Menu 2026" → "summer_menu_2026". */
export function slugifyForUtm(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// ── Expiry ────────────────────────────────────────────────────────────────────

/**
 * Whether a short link's expiry has passed.
 *
 * Date-only expiries are stored as midnight UTC; the link stays active for the
 * WHOLE of that calendar day in Europe/London — i.e. until midnight at the
 * start of the next London day. (The previous +24h-UTC heuristic overshot the
 * UK day by an hour during BST.) Timed expiries (system-generated links)
 * compare against the exact instant, unchanged.
 */
export function isShortLinkExpired(expiresAt: string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return false; // malformed value — treat as non-expiring

  // Midnight UTC means the value came from a date-only input.
  if (expiry.getUTCHours() === 0 && expiry.getUTCMinutes() === 0) {
    const next = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate() + 1));
    const nextIsoDay = [
      next.getUTCFullYear(),
      String(next.getUTCMonth() + 1).padStart(2, "0"),
      String(next.getUTCDate()).padStart(2, "0"),
    ].join("-");
    // Midnight never falls inside the UK DST gap (01:00→02:00), so this cannot throw.
    const cutoff = new Date(normaliseEventDateTimeForStorage(`${nextIsoDay}T00:00:00`));
    return now.getTime() >= cutoff.getTime();
  }

  return expiry.getTime() < now.getTime();
}

// ── Link grouping ─────────────────────────────────────────────────────────────

export type GroupedLink = {
  parent:   ShortLink;
  variants: ShortLink[];
};

const ALL_TOUCHPOINT_LABELS: Set<string> = new Set(ALL_TOUCHPOINTS.map((t) => t.label));

const VARIANT_SEP = " — "; // " — " (space + em dash + space)

/**
 * If the link name follows the legacy variant convention (e.g.
 * "Summer Menu — Facebook"), returns the parent name and touchpoint label;
 * otherwise returns null. Retained as a DISPLAY fallback for legacy rows whose
 * parent_link_id is null — it no longer drives grouping.
 */
export function parseVariantName(
  name: string,
): { parentName: string; touchpointLabel: string } | null {
  const idx = name.lastIndexOf(VARIANT_SEP);
  if (idx === -1) return null;
  const touchpointLabel = name.slice(idx + VARIANT_SEP.length);
  if (!ALL_TOUCHPOINT_LABELS.has(touchpointLabel)) return null;
  return { parentName: name.slice(0, idx), touchpointLabel };
}

/** Display label for a variant row: touchpoint definition first, legacy name parse as fallback. */
export function getVariantLabel(link: ShortLink): string {
  return (
    findTouchpoint(link.touchpoint)?.label ??
    parseVariantName(link.name)?.touchpointLabel ??
    link.name
  );
}

/**
 * Groups a flat link list into parent + variant pairs, preserving list order.
 *
 * Variants attach to their ROOT parent via parent_link_id (FK from migration
 * 20260611195020); a variant whose parent is itself a variant — possible only
 * in legacy data — resolves upward. Rows with NULL parent_link_id are always
 * top-level: legacy variant-NAMED rows the migration could not match to a
 * parent (4 in production) render as standalone rows exactly as before, and a
 * link deliberately named "Menu — Poster" is no longer absorbed under "Menu".
 * Groups are keyed by id, so duplicate names can no longer hide rows.
 */
export function groupLinks(links: ShortLink[]): GroupedLink[] {
  const byId = new Map<string, ShortLink>(links.map((l) => [l.id, l]));

  /** Walks parent_link_id up to the root, guarding against missing parents and cycles. */
  function resolveRoot(link: ShortLink): ShortLink {
    let current = link;
    const seen = new Set<string>([current.id]);
    while (current.parent_link_id) {
      const parent = byId.get(current.parent_link_id);
      if (!parent || seen.has(parent.id)) break; // parent not in list, or a cycle — treat as root
      seen.add(parent.id);
      current = parent;
    }
    return current;
  }

  const groups = new Map<string, GroupedLink>();

  // First pass: every root becomes a group, in list order.
  for (const link of links) {
    if (resolveRoot(link).id === link.id && !groups.has(link.id)) {
      groups.set(link.id, { parent: link, variants: [] });
    }
  }

  // Second pass: attach variants to their root's group, in list order.
  for (const link of links) {
    const root = resolveRoot(link);
    if (root.id === link.id) continue;
    const group = groups.get(root.id);
    if (group) {
      group.variants.push(link);
    } else {
      // Unreachable by construction — but a row must never be hidden.
      groups.set(link.id, { parent: link, variants: [] });
    }
  }

  return Array.from(groups.values());
}
