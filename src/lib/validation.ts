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
const requiredText = (min: number, max: number, emptyMessage: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      return value.trim();
    },
    z.string().min(min, emptyMessage).max(max)
  );
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

const optionalHighlights = z.preprocess((value) => {
  if (typeof value === "string") {
    const items = value
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  }
  if (Array.isArray(value)) {
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  }
  return value;
}, z.array(z.string().min(2).max(120)).max(6).optional());

const isoDateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Use a valid date and time"
  });

const bookingTypeValues = ["ticketed", "table_booking", "free_entry", "mixed"] as const;

const optionalBookingType = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  },
  z.enum(bookingTypeValues).optional()
);

const bookingUrlSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  },
  z.string().url("Use a full URL (including https://)").optional()
);

const seoSlugSchema = z.preprocess(
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
);

const eventDraftBaseSchema = z.object({
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
  bookingType: optionalBookingType,
  ticketPrice: optionalNumberMin(0),
  checkInCutoffMinutes: optionalInteger(0, 1440),
  agePolicy: optionalText(120),
  accessibilityNotes: optionalText(1000),
  cancellationWindowHours: optionalInteger(0, 720),
  termsAndConditions: optionalText(3000),
  artistNames: optionalText(1000),
  goalFocus: optionalText(120),
  notes: optionalText(3000),
  publicTitle: optionalText(120),
  publicTeaser: optionalText(200),
  publicDescription: optionalText(6000),
  publicHighlights: optionalHighlights,
  bookingUrl: bookingUrlSchema,
  seoTitle: optionalText(80),
  seoDescription: optionalText(200),
  seoSlug: seoSlugSchema
});

export const eventDraftSchema = eventDraftBaseSchema;

export const eventFormSchema = eventDraftBaseSchema
  .extend({
    bookingType: z.enum(bookingTypeValues, { message: "Choose a booking format" }),
    agePolicy: requiredText(2, 120, "Add an age policy")
  })
  .superRefine((values, ctx) => {
    if (values.bookingType === "ticketed" && values.ticketPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add ticket price for ticketed events",
        path: ["ticketPrice"]
      });
    }
    if (values.bookingType !== "free_entry" && values.cancellationWindowHours === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add a cancellation/refund window in hours",
        path: ["cancellationWindowHours"]
      });
    }
  });

export const decisionSchema = z.object({
  eventId: z.string().uuid(),
  decision: z.enum(["approved", "needs_revisions", "rejected"]),
  feedback: z.string().max(1000).optional()
});

export const debriefSchema = z.object({
  eventId: z.string().uuid(),
  attendance: optionalInteger(0, 100000),
  baselineAttendance: optionalInteger(0, 100000),
  wetTakings: optionalNumberMin(0),
  foodTakings: optionalNumberMin(0),
  baselineWetTakings: optionalNumberMin(0),
  baselineFoodTakings: optionalNumberMin(0),
  promoEffectiveness: optionalInteger(1, 5),
  highlights: optionalText(1000),
  issues: optionalText(1000),
  guestSentimentNotes: optionalText(2000),
  operationalNotes: optionalText(2000),
  wouldBookAgain: z.preprocess(
    (value) => {
      if (typeof value !== "string") return undefined;
      if (value === "yes") return true;
      if (value === "no") return false;
      return undefined;
    },
    z.boolean().optional()
  ),
  nextTimeActions: optionalText(2000)
});
