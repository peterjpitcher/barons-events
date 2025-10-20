export type EventGoal = {
  value: string;
  label: string;
  helper: string;
};

export const EVENT_GOALS: EventGoal[] = [
  {
    value: "grow_sales",
    label: "Grow sales",
    helper: "Use when the event aims to increase revenue or average spend."
  },
  {
    value: "guest_data",
    label: "Drive guest data collection",
    helper: "Perfect for loyalty sign-ups, email capture, or surveys."
  },
  {
    value: "guest_engagement",
    label: "Drive guest engagement",
    helper: "Focus on keeping guests entertained and staying longer."
  },
  {
    value: "community",
    label: "Boost community presence",
    helper: "Charity nights, local partnerships, or neighbourhood outreach."
  },
  {
    value: "staff_development",
    label: "Staff development",
    helper: "Training sessions or shadows that build team skills."
  },
  {
    value: "brand_partnerships",
    label: "Strengthen brand partnerships",
    helper: "Supplier collaborations, co-branded promotions, or launches."
  }
];

export const EVENT_GOALS_BY_VALUE: Record<string, EventGoal> = EVENT_GOALS.reduce(
  (acc, goal) => {
    acc[goal.value] = goal;
    return acc;
  },
  {} as Record<string, EventGoal>
);

export function parseGoalFocus(goalFocus: string | null | undefined): string[] {
  return (goalFocus ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function humanizeGoalValue(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
