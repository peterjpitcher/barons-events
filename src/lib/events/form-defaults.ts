export type EventFormMode = "create" | "edit";

export function deriveEventFormVenueDefaults(input: {
  mode: EventFormMode;
  initialVenueId?: string | null;
  eventVenueId?: string | null;
  eventVenues?: Array<{ id: string }> | null;
  availableVenueIds: string[];
}): { primaryVenueId: string; selectedVenueIds: string[] } {
  const availableVenueIds = new Set(input.availableVenueIds);
  const validInitialVenueId =
    input.initialVenueId && availableVenueIds.has(input.initialVenueId) ? input.initialVenueId : "";

  if (input.mode === "create") {
    return {
      primaryVenueId: validInitialVenueId,
      selectedVenueIds: validInitialVenueId ? [validInitialVenueId] : []
    };
  }

  const attachedVenueIds = Array.isArray(input.eventVenues)
    ? input.eventVenues
        .map((venue) => venue.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const eventVenueId =
    input.eventVenueId && availableVenueIds.has(input.eventVenueId) ? input.eventVenueId : "";
  const primaryVenueId = attachedVenueIds[0] || eventVenueId || validInitialVenueId;

  return {
    primaryVenueId,
    selectedVenueIds: attachedVenueIds.length ? attachedVenueIds : primaryVenueId ? [primaryVenueId] : []
  };
}
