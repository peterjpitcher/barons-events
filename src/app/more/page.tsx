import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Building2,
  ChevronRight,
  Clock3,
  FileCheck2,
  Grid2X2,
  Link2,
  LogOut,
  MessageSquareText,
  Settings,
  Star,
  UserRound,
  Users,
} from "lucide-react";
import { signOutAction } from "@/actions/auth";
import { Avatar, PageHeader } from "@/components/ui/design-primitives";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardTodoItems } from "@/lib/dashboard";
import { canProposeEvents } from "@/lib/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { londonDateString } from "@/lib/planning/utils";

const roleDisplayNames: Record<string, string> = {
  administrator: "Administrator",
  office_worker: "Office Worker",
  executive: "Executive",
};

const operationsLinks = [
  { label: "Reviews", href: "/reviews", icon: FileCheck2, meta: "Event approval queue", badgeKey: "reviews" },
  { label: "Debriefs", href: "/debriefs", icon: MessageSquareText, meta: "Post-event learning", badgeKey: "debriefs" },
  { label: "Customers", href: "/customers", icon: Users, meta: "Booking contacts" },
  { label: "Artists", href: "/artists", icon: Star, meta: "Performers and hosts" },
  { label: "Links & QR Codes", href: "/links", icon: Link2, meta: "Short links and posters" },
];

const manageLinks = [
  { label: "Venues", href: "/venues", icon: Building2, meta: "Locations and managers" },
  { label: "Opening Hours", href: "/opening-hours", icon: Clock3, meta: "Weekly hours by service" },
  { label: "Users", href: "/users", icon: UserRound, meta: "Team and roles" },
  { label: "Settings", href: "/settings", icon: Settings, meta: "Event types and SOPs" },
];

async function countPendingProposals(): Promise<number> {
  const db = createSupabaseAdminClient();
  const { count } = await (db as any)
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_approval")
    .is("deleted_at", null);
  return typeof count === "number" ? count : 0;
}

export default async function MorePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [pendingProposals, todosResult] = await Promise.all([
    countPendingProposals(),
    getDashboardTodoItems(user, londonDateString()).catch(() => ({ items: [] })),
  ]);
  const reviewCount = pendingProposals || todosResult.items.filter((item) => item.source === "review").length;
  const debriefCount = todosResult.items.filter((item) => item.source === "debrief").length;
  const canCreate = canProposeEvents(user.role);

  const badges: Record<string, number> = {
    reviews: reviewCount,
    debriefs: debriefCount,
  };

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Workspace"
        title="More"
        description="Secondary tools and account controls."
      />

      <Link href="/account" className="mobile-card flex items-center gap-3 md:max-w-xl">
        <Avatar name={user.fullName ?? user.email} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--ink)]">{user.fullName ?? user.email}</span>
          <span className="mt-1 block truncate font-brand-mono text-[0.625rem] uppercase tracking-[0.06em] text-[var(--ink-soft)]">
            {roleDisplayNames[user.role] ?? user.role.replace(/_/g, " ")}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 text-[var(--ink-soft)]" aria-hidden="true" />
      </Link>

      {canCreate ? (
        <Link
          href="/events/propose"
          className="inline-flex min-h-11 items-center justify-center rounded-[11px] bg-[var(--mustard)] px-4 text-sm font-semibold text-[var(--ink-on-mustard)] shadow-card md:max-w-xs"
        >
          Propose an event
        </Link>
      ) : null}

      <MoreGroup title="Operations" links={operationsLinks} badges={badges} />
      <MoreGroup title="Manage" links={manageLinks} badges={badges} />

      <form action={signOutAction}>
        <button
          type="submit"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[11px] border border-transparent px-4 text-sm font-semibold text-[var(--burgundy)] hover:bg-[var(--burgundy-tint)] md:max-w-xs"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </button>
      </form>
    </div>
  );
}

function MoreGroup({
  title,
  links,
  badges,
}: {
  title: string;
  links: typeof operationsLinks;
  badges: Record<string, number>;
}) {
  return (
    <section>
      <div className="mobile-section-label">
        <span>{title}</span>
      </div>
      <div className="mobile-list-card md:max-w-2xl">
        {links.map((item) => {
          const Icon = item.icon;
          const badge = item.badgeKey ? badges[item.badgeKey] : 0;
          return (
            <Link key={item.href} href={item.href} className="mobile-list-row items-center">
              <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[var(--canvas-2)] text-[var(--navy)]">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[var(--ink)]">{item.label}</span>
                <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">{item.meta}</span>
              </span>
              {badge > 0 ? (
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--burgundy)] px-2 font-brand-mono text-[0.625rem] font-bold text-white">
                  {badge}
                </span>
              ) : null}
              <ChevronRight className="h-4 w-4 text-[var(--ink-soft)]" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
