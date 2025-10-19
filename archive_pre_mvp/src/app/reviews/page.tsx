import { redirect } from "next/navigation";

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const resolved = (searchParams ? await searchParams : undefined) ?? {};

  const query = new URLSearchParams();
  const flashParam = resolved.flash;
  if (typeof flashParam === "string" && flashParam.length > 0) {
    query.set("flash", flashParam);
  }

  const suffix = query.toString();
  redirect(suffix.length > 0 ? `/?${suffix}` : "/");
}
