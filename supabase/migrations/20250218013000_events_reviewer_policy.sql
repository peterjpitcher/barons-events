create policy "events assignees manage assigned"
  on public.events
  for update
  using (auth.uid() = assignee_id)
  with check (
    auth.uid() = assignee_id
    and status in ('submitted','needs_revisions','approved','rejected')
  );
