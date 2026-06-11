"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canManageLinks } from "@/lib/roles";
import {
  createShortLink,
  updateShortLink,
  deleteShortLink,
  getShortLinkById,
  findVariant,
  listVariantsByParentId,
} from "@/lib/links-server";
import { isUniqueViolation } from "@/lib/short-link-codes";
import {
  findTouchpoint,
  slugifyForUtm,
  SHORT_LINK_BASE_URL,
  type ShortLink,
  type Touchpoint,
  type LinkType,
} from "@/lib/links";
import { getTodayLondonIsoDate } from "@/lib/datetime";
import { recordAuditLogEntry } from "@/lib/audit-log";

// ─── Result type ──────────────────────────────────────────────────────────────

export type LinksActionResult = {
  success: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  link?: ShortLink;
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

const LINK_TYPE_ENUM = z.enum(["general", "event", "menu", "social", "booking", "other"]);
const URL_MAX = 2048;
const NAME_MAX = 120;

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  error.issues.forEach((issue) => {
    const key = issue.path.join(".") || "form";
    if (!result[key]) result[key] = issue.message;
  });
  return result;
}

async function ensurePlanner(): Promise<
  | { ok: true; user: Awaited<ReturnType<typeof getCurrentUser>> & {} }
  | { ok: false; result: LinksActionResult }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, result: { success: false, message: "Not authenticated." } };
  if (!canManageLinks(user.role))
    return { ok: false, result: { success: false, message: "You do not have permission to perform this action." } };
  return { ok: true, user };
}

/** True when the string is a real calendar date (e.g. rejects 2026-02-31). */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const expiryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(isRealCalendarDate, "Must be a real calendar date")
  // ISO dates compare correctly as strings; "today" is the London calendar day.
  .refine((value) => value >= getTodayLondonIsoDate(), "Expiry date cannot be in the past")
  .nullable()
  .optional();

const createLinkSchema = z.object({
  name:        z.string().min(2, "Name must be at least 2 characters").max(NAME_MAX),
  destination: z.string().url("Must be a valid URL").startsWith("https://", "URL must start with https://").max(URL_MAX),
  link_type:   LINK_TYPE_ENUM,
  expires_at:  expiryDateSchema,
});

const updateLinkSchema = z.object({
  id:          z.string().uuid(),
  name:        z.string().min(2, "Name must be at least 2 characters").max(NAME_MAX),
  destination: z.string().url("Must be a valid URL").startsWith("https://", "URL must start with https://").max(URL_MAX),
  link_type:   LINK_TYPE_ENUM,
  expires_at:  expiryDateSchema,
});

const deleteLinkSchema = z.object({
  id: z.string().uuid(),
});

// ─── UTM destination building ─────────────────────────────────────────────────

/**
 * Bakes a touchpoint's UTM parameters into a parent link's destination.
 * utm_campaign falls back to the parent's short code when the name slugifies
 * to nothing (symbol/emoji-only names) so analytics rows are never blank.
 */
function buildVariantDestination(
  parent: Pick<ShortLink, "destination" | "name" | "code">,
  tp: Touchpoint,
): string {
  const dest = new URL(parent.destination);
  dest.searchParams.set("utm_source",   tp.utm_source);
  dest.searchParams.set("utm_medium",   tp.utm_medium);
  dest.searchParams.set("utm_campaign", slugifyForUtm(parent.name) || parent.code);
  return dest.toString();
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function createShortLinkAction(input: unknown): Promise<LinksActionResult> {
  const auth = await ensurePlanner();
  if (!auth.ok) return auth.result;
  try {
    const parsed = createLinkSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
    }

    const link = await createShortLink({
      name:        parsed.data.name,
      destination: parsed.data.destination,
      link_type:   parsed.data.link_type as LinkType,
      expires_at:  parsed.data.expires_at ?? null,
      created_by:  auth.user.id,
    });

    recordAuditLogEntry({
      entity: "link",
      entityId: link.id,
      action: "link.created",
      actorId: auth.user.id,
      meta: { name: parsed.data.name, linkType: parsed.data.link_type }
    }).catch((error) => console.error("link.created audit failed:", error));
    revalidatePath("/links");
    return { success: true, message: "Short link created.", link };
  } catch (error) {
    console.error("createShortLinkAction error:", error);
    return { success: false, message: "Could not create the link. Please try again." };
  }
}

export async function updateShortLinkAction(input: unknown): Promise<LinksActionResult> {
  const auth = await ensurePlanner();
  if (!auth.ok) return auth.result;
  try {
    const parsed = updateLinkSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
    }

    const updated = await updateShortLink(parsed.data.id, {
      name:        parsed.data.name,
      destination: parsed.data.destination,
      link_type:   parsed.data.link_type as LinkType,
      expires_at:  parsed.data.expires_at ?? null,
    });

    // Propagate the parent change to its UTM variants: printed QR codes point
    // at the VARIANT codes, so their baked destinations, display names and
    // expiry must follow the parent or the printed material silently diverges.
    const variants = await listVariantsByParentId(parsed.data.id);
    const failedVariantIds: string[] = [];
    for (const variant of variants) {
      try {
        const tp = findTouchpoint(variant.touchpoint);
        if (!tp) {
          throw new Error(`unknown touchpoint "${variant.touchpoint ?? "null"}" on variant ${variant.id}`);
        }
        await updateShortLink(variant.id, {
          name:        `${updated.name} — ${tp.label}`,
          destination: buildVariantDestination(updated, tp),
          expires_at:  updated.expires_at,
        });
      } catch (variantError) {
        failedVariantIds.push(variant.id);
        console.error(`updateShortLinkAction: variant propagation failed for ${variant.id}:`, variantError);
      }
    }
    const propagatedCount = variants.length - failedVariantIds.length;

    recordAuditLogEntry({
      entity: "link",
      entityId: parsed.data.id,
      action: "link.updated",
      actorId: auth.user.id,
      meta: { name: parsed.data.name, propagatedCount }
    }).catch((error) => console.error("link.updated audit failed:", error));
    revalidatePath("/links");

    if (failedVariantIds.length > 0) {
      // The parent change is committed — report the partial failure honestly.
      console.error(
        `updateShortLinkAction: ${failedVariantIds.length} of ${variants.length} variants failed to propagate:`,
        failedVariantIds,
      );
      return {
        success: false,
        message: `Link updated, but ${failedVariantIds.length} of ${variants.length} UTM variant link${variants.length === 1 ? "" : "s"} could not be updated. Save again to retry.`,
      };
    }

    return { success: true, message: "Link updated." };
  } catch (error) {
    console.error("updateShortLinkAction error:", error);
    return { success: false, message: "Could not update the link. Please try again." };
  }
}

export async function deleteShortLinkAction(input: unknown): Promise<LinksActionResult> {
  const auth = await ensurePlanner();
  if (!auth.ok) return auth.result;
  try {
    const parsed = deleteLinkSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid request." };
    }

    // Count variants BEFORE the delete — the FK cascade removes them with the parent.
    const variants = await listVariantsByParentId(parsed.data.id);

    const deleted = await deleteShortLink(parsed.data.id);
    if (!deleted) {
      // 0 rows deleted: already gone, or not permitted. No audit entry —
      // previously this path logged a link.deleted that never happened.
      return { success: false, message: "Link not found. It may already have been deleted." };
    }

    recordAuditLogEntry({
      entity: "link",
      entityId: parsed.data.id,
      action: "link.deleted",
      actorId: auth.user.id,
      meta: { name: deleted.name, code: deleted.code, variantCount: variants.length }
    }).catch((error) => console.error("link.deleted audit failed:", error));
    revalidatePath("/links");
    return { success: true, message: "Link deleted." };
  } catch (error) {
    console.error("deleteShortLinkAction error:", error);
    return { success: false, message: "Could not delete the link. Please try again." };
  }
}

// ─── UTM variant links ────────────────────────────────────────────────────────

export type UtmVariantResult = {
  success: boolean;
  /** Full short URL ready to copy or encode as QR, e.g. "https://l.baronspubs.com/a1b2c3d4" */
  url?: string;
  /** The variant short link row (new or reused) so the client can show it. */
  link?: ShortLink;
  message?: string;
};

/**
 * Given a parent short link and a touchpoint value, returns a short URL where
 * the UTM parameters are baked into the destination URL (creating a new
 * variant short link if one doesn't already exist for that touchpoint).
 *
 * Reuse is deterministic via the (parent_link_id, touchpoint) pair, backed by
 * the partial unique index — concurrent clicks on the same touchpoint resolve
 * to a single row.
 */
export async function getOrCreateUtmVariantAction(
  parentLinkId: string,
  touchpointValue: string,
): Promise<UtmVariantResult> {
  const auth = await ensurePlanner();
  if (!auth.ok) return auth.result;
  try {
    if (!z.string().uuid().safeParse(parentLinkId).success) {
      return { success: false, message: "Invalid link ID." };
    }

    const tp = findTouchpoint(touchpointValue);
    if (!tp) return { success: false, message: "Unknown touchpoint." };

    const parent = await getShortLinkById(parentLinkId);
    if (!parent) return { success: false, message: "Link not found." };
    if (parent.parent_link_id) {
      // Server-side guard: variants of variants corrupt grouping and attribution.
      return { success: false, message: "UTM variants can only be created for top-level links." };
    }

    // Re-use the existing variant for this (parent, touchpoint) pair.
    const existing = await findVariant(parent.id, tp.value);
    if (existing) {
      return { success: true, url: SHORT_LINK_BASE_URL + existing.code, link: existing };
    }

    // Create a new variant short link.
    const utmDestination = buildVariantDestination(parent, tp);
    let variant: ShortLink;
    try {
      variant = await createShortLink({
        name:           `${parent.name} — ${tp.label}`,
        destination:    utmDestination,
        link_type:      parent.link_type,
        expires_at:     parent.expires_at ?? null,
        created_by:     auth.user.id,
        parent_link_id: parent.id,
        touchpoint:     tp.value,
      });
    } catch (insertError) {
      // Concurrent click on the same touchpoint: the partial unique index
      // rejected this insert (23505) — the winning row is the one we want.
      if (isUniqueViolation(insertError)) {
        const winner = await findVariant(parent.id, tp.value);
        if (winner) {
          return { success: true, url: SHORT_LINK_BASE_URL + winner.code, link: winner };
        }
      }
      throw insertError;
    }

    recordAuditLogEntry({
      entity: "link",
      entityId: variant.id,
      action: "link.variant_created",
      actorId: auth.user.id,
      meta: { parentId: parent.id, touchpoint: tp.value, code: variant.code }
    }).catch((error) => console.error("link.variant_created audit failed:", error));

    revalidatePath("/links");
    return { success: true, url: SHORT_LINK_BASE_URL + variant.code, link: variant };
  } catch (error) {
    console.error("getOrCreateUtmVariantAction error:", error);
    return { success: false, message: "Could not create UTM link. Please try again." };
  }
}
