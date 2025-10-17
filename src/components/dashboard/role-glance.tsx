"use client";

import { useCurrentUser } from "@/components/providers/current-user-provider";

const roleDescriptions: Record<
  string,
  {
    title: string;
    message: string;
    checklist: string[];
  }
> = {
  hq_planner: {
    title: "HQ planner focus",
    message:
      "Monitor the new analytics feed, clear conflicts, and ensure reviewer coverage stays healthy across venues.",
    checklist: [
      "Run `npm run supabase:reset` to load overlapping event seeds locally.",
      "Review the conflict banner and planning feed before weekly stand-up.",
      "Reassign submissions lacking reviewer coverage to keep SLAs on track.",
    ],
  },
  reviewer: {
    title: "Reviewer focus",
    message:
      "The reviewer queue is live with SLA indicators—process submissions promptly and flag policy gaps.",
    checklist: [
      "Work the `/reviews` queue and add decision notes for the audit log.",
      "Escalate overdue submissions using the new SLA banner.",
      "Share any feedback on validation messages or assignment flows.",
    ],
  },
  venue_manager: {
    title: "Venue manager focus",
    message:
      "Draft creation is online—populate events early and review conflict warnings with your planner.",
    checklist: [
      "Compile recurring event details (talent, promotions, goals).",
      "Use the planning feed to avoid venue-space clashes.",
      "Nominate additional managers who need platform access.",
    ],
  },
  executive: {
    title: "Executive focus",
    message:
      "Executive dashboards are next. Expect planning metrics and digest previews once automation lands.",
    checklist: [
      "Review success metrics in the PRD to align expectations.",
      "Highlight priority KPIs for the upcoming executive digest.",
      "Share any analytics requirements not yet captured.",
    ],
  },
};

export function RoleGlance() {
  const currentUser = useCurrentUser();

  if (!currentUser?.role) {
    return null;
  }

  const role = currentUser.role;
  const roleContent = roleDescriptions[role];

  if (!roleContent) {
    return null;
  }

  return (
    <div className="rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-black">
          {roleContent.title}
        </h2>
        <p className="text-sm text-black/70">{roleContent.message}</p>
        <p className="text-xs uppercase tracking-wide text-black/50">
          Signed in as {currentUser.full_name ?? currentUser.email}
          {currentUser.region ? ` · Region: ${currentUser.region}` : ""}
        </p>
      </div>

      <ul className="mt-4 space-y-2 text-sm text-black/80">
        {roleContent.checklist.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <span
              aria-hidden
              className="mt-1 h-1.5 w-1.5 rounded-full bg-black/40"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
