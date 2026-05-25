export const TODO_DIGEST_FREQUENCIES = [
  "weekdays",
  "twice_weekly",
  "weekly",
  "fortnightly",
  "off",
] as const;

export type TodoDigestFrequency = typeof TODO_DIGEST_FREQUENCIES[number];

export const TODO_DIGEST_FREQUENCY_LABELS: Record<TodoDigestFrequency, string> = {
  weekdays: "Every weekday",
  twice_weekly: "Twice a week",
  weekly: "Every week",
  fortnightly: "Every two weeks",
  off: "Do not send",
};

export const TODO_DIGEST_FREQUENCY_DESCRIPTIONS: Record<TodoDigestFrequency, string> = {
  weekdays: "Monday to Friday",
  twice_weekly: "Monday and Thursday",
  weekly: "Monday",
  fortnightly: "Every other Monday",
  off: "No todo digest emails",
};

export function normaliseTodoDigestFrequency(value: unknown): TodoDigestFrequency {
  return TODO_DIGEST_FREQUENCIES.includes(value as TodoDigestFrequency)
    ? (value as TodoDigestFrequency)
    : "weekdays";
}

function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const from = Date.parse(`${fromIsoDate}T00:00:00Z`);
  const to = Date.parse(`${toIsoDate}T00:00:00Z`);
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function weekdayNumber(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

export function shouldSendTodoDigestToday(
  frequency: TodoDigestFrequency,
  todayIsoDate: string,
  lastSentOn: string | null | undefined
): boolean {
  if (frequency === "off" || lastSentOn === todayIsoDate) return false;

  const day = weekdayNumber(todayIsoDate);
  const isMonday = day === 1;
  const isThursday = day === 4;
  const isWeekday = day >= 1 && day <= 5;

  switch (frequency) {
    case "weekdays":
      return isWeekday;
    case "twice_weekly":
      return isMonday || isThursday;
    case "weekly":
      return isMonday;
    case "fortnightly":
      return isMonday && (!lastSentOn || daysBetween(lastSentOn, todayIsoDate) >= 14);
  }
}
