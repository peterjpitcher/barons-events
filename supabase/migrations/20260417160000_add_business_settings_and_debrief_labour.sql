-- =============================================================================
-- Wave 1.4 — Labour hours + editable rate
-- =============================================================================
-- Adds:
--   - business_settings singleton table (id boolean PK ensures exactly one row)
--   - labour_rate_gbp column (seeded to £12.71, administrator-editable)
--   - debriefs.labour_hours + debriefs.labour_rate_gbp_at_submit
-- Future sensitive columns go in a separate private_business_settings table.
-- =============================================================================

-- ── 1. business_settings singleton ─────────────────────────────────────
create table if not exists public.business_settings (
  id               boolean primary key default true check (id = true),
  labour_rate_gbp  numeric(6,2) not null default 12.71
                     check (labour_rate_gbp > 0 and labour_rate_gbp <= 999.99),
  updated_by       uuid references public.users(id) on delete set null,
  updated_at       timestamptz not null default timezone('utc', now())
);

insert into public.business_settings (id) values (true) on conflict (id) do nothing;

create trigger trg_business_settings_updated
  before update on public.business_settings
  for each row execute function public.set_updated_at();

alter table public.business_settings enable row level security;

-- Read: any authenticated user (rate preview in debrief form is not sensitive).
create policy business_settings_read_authenticated on public.business_settings
  for select to authenticated using (true);

-- Write: administrator only.
create policy business_settings_write_admin on public.business_settings
  for update to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

-- ── 2. Debrief columns ─────────────────────────────────────────────────
alter table public.debriefs
  add column if not exists labour_hours numeric(6,2)
    check (labour_hours is null or (labour_hours >= 0 and labour_hours <= 2000));

alter table public.debriefs
  add column if not exists labour_rate_gbp_at_submit numeric(6,2);

notify pgrst, 'reload schema';
