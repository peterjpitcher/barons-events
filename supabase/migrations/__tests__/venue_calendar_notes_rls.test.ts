import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const MGR_A_JWT = process.env.SUPABASE_OW_JWT ?? "";           // manager, venue A
const MGR_B_JWT = process.env.SUPABASE_OTHER_OW_JWT ?? "";      // manager, venue B
const MGR_NONE_JWT = process.env.SUPABASE_OW_NO_VENUE_JWT ?? ""; // manager, no venue
const ADMIN_JWT = process.env.SUPABASE_ADMIN_JWT ?? "";

const RUN = process.env.RUN_SUPABASE_MIGRATION_TESTS === "1";
const shouldRun = RUN && [SUPABASE_URL, SERVICE_ROLE, ANON, MGR_A_JWT, MGR_B_JWT, MGR_NONE_JWT, ADMIN_JWT].every(Boolean);
const describeFn = shouldRun ? describe : describe.skip;

function service(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
}
function asJwt(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describeFn("migration: venue_calendar_notes RLS", () => {
  // Constructed inside beforeAll (not at collection time) so the suite skips
  // cleanly when env is unset instead of throwing on an empty Supabase URL.
  let admin: SupabaseClient;
  let venueA = "";
  let venueB = "";
  let managerAId = "";
  const created: string[] = [];

  beforeAll(async () => {
    admin = service();
    const { data: mgrA } = await admin.auth.getUser(MGR_A_JWT);
    managerAId = mgrA.user?.id ?? "";
    const { data: prof } = await admin.from("users").select("venue_id").eq("id", managerAId).single();
    venueA = prof?.venue_id ?? "";
    const { data: mgrB } = await admin.auth.getUser(MGR_B_JWT);
    const { data: profB } = await admin.from("users").select("venue_id").eq("id", mgrB.user?.id ?? "").single();
    venueB = profB?.venue_id ?? "";
  });

  afterAll(async () => {
    if (!shouldRun) return;
    for (const id of created) {
      await admin.from("venue_calendar_notes").delete().eq("id", id);
    }
  });

  it("lets a venue-A manager insert a note for venue A", async () => {
    const { data, error } = await asJwt(MGR_A_JWT)
      .from("venue_calendar_notes")
      .insert({ venue_id: venueA, start_date: "2026-08-01", title: "Wedding", created_by: managerAId })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (data?.id) created.push(data.id);
    expect(data?.id).toBeTruthy();
  });

  it("stops a venue-A manager inserting a note for venue B", async () => {
    const { error } = await asJwt(MGR_A_JWT)
      .from("venue_calendar_notes")
      .insert({ venue_id: venueB, start_date: "2026-08-01", title: "Nope", created_by: managerAId })
      .select("id")
      .single();
    expect(error).toBeTruthy();
  });

  it("stops a manager without a venue inserting any note", async () => {
    const { error } = await asJwt(MGR_NONE_JWT)
      .from("venue_calendar_notes")
      .insert({ venue_id: venueA, start_date: "2026-08-01", title: "Nope" })
      .select("id")
      .single();
    expect(error).toBeTruthy();
  });

  it("lets an administrator insert a note for any venue", async () => {
    const { data, error } = await asJwt(ADMIN_JWT)
      .from("venue_calendar_notes")
      .insert({ venue_id: venueB, start_date: "2026-08-02", title: "Admin note" })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (data?.id) created.push(data.id);
  });

  it("hides soft-deleted notes from reads", async () => {
    const { data } = await admin
      .from("venue_calendar_notes")
      .insert({ venue_id: venueA, start_date: "2026-08-03", title: "To hide" })
      .select("id")
      .single();
    if (data?.id) {
      created.push(data.id);
      await admin.from("venue_calendar_notes").update({ deleted_at: new Date().toISOString() }).eq("id", data.id);
      const { data: visible } = await asJwt(MGR_A_JWT).from("venue_calendar_notes").select("id").eq("id", data.id);
      expect(visible ?? []).toHaveLength(0);
    }
  });
});
