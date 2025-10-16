export type DraftDiff = Array<{
  field: string;
  before: unknown;
  after: unknown;
}>;

const IGNORED_FIELDS = new Set([
  "id",
  "created_at",
  "updated_at",
  "version",
  "submitted_at",
  "submitted_by",
  "cloned_at",
  "cloned_from",
]);

type Snapshot = Record<string, unknown> | null | undefined;

type DiffOptions = {
  ignoredFields?: string[];
};

export function diffSnapshot(
  before: Snapshot,
  after: Snapshot,
  options: DiffOptions = {}
): DraftDiff {
  const ignored = new Set([...IGNORED_FIELDS, ...(options.ignoredFields ?? [])]);

  if (!before && !after) {
    return [];
  }

  const beforeRecord = before ?? {};
  const afterRecord = after ?? {};

  const fields = new Set([
    ...Object.keys(beforeRecord as Record<string, unknown>),
    ...Object.keys(afterRecord as Record<string, unknown>),
  ]);

  const changes: DraftDiff = [];

  for (const field of fields) {
    if (ignored.has(field)) {
      continue;
    }

    const previous = (beforeRecord as Record<string, unknown>)[field];
    const current = (afterRecord as Record<string, unknown>)[field];

    const normalisedPrevious = normaliseValue(previous);
    const normalisedCurrent = normaliseValue(current);

    if (!isEqual(normalisedPrevious, normalisedCurrent)) {
      changes.push({
        field,
        before: normalisedPrevious,
        after: normalisedCurrent,
      });
    }
  }

  return changes;
}

const normaliseValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => normaliseValue(entry)).sort();
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => [key, normaliseValue(val)] as const)
      .sort(([a], [b]) => a.localeCompare(b));

    return Object.fromEntries(entries);
  }

  return value;
};

const isEqual = (left: unknown, right: unknown): boolean => {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((entry, index) => isEqual(entry, right[index]));
  }

  if (left && typeof left === "object" && right && typeof right === "object") {
    const leftEntries = Object.entries(left as Record<string, unknown>);
    const rightEntries = Object.entries(right as Record<string, unknown>);

    if (leftEntries.length !== rightEntries.length) return false;

    return leftEntries.every(([key, value]) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      isEqual(value, (right as Record<string, unknown>)[key])
    );
  }

  return left === right;
};
