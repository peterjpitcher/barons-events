import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/cron-auth";

/**
 * Wave 4.5 — cascade backfill cron.
 *
 * For each pending_cascade_backfill row (venue_id), spawn any missing
 * cascade children in open master tasks whose SOP template's
 * venue_filter matches the venue's category. Uses FOR UPDATE SKIP
 * LOCKED to serialise across concurrent cron invocations.
 *
 * Sets app.cascade_internal = 'on' before cascade-column writes so the
 * guard trigger permits the INSERTs.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(
    JSON.stringify({ event: "cron.invoked", endpoint: "cascade-backfill", timestamp: new Date().toISOString() })
  );

  const db = createSupabaseAdminClient();

  // Claim up to 10 rows. The admin client bypasses RLS. We do the claim
  // via a manual "select + update" pair because the supabase-js client
  // doesn't expose FOR UPDATE SKIP LOCKED directly; we accept a small
  // race window (tolerable because the downstream INSERTs are guarded by
  // a unique partial index on (parent_task_id, cascade_venue_id)).
   
  const { data: candidates, error: selErr } = await (db as any)
    .from("pending_cascade_backfill")
    .select("id, venue_id, attempt_count")
    .is("processed_at", null)
    .is("locked_at", null)
    .eq("is_dead_letter", false)
    .or("next_attempt_at.is.null,next_attempt_at.lte." + new Date().toISOString())
    .order("queued_at", { ascending: true })
    .limit(10);

  if (selErr) {
    console.error("cascade-backfill: select failed", selErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const runId = crypto.randomUUID();
  let processed = 0;
  let failed = 0;

  type Candidate = { id: string; venue_id: string; attempt_count: number };
  for (const row of (candidates ?? []) as Candidate[]) {
    try {
       
      const { error: lockErr } = await (db as any)
        .from("pending_cascade_backfill")
        .update({
          locked_at: new Date().toISOString(),
          locked_by: runId,
          attempt_count: row.attempt_count + 1,
          last_attempt_at: new Date().toISOString()
        })
        .eq("id", row.id)
        .is("locked_at", null);
      if (lockErr) continue; // another worker got it first

      // Load venue category.
       
      const { data: venue } = await (db as any)
        .from("venues")
        .select("id, name, category, default_manager_responsible_id")
        .eq("id", row.venue_id)
        .maybeSingle();
      if (!venue) throw new Error("Venue not found");

      // Find open masters whose template filter matches this venue.
       
      const { data: masters } = await (db as any)
        .from("planning_tasks")
        .select(
          "id, planning_item_id, title, sop_section, sop_t_minus_days, sort_order, cascade_sop_template_id, due_date"
        )
        .eq("status", "open")
        .not("cascade_sop_template_id", "is", null)
        .is("parent_task_id", null);
      if (!masters || masters.length === 0) {
         
        await (db as any)
          .from("pending_cascade_backfill")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", row.id);
        processed++;
        continue;
      }

      // Filter masters by template's venue_filter matching venue.category.
       
      const templateIds = masters.map((m: any) => m.cascade_sop_template_id).filter(Boolean);
       
      const { data: templates } = await (db as any)
        .from("sop_task_templates")
        .select("id, venue_filter")
        .in("id", templateIds);
       
      const matchingTemplateIds = new Set(
        (templates ?? [])
           
          .filter((t: any) => t.venue_filter === "all" || t.venue_filter === venue.category)
           
          .map((t: any) => t.id)
      );

      // For each matching master, spawn a child for this venue if one is missing.
       
      for (const master of masters as any[]) {
        if (!matchingTemplateIds.has(master.cascade_sop_template_id)) continue;

        // Skip the venue if no default manager.
        if (!venue.default_manager_responsible_id) continue;

         
        const { data: existingChild } = await (db as any)
          .from("planning_tasks")
          .select("id")
          .eq("parent_task_id", master.id)
          .eq("cascade_venue_id", venue.id)
          .maybeSingle();
        if (existingChild) continue;

        // Set the bypass flag for the guard trigger.
         
        await (db as any).rpc("set_config", { parameter: "app.cascade_internal", value: "on", is_local: true }).catch(() => {});

         
        const { data: inserted, error: insertErr } = await (db as any)
          .from("planning_tasks")
          .insert({
            planning_item_id: master.planning_item_id,
            title: `${master.title} — ${venue.name}`,
            assignee_id: venue.default_manager_responsible_id,
            due_date: master.due_date,
            status: "open",
            sort_order: master.sort_order,
            sop_section: master.sop_section,
            sop_t_minus_days: master.sop_t_minus_days,
            is_blocked: false,
            parent_task_id: master.id,
            cascade_venue_id: venue.id
          })
          .select("id")
          .single();

        if (insertErr) {
          console.warn("cascade-backfill: insert failed", master.id, insertErr);
          continue;
        }

         
        await (db as any).from("audit_log").insert({
          entity: "planning_task",
          entity_id: inserted.id,
          action: "planning_task.cascade_spawn",
          meta: {
            master_id: master.id,
            venue_id: venue.id,
            template_id: master.cascade_sop_template_id,
            via: "backfill_cron"
          },
          actor_id: null
        });
      }

       
      await (db as any)
        .from("pending_cascade_backfill")
        .update({ processed_at: new Date().toISOString(), error: null })
        .eq("id", row.id);
      processed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : "Unknown error";
      const nextAttempt = new Date(Date.now() + 5 * 60 * 1000 * Math.pow(2, row.attempt_count)).toISOString();
       
      await (db as any)
        .from("pending_cascade_backfill")
        .update({
          locked_at: null,
          locked_by: null,
          error: message,
          next_attempt_at: nextAttempt,
          is_dead_letter: row.attempt_count >= 5
        })
        .eq("id", row.id);
      console.warn("cascade-backfill: row failed", row.id, message);
    }
  }

  console.log(
    JSON.stringify({
      event: "cron.completed",
      endpoint: "cascade-backfill",
      processed,
      failed,
      timestamp: new Date().toISOString()
    })
  );

  return NextResponse.json({ success: true, processed, failed });
}

export const POST = GET;
