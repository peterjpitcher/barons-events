alter table "public"."events"
  add column if not exists "public_title" text,
  add column if not exists "public_description" text,
  add column if not exists "public_teaser" text,
  add column if not exists "booking_url" text,
  add column if not exists "seo_title" text,
  add column if not exists "seo_description" text,
  add column if not exists "seo_slug" text;

notify pgrst, 'reload schema';

