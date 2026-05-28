alter table public.planning_series
  add column if not exists sop_not_required_template_ids uuid[] not null default '{}'::uuid[];

comment on column public.planning_series.sop_not_required_template_ids is
  'SOP task template IDs that should be marked not_required on every generated occurrence.';
