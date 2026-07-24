/**
 * Slug helpers, kept in a leaf module so both the public API serialiser and the
 * public URL builder can use them without importing each other.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function buildEventSlug(event: { id: string; title: string; seoSlug?: string | null }): string {
  const slugBase = typeof event.seoSlug === "string" && event.seoSlug.trim().length ? event.seoSlug : event.title;
  const base = slugify(slugBase) || "event";
  return `${base}--${event.id}`;
}
