import type { ZodError } from "zod";

export type FieldErrors = Partial<Record<string, string>>;

export function getFieldErrors(error: ZodError): FieldErrors {
  const flattened = error.flatten();
  const fieldErrors: FieldErrors = {};

  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    const message = Array.isArray(messages) ? messages[0] : undefined;
    if (typeof message === "string" && message.length) {
      fieldErrors[field] = message;
    }
  }

  return fieldErrors;
}
