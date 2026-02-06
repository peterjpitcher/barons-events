import { z } from "zod";

const trimmedStringOrUndefined = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  },
  z.string().optional()
);

const optionalText = (max: number) => trimmedStringOrUndefined.pipe(z.string().max(max).optional());
const normaliseOptionalNumber = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
};

const optionalInteger = (min: number, max: number) =>
  z.preprocess(normaliseOptionalNumber, z.number().int().min(min).max(max).optional());

const optionalNumberMin = (min: number) =>
  z.preprocess(normaliseOptionalNumber, z.number().min(min).optional());

const isoDateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Use a valid date and time"
  });

export const eventFormSchema = z.object({
  eventId: z.string().uuid().optional(),
  venueId: z.string().uuid({ message: "Choose a venue" }),
  title: z.string().min(3, "Add a short title"),
  eventType: z.string().min(3, "Pick an event type"),
  startAt: isoDateString,
  endAt: isoDateString,
  venueSpace: z.string().min(2, "Add the area"),
  expectedHeadcount: optionalInteger(0, 10000),
  wetPromo: optionalText(240),
  foodPromo: optionalText(240),
  costTotal: optionalNumberMin(0),
  costDetails: optionalText(500),
  goalFocus: optionalText(120),
  notes: optionalText(3000),
  publicTitle: optionalText(120),
  publicTeaser: optionalText(200),
  publicDescription: optionalText(6000),
  bookingUrl: z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : undefined;
    },
    z.string().url("Use a full URL (including https://)").optional()
  ),
  seoTitle: optionalText(80),
  seoDescription: optionalText(200),
  seoSlug: z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : undefined;
    },
    z
      .string()
      .max(140)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens")
      .optional()
  )
});

export const decisionSchema = z.object({
  eventId: z.string().uuid(),
  decision: z.enum(["approved", "needs_revisions", "rejected"]),
  feedback: z.string().max(1000).optional()
});

export const debriefSchema = z.object({
  eventId: z.string().uuid(),
  attendance: optionalInteger(0, 100000),
  wetTakings: optionalNumberMin(0),
  foodTakings: optionalNumberMin(0),
  promoEffectiveness: optionalInteger(1, 5),
  highlights: optionalText(1000),
  issues: optionalText(1000)
});
