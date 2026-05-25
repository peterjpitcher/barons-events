import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1), // required — admin client throws without it
  CRON_SECRET: z.string().min(32).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  BARONSHUB_WEBSITE_API_KEY: z.string().min(16).optional(),
  BOOKING_UPDATE_TOKEN_SECRET: z.string().min(32).optional()
}).superRefine((env, ctx) => {
  if (process.env.NODE_ENV !== "production") return;

  const requiredInProduction = [
    "CRON_SECRET",
    "TURNSTILE_SECRET_KEY",
    "BARONSHUB_WEBSITE_API_KEY",
    "BOOKING_UPDATE_TOKEN_SECRET",
  ] as const;

  for (const key of requiredInProduction) {
    if (!env[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required in production`
      });
    }
  }
});

export function getEnv() {
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    BARONSHUB_WEBSITE_API_KEY: process.env.BARONSHUB_WEBSITE_API_KEY,
    BOOKING_UPDATE_TOKEN_SECRET: process.env.BOOKING_UPDATE_TOKEN_SECRET
  });

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((err) => err.path.join("."))
      .join(", ");
    throw new Error(`Missing required environment variables: ${missing}`);
  }

  return parsed.data;
}
