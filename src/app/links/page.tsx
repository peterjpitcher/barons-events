import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listShortLinks } from "@/lib/links-server";
import { canManageLinks } from "@/lib/roles";
import { LinksManager } from "@/components/links/links-manager";

export default async function LinksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") redirect("/unauthorized");

  const links = await listShortLinks();
  const canEdit = canManageLinks(user.role);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">Links & QR Codes</h1>
        <p className="mt-1 text-subtle">
          Short links live at{" "}
          <code className="rounded bg-[var(--color-muted-surface)] px-1.5 py-0.5 text-xs font-mono">
            l.baronspubs.com/[code]
          </code>{" "}
          and redirect automatically. Click counts update on each visit.
        </p>
      </header>

      <LinksManager links={links} canEdit={canEdit} />
    </div>
  );
}
