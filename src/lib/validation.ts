import { z } from "zod";

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
  wetPromo: z.string().max(240).optional(),
  foodPromo: z.string().max(240).optional(),
  goalFocus: z.string().max(120).optional(),
  notes: z.string().max(1000).optional()
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
