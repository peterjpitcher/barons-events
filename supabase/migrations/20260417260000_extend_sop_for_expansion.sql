-- =============================================================================
-- Wave 4.1a — SOP template expansion columns
-- =============================================================================
-- expansion_strategy: 'single' (one task per template) or 'per_venue' (one
-- master + one child per matching venue).
-- venue_filter: NULL for single tasks; 'all' | 'pub' | 'cafe' for per_venue.
-- =============================================================================

alter table public.sop_task_templates
  add column if not exists expansion_strategy text not null default 'single'
    check (expansion_strategy in ('single', 'per_venue'));

alter table public.sop_task_templates
  add column if not exists venue_filter text default null
    check (venue_filter is null or venue_filter in ('all', 'pub', 'cafe'));

alter table public.sop_task_templates
  add constraint sop_task_template_venue_filter_coherent check (
    (expansion_strategy = 'single' and venue_filter is null)
    or (expansion_strategy = 'per_venue' and venue_filter is not null)
  );

notify pgrst, 'reload schema';
