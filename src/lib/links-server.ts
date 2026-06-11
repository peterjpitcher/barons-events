// Server-only: imports Supabase server client — never import from client components.
import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { insertShortLinkWithUniqueCode } from "@/lib/short-link-codes";
import type { CreateLinkInput, ShortLink, UpdateLinkInput } from "@/lib/links";

// ── Queries ───────────────────────────────────────────────────────────────────

const LIST_PAGE_SIZE = 1000;

/**
 * Lists ALL short links, paging past PostgREST's 1000-row response cap.
 * Ordered newest-first with an id tiebreak so range pages never skip or
 * repeat rows (same pattern as the weekly-digest pagination fix, aba7b7a).
 */
export async function listShortLinks(): Promise<ShortLink[]> {
  const supabase = await createSupabaseReadonlyClient();
  const rows: ShortLink[] = [];

  for (let from = 0; ; from += LIST_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("short_links")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + LIST_PAGE_SIZE - 1);

    if (error) throw new Error(`listShortLinks: ${error.message}`);
    const page = (data ?? []) as ShortLink[];
    rows.push(...page);
    if (page.length < LIST_PAGE_SIZE) return rows;
  }
}

export async function createShortLink(input: CreateLinkInput): Promise<ShortLink> {
  const supabase = await createSupabaseActionClient();
  return insertShortLinkWithUniqueCode(supabase, {
    name:           input.name,
    destination:    input.destination,
    link_type:      input.link_type,
    expires_at:     input.expires_at ?? null,
    created_by:     input.created_by,
    parent_link_id: input.parent_link_id ?? null,
    touchpoint:     input.touchpoint ?? null,
  });
}

export async function updateShortLink(id: string, input: UpdateLinkInput): Promise<ShortLink> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("short_links")
    .update({
      ...(input.name        !== undefined && { name: input.name }),
      ...(input.destination !== undefined && { destination: input.destination }),
      ...(input.link_type   !== undefined && { link_type: input.link_type }),
      ...(input.expires_at  !== undefined && { expires_at: input.expires_at }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(`updateShortLink: ${error.message}`);
  return data as ShortLink;
}

/**
 * Deletes a short link and returns the deleted row, or null when no row was
 * deleted (already gone, or filtered by RLS). Callers must treat null as a
 * failed delete — previously a 0-row delete reported false success and wrote
 * a false audit entry.
 */
export async function deleteShortLink(
  id: string,
): Promise<Pick<ShortLink, "id" | "name" | "code"> | null> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("short_links")
    .delete()
    .eq("id", id)
    .select("id, name, code")
    .maybeSingle();

  if (error) throw new Error(`deleteShortLink: ${error.message}`);
  return (data ?? null) as Pick<ShortLink, "id" | "name" | "code"> | null;
}

export async function getShortLinkById(id: string): Promise<ShortLink | null> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("short_links")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getShortLinkById: ${error.message}`);
  return (data ?? null) as ShortLink | null;
}

/**
 * Returns the UTM variant for a (parent, touchpoint) pair, or null.
 * Deterministic: the partial unique index short_links_parent_touchpoint_uniq
 * guarantees at most one row.
 */
export async function findVariant(
  parentLinkId: string,
  touchpoint: string,
): Promise<ShortLink | null> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("short_links")
    .select("*")
    .eq("parent_link_id", parentLinkId)
    .eq("touchpoint", touchpoint)
    .maybeSingle();
  if (error) throw new Error(`findVariant: ${error.message}`);
  return (data ?? null) as ShortLink | null;
}

/** Lists every UTM variant of a parent link (ordered for stable processing). */
export async function listVariantsByParentId(parentLinkId: string): Promise<ShortLink[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("short_links")
    .select("*")
    .eq("parent_link_id", parentLinkId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`listVariantsByParentId: ${error.message}`);
  return (data ?? []) as ShortLink[];
}
