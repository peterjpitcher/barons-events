import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinkType, ShortLink } from "@/lib/links";

// Shared short-link insertion with unique-code generation.
//
// Insert-first design: rather than SELECT-then-INSERT (a TOCTOU race whose
// availability-check errors were previously swallowed), we insert immediately
// and retry ONLY when Postgres reports a duplicate on the code unique
// constraint (23505 on short_links_code_unique). Any other error — including a
// 23505 on the (parent_link_id, touchpoint) partial unique index — propagates
// immediately so callers can handle it explicitly.
//
// Consumed by links-server.ts (anon action client), system-short-links.ts and
// event-booking-links.ts (admin client) — the client is a parameter.

const MAX_CODE_ATTEMPTS = 5;
const CODE_UNIQUE_CONSTRAINT = "short_links_code_unique";

export type ShortLinkInsertRow = {
  name:            string;
  destination:     string;
  link_type:       LinkType;
  expires_at:      string | null;
  created_by:      string | null;
  parent_link_id?: string | null;
  touchpoint?:     string | null;
};

/** Raised when the short_links insert fails for a reason other than a code collision. */
export class ShortLinkInsertError extends Error {
  /** Postgres error code surfaced by PostgREST (e.g. "23505"), if any. */
  readonly pgCode: string | null;

  constructor(message: string, pgCode: string | null) {
    super(message);
    this.name = "ShortLinkInsertError";
    this.pgCode = pgCode;
  }
}

/** True when the error is a unique violation on something OTHER than the code column (e.g. the variant (parent, touchpoint) index). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof ShortLinkInsertError && error.pgCode === "23505";
}

/** Generates a random 8-char lowercase hex code. */
export function generateShortLinkCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type PostgrestErrorLike = { message: string; code?: string | null };

function isCodeCollision(error: PostgrestErrorLike): boolean {
  return error.code === "23505" && error.message.includes(CODE_UNIQUE_CONSTRAINT);
}

/**
 * Inserts a short_links row with a freshly generated unique code, retrying on
 * code collisions (up to 5 attempts). Non-collision errors throw a
 * ShortLinkInsertError immediately — they are never retried or swallowed.
 */
export async function insertShortLinkWithUniqueCode(
  client: SupabaseClient,
  row: ShortLinkInsertRow,
): Promise<ShortLink> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateShortLinkCode();
    const { data, error } = await client
      .from("short_links")
      .insert({
        code,
        name:           row.name,
        destination:    row.destination,
        link_type:      row.link_type,
        expires_at:     row.expires_at,
        created_by:     row.created_by,
        parent_link_id: row.parent_link_id ?? null,
        touchpoint:     row.touchpoint ?? null,
      })
      .select("*")
      .single();

    if (!error) return data as ShortLink;
    if (isCodeCollision(error)) continue; // another insert won this code — regenerate and retry
    throw new ShortLinkInsertError(`short_links insert failed: ${error.message}`, error.code ?? null);
  }
  throw new ShortLinkInsertError(
    `Could not generate a unique link code after ${MAX_CODE_ATTEMPTS} attempts.`,
    null,
  );
}
