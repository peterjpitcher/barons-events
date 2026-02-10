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

const confirmed = [
  {
    name: "Joe Jammer Duo",
    artistType: "artist",
    eventIds: ["0a0648bf-973a-4dcb-95d1-5f6754f3bf39"]
  },
  {
    name: "The Cherry pickers",
    artistType: "band",
    eventIds: ["d9ee18ea-cc3a-4d06-8154-d9340b61af72"]
  },
  {
    name: "Richard Anderson",
    artistType: "artist",
    eventIds: ["05f220f6-90fd-44f6-95b6-d8ff4493627b"]
  },
  {
    name: "Victoria BeeBee",
    artistType: "artist",
    eventIds: ["8c7bb820-c718-4b54-8e48-840848f70cf0"]
  }
];

const env = loadEnv(".env.local");
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const { data: existingArtists, error: loadArtistsError } = await supabase
  .from("artists")
  .select("id,name,artist_type,is_curated");
if (loadArtistsError) {
  console.error("Failed loading artists:", loadArtistsError.message);
  process.exit(1);
}

const artistByLower = new Map(
  (existingArtists ?? []).map((artist) => [String(artist.name).toLowerCase(), artist])
);

let created = 0;
let updated = 0;
const createdNames = [];
const updatedNames = [];
const artistIds = new Map();

for (const artist of confirmed) {
  const key = artist.name.toLowerCase();
  const existing = artistByLower.get(key);
  if (!existing) {
    const { data: inserted, error: insertError } = await supabase
      .from("artists")
      .insert({
        name: artist.name,
        artist_type: artist.artistType,
        is_curated: true
      })
      .select("id,name")
      .single();
    if (insertError || !inserted) {
      console.error(`Failed creating artist ${artist.name}:`, insertError?.message ?? "unknown");
      process.exit(1);
    }
    artistIds.set(key, inserted.id);
    created += 1;
    createdNames.push(artist.name);
    continue;
  }

  artistIds.set(key, existing.id);
  const needsUpdate =
    existing.artist_type !== artist.artistType ||
    existing.is_curated !== true;
  if (needsUpdate) {
    const { error: updateError } = await supabase
      .from("artists")
      .update({ artist_type: artist.artistType, is_curated: true })
      .eq("id", existing.id);
    if (updateError) {
      console.error(`Failed updating artist ${artist.name}:`, updateError.message);
      process.exit(1);
    }
    updated += 1;
    updatedNames.push(artist.name);
  }
}

const { data: existingLinks, error: existingLinksError } = await supabase
  .from("event_artists")
  .select("event_id,artist_id,billing_order");
if (existingLinksError) {
  console.error("Failed loading event links:", existingLinksError.message);
  process.exit(1);
}

const linkSet = new Set(
  (existingLinks ?? []).map((row) => `${row.event_id}:${row.artist_id}`)
);
const maxOrderByEvent = new Map();
for (const row of existingLinks ?? []) {
  const current = maxOrderByEvent.get(row.event_id) ?? 0;
  maxOrderByEvent.set(row.event_id, Math.max(current, Number(row.billing_order) || 0));
}

const newLinks = [];
for (const artist of confirmed) {
  const artistId = artistIds.get(artist.name.toLowerCase());
  if (!artistId) continue;
  for (const eventId of artist.eventIds) {
    const key = `${eventId}:${artistId}`;
    if (linkSet.has(key)) continue;
    const nextOrder = (maxOrderByEvent.get(eventId) ?? 0) + 1;
    maxOrderByEvent.set(eventId, nextOrder);
    linkSet.add(key);
    newLinks.push({
      event_id: eventId,
      artist_id: artistId,
      billing_order: nextOrder
    });
  }
}

if (newLinks.length > 0) {
  const { error: insertLinksError } = await supabase
    .from("event_artists")
    .insert(newLinks);
  if (insertLinksError) {
    console.error("Failed creating event links:", insertLinksError.message);
    process.exit(1);
  }
}

console.log(
  JSON.stringify(
    {
      created,
      updated,
      linksAdded: newLinks.length,
      createdNames,
      updatedNames
    },
    null,
    2
  )
);
