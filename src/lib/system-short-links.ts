import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SHORT_LINK_BASE_URL } from "@/lib/short-link-config";
import { insertShortLinkWithUniqueCode } from "@/lib/short-link-codes";
import { recordSystemAuditLogEntry } from "@/lib/audit-log";
import type { LinkType } from "@/lib/links";

/**
 * Creates a short link using the admin client (no auth context required).
 * Used for system-generated links in cron routes where there is no request
 * cookie context.
 * Returns the full short URL or null if creation fails — callers degrade
 * gracefully (SMS still sends without the short link). Failures are logged at
 * error level so lost tracking is observable.
 */
export async function createSystemShortLink(params: {
  name: string;
  destination: string;
  linkType?: LinkType;
  expiresAt?: string | null;
}): Promise<string | null> {
  try {
    const db = createSupabaseAdminClient();
    const link = await insertShortLinkWithUniqueCode(db, {
      name:        params.name,
      destination: params.destination,
      link_type:   params.linkType ?? "other",
      expires_at:  params.expiresAt ?? null,
      created_by:  null,
    });

    // System mutation — audit with the service-role logger (null actor permitted).
    await recordSystemAuditLogEntry({
      entity: "link",
      entityId: link.id,
      action: "link.created",
      actorId: null,
      meta: { name: params.name, linkType: params.linkType ?? "other", system: true },
    });

    return SHORT_LINK_BASE_URL + link.code;
  } catch (error) {
    console.error("createSystemShortLink failed:", error);
    return null;
  }
}
