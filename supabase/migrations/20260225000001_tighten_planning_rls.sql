-- Tighten planning workspace RLS policies.
--
-- Previous policies allowed any authenticated user to read and write all planning data.
-- Replace with policies that restrict writes to central_planner role and ensure all
-- reads require authentication (they already do, but now it's explicit per operation).

-- ── planning_series ──────────────────────────────────────────────────────────

drop policy if exists "planning series authenticated access" on public.planning_series;

create policy "planning series read by authenticated"
  on public.planning_series
  for select
  using (auth.role() = 'authenticated');

create policy "planning series write by planner"
  on public.planning_series
  for insert
  with check (public.current_user_role() = 'central_planner');

create policy "planning series update by planner"
  on public.planning_series
  for update
  using (public.current_user_role() = 'central_planner');

create policy "planning series delete by planner"
  on public.planning_series
  for delete
  using (public.current_user_role() = 'central_planner');

-- ── planning_items ───────────────────────────────────────────────────────────

drop policy if exists "planning items authenticated access" on public.planning_items;

create policy "planning items read by authenticated"
  on public.planning_items
  for select
  using (auth.role() = 'authenticated');

create policy "planning items write by planner"
  on public.planning_items
  for insert
  with check (public.current_user_role() = 'central_planner');

create policy "planning items update by planner"
  on public.planning_items
  for update
  using (public.current_user_role() = 'central_planner');

create policy "planning items delete by planner"
  on public.planning_items
  for delete
  using (public.current_user_role() = 'central_planner');

-- ── planning_series_task_templates ───────────────────────────────────────────

drop policy if exists "planning templates authenticated access" on public.planning_series_task_templates;

create policy "planning templates read by authenticated"
  on public.planning_series_task_templates
  for select
  using (auth.role() = 'authenticated');

create policy "planning templates write by planner"
  on public.planning_series_task_templates
  for insert
  with check (public.current_user_role() = 'central_planner');

create policy "planning templates update by planner"
  on public.planning_series_task_templates
  for update
  using (public.current_user_role() = 'central_planner');

create policy "planning templates delete by planner"
  on public.planning_series_task_templates
  for delete
  using (public.current_user_role() = 'central_planner');

-- ── planning_tasks ───────────────────────────────────────────────────────────

drop policy if exists "planning tasks authenticated access" on public.planning_tasks;

create policy "planning tasks read by authenticated"
  on public.planning_tasks
  for select
  using (auth.role() = 'authenticated');

create policy "planning tasks write by planner"
  on public.planning_tasks
  for insert
  with check (public.current_user_role() = 'central_planner');

create policy "planning tasks update by planner"
  on public.planning_tasks
  for update
  using (public.current_user_role() = 'central_planner');

create policy "planning tasks delete by planner"
  on public.planning_tasks
  for delete
  using (public.current_user_role() = 'central_planner');
