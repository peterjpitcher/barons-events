import dynamic from "next/dynamic";
import { getCurrentUserProfile } from "@/lib/profile";
import { fetchPlanningAnalytics } from "@/lib/events/planning-analytics";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GoalManager } from "@/components/planning/goal-manager";
import { EventClonePanel } from "@/components/planning/event-clone-panel";
import { AiMetadataPanel } from "@/components/planning/ai-metadata-panel";

const PlanningAnalyticsClient = dynamic(
  () => import("@/components/planning/planning-analytics-client"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-black/[0.08] bg-white px-4 py-6 text-sm text-black/70">
        Loading planning analytics…
      </div>
    ),
  }
);

const planningTracks = [
  {
    title: "Pipeline visibility",
    description:
      "Dashboards summarising event volume, approvals, SLA performance, and conflict hot spots for HQ planners.",
    items: [
      "Status tiles for draft/submitted/approved counts.",
      "Calendar feed highlighting venue-space conflicts.",
      "Weekly digest metrics aligned with executive reporting.",
    ],
  },
  {
    title: "Operational tooling",
    description:
      "Utilities that help planners manage goals, clone events, and rebalance reviewer workloads.",
    items: [
      "Server actions for cloning events with venue safeguards.",
      "Goal management CRUD with active/inactive toggles.",
      "Reviewer reassignment helper that respects RLS policies.",
    ],
  },
  {
    title: "AI enrichment oversight",
    description:
      "Interfaces for approving and publishing AI-generated metadata post-approval.",
    items: [
      "Snapshot of AI outputs with manual edit capability.",
      "Version history referencing `ai_content` records.",
      "Publish action that promotes metadata downstream.",
    ],
  },
];

type GoalRecord = {
  id: string;
  label: string;
  description: string | null;
  active: boolean;
  created_at: string | null;
};

type AiContentRecord = {
  id: string;
  event_id: string;
  version: number;
  synopsis: string | null;
  hero_copy: string | null;
  seo_keywords: unknown;
  audience_tags: unknown;
  talent_bios: unknown;
  generated_at: string | null;
  published_at: string | null;
  event?: {
    title: string | null;
    venue?: { name: string | null } | null;
  } | null;
};

export default async function PlanningPage() {
  const profile = await getCurrentUserProfile();
  const isHQPlanner = profile?.role === "hq_planner";

  let planningError: string | null = null;
  let planningData: Awaited<ReturnType<typeof fetchPlanningAnalytics>> | null = null;
  let goals: GoalRecord[] = [];
  let aiContent: AiContentRecord[] = [];
  let goalError: string | null = null;
  let aiError: string | null = null;

  if (isHQPlanner) {
    try {
      planningData = await fetchPlanningAnalytics();
      const supabase = createSupabaseServerClient();
      const [goalResult, aiResult] = await Promise.all([
        supabase
          .from("goals")
          .select("id,label,description,active,created_at")
          .order("label", { ascending: true }),
        supabase
          .from("ai_content")
          .select(
            `
              id,
              event_id,
              version,
              synopsis,
              hero_copy,
              seo_keywords,
              audience_tags,
              talent_bios,
              generated_at,
              published_at,
              event:events(id,title,venue:venues(name))
            `
          )
          .order("generated_at", { ascending: false })
          .limit(20),
      ]);

      if (goalResult.error) {
        goalError =
          goalResult.error.message ?? "Unable to load goals catalogue.";
      } else {
        goals = (goalResult.data ?? []) as GoalRecord[];
      }

      if (aiResult.error) {
        aiError =
          aiResult.error.message ?? "Unable to load AI metadata.";
      } else {
        aiContent = (aiResult.data ?? []) as AiContentRecord[];
      }
    } catch (error) {
      planningError = error instanceof Error ? error.message : "Unable to load planning analytics.";
    }
  }

return (
  <section className="space-y-10">
    <header className="space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight">Planning ops</h1>
      <p className="max-w-2xl text-base text-black/70">
        HQ tooling now surfaces live pipeline metrics, venue-space conflicts, and the
        upcoming events feed. Use this view to triage overlaps and prep the weekly digest.
      </p>
      <div className="inline-flex flex-wrap items-center gap-3 text-sm text-black/70">
        <span className="rounded-full bg-black px-3 py-1 font-medium text-white">
          Milestone: EP-107 / EP-108 / EP-110
        </span>
        <span>
          Analytics: <code>docs/ProjectPlan.md</code>
        </span>
        <span>
          Seeds: <code>supabase/seed.sql</code>
        </span>
      </div>
    </header>

    {!isHQPlanner ? (
      <div className="rounded-xl border border-dashed border-black/20 bg-white px-4 py-6 text-sm text-black/70">
        Planning analytics are scoped to HQ planners. Ask an HQ teammate to run through the
        conflicts banner and planning feed if you need visibility.
      </div>
    ) : planningError ? (
      <div className="rounded-xl border border-dashed border-red-300 bg-red-50 px-4 py-6 text-sm text-red-700">
        {planningError}
      </div>
    ) : !planningData ? (
      <div className="rounded-xl border border-dashed border-black/20 bg-white px-4 py-6 text-sm text-black/70">
        Planning analytics unavailable. Try refreshing the page.
      </div>
    ) : (
      <PlanningAnalyticsClient
        initialData={{
          statusCounts: planningData.statusCounts,
          conflicts: planningData.conflicts,
          upcoming: planningData.upcoming,
          awaitingReviewer: planningData.awaitingReviewer,
          totalEvents: planningData.totalEvents,
          calendarEvents: planningData.calendarEvents,
          reviewerSla: planningData.reviewerSla,
        }}
      />
    )}

    {isHQPlanner && planningError === null ? (
      <div className="space-y-6">
        {planningData ? (
          <EventClonePanel events={planningData.summaries} />
        ) : null}
        {goalError ? (
          <div className="rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {goalError}
          </div>
        ) : (
          <GoalManager goals={goals} />
        )}
        {aiError ? (
          <div className="rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {aiError}
          </div>
        ) : (
          <AiMetadataPanel content={aiContent} />
        )}
      </div>
    ) : null}

    <div className="grid gap-5 md:grid-cols-2">
      {planningTracks.map((area) => (
        <div
          key={area.title}
          className="flex h-full flex-col rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm"
        >
          <div className="space-y-3">
            <h2 className="text-lg font-medium text-black">{area.title}</h2>
            <p className="text-sm text-black/70">{area.description}</p>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-black/80">
            {area.items.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span aria-hidden className="mt-1 h-1.5 w-1.5 rounded-full bg-black/40" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>

    <footer className="rounded-xl border border-dashed border-black/20 bg-white/60 p-6 text-sm text-black/70">
      <p>
        These planning workflows depend on accurate event lifecycles, reviewer decisions, audit
        logging, and AI enrichment data. The analytics feed will expand as we ship automation and
        integrations over the next sprints.
      </p>
    </footer>
  </section>
);
}
