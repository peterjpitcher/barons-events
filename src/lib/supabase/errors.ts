type ErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  name?: string;
};

function asErrorLike(error: unknown): ErrorLike {
  if (!error || typeof error !== "object") return {};
  return error as ErrorLike;
}

export function serialiseSupabaseError(error: unknown): ErrorLike | unknown {
  if (!error || typeof error !== "object") return error;
  const err = asErrorLike(error);
  return {
    name: err.name,
    code: err.code,
    message: err.message,
    details: err.details,
    hint: err.hint
  };
}

function errorText(error: unknown): string {
  const err = asErrorLike(error);
  return [
    err.code,
    err.message,
    err.details,
    err.hint,
    typeof error === "string" ? error : ""
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isMissingColumnError(error: unknown, columnName: string): boolean {
  const text = errorText(error);
  const column = columnName.toLowerCase();
  return (
    text.includes(column) &&
    (
      text.includes("could not find") ||
      text.includes("schema cache") ||
      text.includes("does not exist") ||
      text.includes("undefined column") ||
      text.includes("pgrst204") ||
      text.includes("42703")
    )
  );
}

export function isMissingRelationError(error: unknown, relationName: string): boolean {
  const text = errorText(error);
  const relation = relationName.toLowerCase();
  return (
    text.includes(relation) &&
    (
      text.includes("could not find") ||
      text.includes("schema cache") ||
      text.includes("does not exist") ||
      text.includes("undefined table") ||
      text.includes("pgrst200") ||
      text.includes("pgrst205") ||
      text.includes("42p01")
    )
  );
}
