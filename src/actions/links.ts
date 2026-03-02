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
  findShortLinkByDestination,
} from "@/lib/links-server";
import {
  DIGITAL_TOUCHPOINTS,
  PRINT_TOUCHPOINTS,
  slugifyForUtm,
  SHORT_LINK_BASE_URL,
  type ShortLink,
  type LinkType,
} from "@/lib/links";

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

async function ensurePlanner() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated.");
  if (!canManageLinks(user.role)) throw new Error("You don't have permission to manage links.");
  return user;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createLinkSchema = z.object({
  name:        z.string().min(2, "Name must be at least 2 characters").max(NAME_MAX),
  destination: z.string().url("Must be a valid URL including https://").max(URL_MAX),
  link_type:   LINK_TYPE_ENUM,
  expires_at:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable().optional(),
});

const updateLinkSchema = z.object({
  id:          z.string().uuid(),
  name:        z.string().min(2, "Name must be at least 2 characters").max(NAME_MAX),
  destination: z.string().url("Must be a valid URL including https://").max(URL_MAX),
  link_type:   LINK_TYPE_ENUM,
  expires_at:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable().optional(),
});

const deleteLinkSchema = z.object({
  id: z.string().uuid(),
});

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function createShortLinkAction(input: unknown): Promise<LinksActionResult> {
  try {
    const user = await ensurePlanner();
    const parsed = createLinkSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Please fix the errors below.", fieldErrors: zodFieldErrors(parsed.error) };
    }

    const link = await createShortLink({
      name:        parsed.data.name,
      destination: parsed.data.destination,
      link_type:   parsed.data.link_type as LinkType,
      expires_at:  parsed.data.expires_at ?? null,
      created_by:  user.id,
    });

    revalidatePath("/links");
    return { success: true, message: "Short link created.", link };
  } catch (error) {
    console.error("createShortLinkAction error:", error);
    return { success: false, message: "Could not create the link. Please try again." };
  }
}

export async function updateShortLinkAction(input: unknown): Promise<LinksActionResult> {
  try {
    await ensurePlanner();
    const parsed = updateLinkSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Please fix the errors below.", fieldErrors: zodFieldErrors(parsed.error) };
    }

    await updateShortLink(parsed.data.id, {
      name:        parsed.data.name,
      destination: parsed.data.destination,
      link_type:   parsed.data.link_type as LinkType,
      expires_at:  parsed.data.expires_at ?? null,
    });

    revalidatePath("/links");
    return { success: true, message: "Link updated." };
  } catch (error) {
    console.error("updateShortLinkAction error:", error);
    return { success: false, message: "Could not update the link. Please try again." };
  }
}

export async function deleteShortLinkAction(input: unknown): Promise<LinksActionResult> {
  try {
    await ensurePlanner();
    const parsed = deleteLinkSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid request." };
    }

    await deleteShortLink(parsed.data.id);
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
  /** Present only when a brand-new variant short link was created (not an existing reuse). */
  link?: ShortLink;
  message?: string;
};

/**
 * Given a parent short link and a touchpoint value, returns a short URL where
 * the UTM parameters are baked into the destination URL (creating a new
 * variant short link if one doesn't already exist for that destination).
 */
export async function getOrCreateUtmVariantAction(
  parentLinkId: string,
  touchpointValue: string,
): Promise<UtmVariantResult> {
  try {
    const user = await ensurePlanner();

    if (!z.string().uuid().safeParse(parentLinkId).success) {
      return { success: false, message: "Invalid link ID." };
    }

    const allTouchpoints = [...DIGITAL_TOUCHPOINTS, ...PRINT_TOUCHPOINTS];
    const tp = allTouchpoints.find((t) => t.value === touchpointValue);
    if (!tp) return { success: false, message: "Unknown touchpoint." };

    const parent = await getShortLinkById(parentLinkId);
    if (!parent) return { success: false, message: "Link not found." };

    // Build destination URL with UTMs baked in.
    const dest = new URL(parent.destination);
    dest.searchParams.set("utm_source",   tp.utm_source);
    dest.searchParams.set("utm_medium",   tp.utm_medium);
    dest.searchParams.set("utm_campaign", slugifyForUtm(parent.name));
    const utmDestination = dest.toString();

    // Re-use an existing variant if one already exists for this destination.
    const existing = await findShortLinkByDestination(utmDestination);
    if (existing) {
      return { success: true, url: SHORT_LINK_BASE_URL + existing.code };
    }

    // Create a new variant short link.
    const variant = await createShortLink({
      name:        `${parent.name} — ${tp.label}`,
      destination: utmDestination,
      link_type:   parent.link_type,
      expires_at:  parent.expires_at ?? null,
      created_by:  user.id,
    });

    revalidatePath("/links");
    return { success: true, url: SHORT_LINK_BASE_URL + variant.code, link: variant };
  } catch (error) {
    console.error("getOrCreateUtmVariantAction error:", error);
    return { success: false, message: "Could not create UTM link. Please try again." };
  }
}
