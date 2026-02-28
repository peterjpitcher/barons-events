// Server-only: imports Supabase server client — never import from client components.
import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import type { CreateLinkInput, ShortLink, UpdateLinkInput } from "@/lib/links";

// ── Code generation ───────────────────────────────────────────────────────────

function generateCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function listShortLinks(): Promise<ShortLink[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("short_links")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listShortLinks: ${error.message}`);
  return (data ?? []) as ShortLink[];
}

export async function createShortLink(input: CreateLinkInput): Promise<ShortLink> {
  const supabase = await createSupabaseActionClient();

  // Generate a unique code (retry up to 5 times on collision)
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCode();
    const { data: existing } = await supabase
      .from("short_links")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!existing) { code = candidate; break; }
  }
  if (!code) throw new Error("Could not generate a unique link code. Please try again.");

  const { data, error } = await supabase
    .from("short_links")
    .insert({
      code,
      name:        input.name,
      destination: input.destination,
      link_type:   input.link_type,
      expires_at:  input.expires_at ?? null,
      created_by:  input.created_by,
    })
    .select("*")
    .single();

  if (error) throw new Error(`createShortLink: ${error.message}`);
  return data as ShortLink;
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

export async function deleteShortLink(id: string): Promise<void> {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("short_links").delete().eq("id", id);
  if (error) throw new Error(`deleteShortLink: ${error.message}`);
}
