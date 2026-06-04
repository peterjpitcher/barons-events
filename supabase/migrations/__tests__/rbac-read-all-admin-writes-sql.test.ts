import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260604150000_baronshub_rbac_read_all_admin_writes.sql"),
  "utf8"
);

const allAppRoles = "public.current_user_role() in ('administrator', 'office_worker', 'executive')";

describe("rbac read-all/admin-writes migration", () => {
  it("makes event and planning visibility global for app roles", () => {
    expect(migration).toContain("create or replace function public.event_visible_to_current_user");
    expect(migration).toContain("create or replace function public.planning_item_visible_to_current_user");
    expect(migration).toContain("return v_role in ('administrator', 'office_worker', 'executive')");
    expect(migration).toContain("create policy \"events_select_policy\"");
    expect(migration).toContain(allAppRoles);
  });

  it("removes legacy event write grants and enforces admin writes with a trigger", () => {
    expect(migration).toContain('drop policy if exists "managers create events" on public.events');
    expect(migration).toContain('drop policy if exists "office workers insert scoped events" on public.events');
    expect(migration).toContain('drop policy if exists "managers update editable events" on public.events');
    expect(migration).toContain("create or replace function public.events_require_admin_or_service_write()");
    expect(migration).toContain("before insert or update on public.events");
    expect(migration).toContain("Only administrators can create or edit events");
    expect(migration).not.toMatch(/current_user_role\(\)\s*=\s*'office_worker'/i);
    expect(migration).not.toMatch(/v_role\s*=\s*'office_worker'/i);
    expect(migration).not.toMatch(/=\s*'central_planner'/i);
  });

  it("keeps Operations and Manage reads open while making core writes admin-only", () => {
    expect(migration).toContain('create policy "event_bookings_read_all_app_roles"');
    expect(migration).toContain('create policy "customers_read_all_app_roles"');
    expect(migration).toContain('create policy "artists_read_all_app_roles"');
    expect(migration).toContain("create policy users_read_all_app_roles");
    expect(migration).toContain("create policy slt_members_read_all_app_roles");
    expect(migration).toContain('create policy "sop sections readable by app roles"');

    expect(migration).toContain('create policy "event_bookings_update_admin"');
    expect(migration).toContain('create policy "artists_write_admin"');
    expect(migration).toMatch(/create policy "event_bookings_update_admin"[\s\S]*with check \(public\.current_user_role\(\) = 'administrator'\)/);
    expect(migration).toMatch(/create policy "artists_write_admin"[\s\S]*with check \(public\.current_user_role\(\) = 'administrator'\)/);

    expect(migration).toContain('create policy "admins manage users"');
    expect(migration).toContain('create policy "admins manage venues"');
    expect(migration).toContain('create policy "event types managed by admins"');
    expect(migration).toContain('create policy "Admins can manage service types"');
    expect(migration).toContain('create policy "Admins can manage opening hours"');
    expect(migration).toContain('create policy "Admins can manage opening overrides"');
    expect(migration).toContain('create policy "Admins can manage override venues"');
    expect(migration).toContain('create policy "Admins can manage venue services"');
    expect(migration).toContain('create policy "Admins can manage short links"');
    expect(migration).toContain("create policy business_settings_write_admin");
    expect(migration).toContain("create policy slt_members_write_admin");
    expect(migration).toContain('create policy "sop sections managed by admins"');
    expect(migration).toContain('create policy "sop task templates managed by admins"');
    expect(migration).toContain('create policy "sop task dependencies managed by admins"');
  });

  it("blocks non-admin direct edits to event child records", () => {
    expect(migration).toContain('create policy "versions insert by admins"');
    expect(migration).toContain('create policy "event artists managed by admins"');
    expect(migration).toContain("create or replace function public.event_attachment_requires_admin_or_service()");
    expect(migration).toContain("create or replace function public.event_attachment_version_requires_admin_or_service()");
    expect(migration).toContain("create or replace function public.event_internal_note_requires_admin_or_service()");
    expect(migration).toContain("Only administrators can edit event attachments");
    expect(migration).toContain("Only administrators can edit event notes");
  });
});
