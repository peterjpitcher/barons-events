// Client-safe: types and constants only — no server imports.

export const SHORT_LINK_BASE_URL = "https://l.baronspubs.com/";

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
  id:          string;
  code:        string;
  name:        string;
  destination: string;
  link_type:   LinkType;
  clicks:      number;
  expires_at:  string | null;
  created_by:  string | null;
  created_at:  string;
  updated_at:  string;
};

export type CreateLinkInput = {
  name:        string;
  destination: string;
  link_type:   LinkType;
  expires_at:  string | null;
  created_by:  string | null; // null for system-generated links
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

// ── UTM helpers ───────────────────────────────────────────────────────────────

/** Converts a link name to a safe utm_campaign value, e.g. "Summer Menu 2026" → "summer_menu_2026". */
export function slugifyForUtm(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Builds a full short URL with UTM query params appended. */
export function buildUtmShortUrl(code: string, tp: Touchpoint, linkName: string): string {
  const url = new URL(SHORT_LINK_BASE_URL + code);
  url.searchParams.set("utm_source",   tp.utm_source);
  url.searchParams.set("utm_medium",   tp.utm_medium);
  url.searchParams.set("utm_campaign", slugifyForUtm(linkName));
  return url.toString();
}

// ── Link grouping ─────────────────────────────────────────────────────────────

export type GroupedLink = {
  parent:   ShortLink;
  variants: ShortLink[];
};

const ALL_TOUCHPOINT_LABELS: Set<string> = new Set([
  ...DIGITAL_TOUCHPOINTS.map((t) => t.label),
  ...PRINT_TOUCHPOINTS.map((t) => t.label),
]);

const VARIANT_SEP = " \u2014 "; // " — " (space + em dash + space)

/**
 * If the link name is a UTM variant (e.g. "Summer Menu — Facebook"),
 * returns the parent name and touchpoint label; otherwise returns null.
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

/**
 * Groups a flat link list into parent + variant pairs, preserving
 * the original creation-time ordering of parent links.
 * Orphaned variants (whose parent has been deleted/renamed) are
 * appended as standalone parents at the end.
 */
export function groupLinks(links: ShortLink[]): GroupedLink[] {
  const parentNames = new Set(
    links.filter((l) => !parseVariantName(l.name)).map((l) => l.name),
  );

  const groupByName = new Map<string, GroupedLink>();
  const orphans: ShortLink[] = [];

  // First pass: build parent entries so variants can reference them regardless
  // of ordering (variants are newer, so they sort before parents in DESC lists).
  for (const link of links) {
    if (!parseVariantName(link.name) && !groupByName.has(link.name)) {
      groupByName.set(link.name, { parent: link, variants: [] });
    }
  }

  // Second pass: assign variants to their parent group (or mark as orphans).
  for (const link of links) {
    const parsed = parseVariantName(link.name);
    if (!parsed) continue;
    if (parentNames.has(parsed.parentName)) {
      groupByName.get(parsed.parentName)!.variants.push(link);
    } else {
      orphans.push(link);
    }
  }

  // Preserve parent insertion order.
  const seen = new Set<string>();
  const result: GroupedLink[] = [];
  for (const link of links) {
    if (!parseVariantName(link.name) && !seen.has(link.name)) {
      seen.add(link.name);
      const group = groupByName.get(link.name);
      if (group) result.push(group);
    }
  }
  for (const link of orphans) {
    result.push({ parent: link, variants: [] });
  }
  return result;
}
