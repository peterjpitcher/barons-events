export type EventGoal = {
  value: string;
  label: string;
  helper: string;
};

export const EVENT_GOALS: EventGoal[] = [
  {
    value: "grow_sales",
    label: "Grow sales",
    helper: "Pick this when the event should bring in more sales or higher spend."
  },
  {
    value: "guest_data",
    label: "Drive guest data collection",
    helper: "Pick this when you want guests to sign up, share contact details, or answer a survey."
  },
  {
    value: "guest_engagement",
    label: "Drive guest engagement",
    helper: "Pick this when the main aim is to keep guests involved and enjoying the visit."
  },
  {
    value: "community",
    label: "Boost community presence",
    helper: "Pick this for charity nights, local groups, community events, or neighbourhood partnerships."
  },
  {
    value: "staff_development",
    label: "Staff development",
    helper: "Pick this when the event helps the team learn, practise, or build confidence."
  },
  {
    value: "brand_partnerships",
    label: "Strengthen brand partnerships",
    helper: "Pick this when a supplier or brand is involved and you want to build that relationship."
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
