export function parseVenueSpaces(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatSpacesLabel(value: string | null | undefined): string {
  const spaces = parseVenueSpaces(value);
  if (spaces.length === 0) {
    return "Space: Not specified";
  }
  const label = spaces.length > 1 ? "Spaces" : "Space";
  return `${label}: ${spaces.join(", ")}`;
}
