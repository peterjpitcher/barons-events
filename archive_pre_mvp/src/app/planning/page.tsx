import { getCurrentUserProfile } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GoalManager } from "@/components/planning/goal-manager";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";

type GoalRecord = {
  id: string;
  label: string;
  description: string | null;
  active: boolean;
  created_at: string | null;
};

export default async function PlanningPage() {
  const profile = await getCurrentUserProfile();
  const isCentralPlanner = profile?.role === "central_planner";

  let goals: GoalRecord[] = [];
  let goalError: string | null = null;

  if (isCentralPlanner) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("goals")
      .select("id,label,description,active,created_at")
      .order("label", { ascending: true });

    if (error) {
      goalError = error.message ?? "Unable to load goals catalogue.";
    } else {
      goals = (data ?? []) as GoalRecord[];
    }
  }

  return (
    <section className="space-y-10">
      <PageHeader
        eyebrow="Planning ops"
        title="Planning workspace"
        description="Keep the planning team aligned on strategic goals and adjustments without the extra dashboards."
      />

      {!isCentralPlanner ? (
        <Alert
          variant="neutral"
          title="Central planners only"
          description="Planning tools are reserved for the central planning team. Ask a planner to share updates if you need insight."
        />
      ) : goalError ? (
        <Alert
          variant="danger"
          title="Unable to load goals"
          description={goalError}
        />
      ) : (
        <GoalManager goals={goals} />
      )}
    </section>
  );
}
