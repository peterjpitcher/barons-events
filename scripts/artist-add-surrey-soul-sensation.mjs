import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  const text = fs.readFileSync(path, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const env = loadEnv(".env.local");
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const eventIds = [
  "776c6f09-d773-469e-b9a5-4c5686e0434a",
  "ed459482-9ef4-42aa-a99e-ee43db617b96",
  "6c7e85da-e9a6-495b-b1b6-32613bbd35ec"
];

let artistId;
const existing = await supabase
  .from("artists")
  .select("id,name,artist_type,is_curated")
  .ilike("name", "surrey soul sensation")
  .maybeSingle();

if (existing.error && existing.error.code !== "PGRST116") {
  throw existing.error;
}

if (existing.data) {
  artistId = existing.data.id;
  const needsUpdate = existing.data.artist_type !== "band" || existing.data.is_curated !== true;
  if (needsUpdate) {
    const { error } = await supabase
      .from("artists")
      .update({ artist_type: "band", is_curated: true })
      .eq("id", artistId);
    if (error) throw error;
  }
} else {
  const inserted = await supabase
    .from("artists")
    .insert({ name: "Surrey Soul Sensation", artist_type: "band", is_curated: true })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;
  artistId = inserted.data.id;
}

const existingLinks = await supabase
  .from("event_artists")
  .select("event_id,artist_id,billing_order")
  .in("event_id", eventIds);
if (existingLinks.error) throw existingLinks.error;

const linkSet = new Set(
  (existingLinks.data ?? []).map((row) => `${row.event_id}:${row.artist_id}`)
);
const maxByEvent = new Map();
for (const row of existingLinks.data ?? []) {
  const current = maxByEvent.get(row.event_id) ?? 0;
  maxByEvent.set(row.event_id, Math.max(current, Number(row.billing_order) || 0));
}

const rowsToInsert = [];
for (const eventId of eventIds) {
  const key = `${eventId}:${artistId}`;
  if (linkSet.has(key)) continue;
  const next = (maxByEvent.get(eventId) ?? 0) + 1;
  maxByEvent.set(eventId, next);
  rowsToInsert.push({
    event_id: eventId,
    artist_id: artistId,
    billing_order: next
  });
}

if (rowsToInsert.length > 0) {
  const inserted = await supabase.from("event_artists").insert(rowsToInsert);
  if (inserted.error) throw inserted.error;
}

const verify = await supabase
  .from("event_artists")
  .select("event:events(title,start_at), artist:artists(name)")
  .eq("artist_id", artistId)
  .order("event_id");
if (verify.error) throw verify.error;

console.log(
  JSON.stringify(
    {
      artistId,
      linksAdded: rowsToInsert.length,
      linkedEvents: (verify.data ?? []).map((row) => ({
        title: row.event?.title ?? null,
        startAt: row.event?.start_at ?? null
      }))
    },
    null,
    2
  )
);
