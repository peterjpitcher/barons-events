alter table "public"."events" add column if not exists "cost_total" numeric;
alter table "public"."events" add column if not exists "cost_details" text;

notify pgrst, 'reload schema';
