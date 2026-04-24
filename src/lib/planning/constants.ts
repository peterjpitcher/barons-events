/** Sentinel UUID for "Manager Responsible" — resolves to events.manager_responsible_id at generation time. */
export const ROLE_MANAGER_RESPONSIBLE = "00000000-0000-0000-0000-000000000001";

/** Sentinel UUID for "Event Creator" — resolves to events.created_by at generation time. */
export const ROLE_EVENT_CREATOR = "00000000-0000-0000-0000-000000000002";

export const DYNAMIC_ROLE_LABELS: Record<string, string> = {
  [ROLE_MANAGER_RESPONSIBLE]: "Manager Responsible",
  [ROLE_EVENT_CREATOR]: "Event Creator",
};

/** All sentinel IDs as a Set for fast lookup. */
export const DYNAMIC_ROLE_IDS = new Set([ROLE_MANAGER_RESPONSIBLE, ROLE_EVENT_CREATOR]);

/** Returns true if the given ID is a dynamic role sentinel, not a real user. */
export function isDynamicRole(id: string): boolean {
  return DYNAMIC_ROLE_IDS.has(id);
}

/** Returns the human label for a dynamic role, or undefined for real user IDs. */
export function dynamicRoleLabel(id: string): string | undefined {
  return DYNAMIC_ROLE_LABELS[id];
}
