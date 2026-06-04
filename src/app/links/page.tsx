import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listShortLinks } from "@/lib/links-server";
import { canManageLinks } from "@/lib/roles";
import { LinksManager } from "@/components/links/links-manager";
import { PageHeader } from "@/components/ui/design-primitives";

export default async function LinksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const links = await listShortLinks();
  const canEdit = canManageLinks(user.role);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Distribution"
        title="Links & QR Codes"
        description={
          <>
          Short links live at{" "}
          <code className="rounded bg-[var(--canvas-2)] px-1.5 py-0.5 text-xs font-mono">
            l.baronspubs.com/[code]
          </code>{" "}
          and redirect automatically. Click counts update on each visit.
          </>
        }
        meta={<span>{links.length} active link{links.length === 1 ? "" : "s"}</span>}
      />

      <LinksManager links={links} canEdit={canEdit} />
    </div>
  );
}
