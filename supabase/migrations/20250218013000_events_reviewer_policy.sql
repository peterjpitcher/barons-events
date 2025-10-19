create policy "events reviewers manage assigned"
  on public.events
  for update
  using (auth.uid() = assigned_reviewer_id)
  with check (
    auth.uid() = assigned_reviewer_id
    and status in ('submitted','needs_revisions','approved','rejected')
  );
