import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SHORT_LINK_BASE_URL, type LinkType } from "@/lib/links";

/**
 * Creates a short link using the admin client (no auth context required).
 * Used for system-generated links in cron routes where there is no request
 * cookie context.
 * Returns the full short URL or null if creation fails.
 */
export async function createSystemShortLink(params: {
  name: string;
  destination: string;
  linkType?: LinkType;
  expiresAt?: string | null;
}): Promise<string | null> {
  const db = createSupabaseAdminClient();

  // Generate a unique 8-char hex code
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const candidate = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { data: existing } = await db
      .from("short_links")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!existing) {
      code = candidate;
      break;
    }
  }
  if (!code) {
    console.warn("createSystemShortLink: could not generate unique code");
    return null;
  }

  const { data, error } = await db
    .from("short_links")
    .insert({
      code,
      name: params.name,
      destination: params.destination,
      link_type: params.linkType ?? "other",
      expires_at: params.expiresAt ?? null,
      created_by: null,
    })
    .select("code")
    .single();

  if (error || !data) {
    console.warn("createSystemShortLink: insert failed", error);
    return null;
  }

  return SHORT_LINK_BASE_URL + (data as { code: string }).code;
}
