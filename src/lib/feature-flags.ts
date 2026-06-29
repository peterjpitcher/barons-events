import "server-only";

function normaliseEnv(value: string | undefined): string {
  const normalised = (value ?? "").trim().replace(/^['"]|['"]$/g, "").trim().toLowerCase();
  return normalised;
}

export function isEventRescheduleEnabled(): boolean {
  // Reschedule is live. Keep the env var as a kill switch only.
  return !["false", "0", "no", "n", "off", "disabled"].includes(normaliseEnv(process.env.EVENT_RESCHEDULE_ENABLED));
}
