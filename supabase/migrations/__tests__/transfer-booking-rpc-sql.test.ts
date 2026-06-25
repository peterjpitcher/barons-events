import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260625130000_fix_transfer_booking_idempotency_race.sql"),
  "utf8"
);

describe("transfer_booking RPC race fix", () => {
  it("re-checks the idempotency row after locking the source booking", () => {
    const sourceLock = migration.indexOf("where id = p_source_booking_id\n  for update;");
    const secondIdempotencyCheck = migration.indexOf(
      "from public.booking_transfers\n  where idempotency_key = p_idempotency_key;",
      sourceLock
    );

    expect(sourceLock).toBeGreaterThan(-1);
    expect(secondIdempotencyCheck).toBeGreaterThan(sourceLock);
    expect(migration).toContain("if v_src.id is null then raise exception 'source_booking_not_found'; end if;");
  });

  it("keeps the RPC locked down to service_role only", () => {
    expect(migration).toContain("revoke all on function public.transfer_booking(uuid, uuid, uuid, text, text) from public;");
    expect(migration).toContain("revoke all on function public.transfer_booking(uuid, uuid, uuid, text, text) from anon;");
    expect(migration).toContain("revoke all on function public.transfer_booking(uuid, uuid, uuid, text, text) from authenticated;");
    expect(migration).toContain("grant execute on function public.transfer_booking(uuid, uuid, uuid, text, text) to service_role;");
  });
});
