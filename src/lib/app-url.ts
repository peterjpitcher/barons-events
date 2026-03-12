/**
 * Resolves the application's base URL for use in email links and redirects.
 * Priority: NEXT_PUBLIC_SITE_URL → NEXT_PUBLIC_APP_URL → VERCEL_URL → hardcoded fallback.
 */
export function resolveAppUrl(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? null;
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;

  return siteUrl ?? appUrl ?? vercelUrl ?? "https://eventhub.orangejelly.co.uk";
}
