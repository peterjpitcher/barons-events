import Link from "next/link";
import { RoleGlance } from "@/components/dashboard/role-glance";
import { mainNavigation } from "@/lib/navigation";

const cards = mainNavigation.filter((item) => item.href !== "/");

const statusStyles = {
  available: "bg-emerald-100 text-emerald-700",
  "in-progress": "bg-amber-100 text-amber-700",
  upcoming: "bg-slate-200 text-slate-700",
} as const;

const statusCopy = {
  available: "Live",
  "in-progress": "Active build",
  upcoming: "Queued",
} as const;

export default function Home() {
  return (
    <section className="space-y-10">
      <div className="max-w-3xl space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Orchestrate the Barons event pipeline and planning analytics
        </h1>
        <p className="text-base text-black/70">
          The workspace now streams live submission analytics, reviewer queue data,
          and venue-space conflict warnings to keep planners and reviewers aligned.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-black/5 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium">Current focus</h2>
          <p className="mt-2 text-sm text-black/70">
            Stabilise pipeline analytics: status tiles, conflict detection, and reviewer
            SLA insights powered by refreshed Supabase seeds.
          </p>
        </div>
        <div className="rounded-lg border border-black/5 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium">Next steps</h2>
          <p className="mt-2 text-sm text-black/70">
            Automate tests for server actions, expose the planning feed via calendar APIs,
            and wire notifications for reviewer escalations.
          </p>
        </div>
      </div>

      <RoleGlance />

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Workstream status</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex h-full flex-col justify-between rounded-xl border border-black/[0.08] bg-white p-5 shadow-sm transition hover:border-black/15 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-medium text-black">
                    {item.title}
                  </h3>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[item.status]}`}
                  >
                    {statusCopy[item.status]}
                  </span>
                </div>
                <p className="text-sm text-black/70">{item.description}</p>
              </div>
              <span className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-black group-hover:underline">
                View track
                <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
