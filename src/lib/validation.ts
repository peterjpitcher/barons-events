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
  expectedHeadcount: z
    .union([z.coerce.number().int().min(0).max(10000), z.undefined(), z.null()])
    .optional(),
  wetPromo: optionalText(240),
  foodPromo: optionalText(240),
  costTotal: z.coerce.number().min(0).optional(),
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
  attendance: z.union([z.coerce.number().int().min(0).max(100000), z.undefined(), z.null()]).optional(),
  wetTakings: z.union([z.coerce.number().nonnegative(), z.undefined(), z.null()]).optional(),
  foodTakings: z.union([z.coerce.number().nonnegative(), z.undefined(), z.null()]).optional(),
  promoEffectiveness: z.union([z.coerce.number().int().min(1).max(5), z.undefined(), z.null()]).optional(),
  highlights: z.string().max(1000).optional(),
  issues: z.string().max(1000).optional()
});
