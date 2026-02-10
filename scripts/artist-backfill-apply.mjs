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

const dryRun = process.argv.includes("--dry-run");
const proposalPath = process.argv.find((arg) => arg.startsWith("--proposal="))?.split("=")[1] ??
  "tmp/artist-backfill-proposal.json";

if (!fs.existsSync(proposalPath)) {
  console.error(`Proposal file not found: ${proposalPath}`);
  process.exit(1);
}

const proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8"));
const sureArtists = Array.isArray(proposal.sureArtists) ? proposal.sureArtists : [];

if (!sureArtists.length) {
  console.log("No sure artists in proposal; nothing to apply.");
  process.exit(0);
}

const env = loadEnv(".env.local");
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const { data: existingArtists, error: artistsError } = await supabase
  .from("artists")
  .select("id,name,artist_type,is_curated");
if (artistsError) {
  console.error("Failed loading artists:", artistsError.message);
  process.exit(1);
}

const artistByLowerName = new Map(
  (existingArtists ?? []).map((artist) => [String(artist.name).toLowerCase(), artist])
);

let createdArtists = 0;
let updatedArtists = 0;
const createdNames = [];
const updatedNames = [];
const artistIdByNameLower = new Map();

for (const candidate of sureArtists) {
  const name = String(candidate.name ?? "").trim();
  const artistType = String(candidate.artistType ?? "artist").trim() || "artist";
  if (!name) continue;

  const key = name.toLowerCase();
  const existing = artistByLowerName.get(key);

  if (existing) {
    artistIdByNameLower.set(key, existing.id);
    const needsUpdate =
      existing.artist_type !== artistType ||
      existing.is_curated !== true;
    if (needsUpdate && !dryRun) {
      const { error: updateError } = await supabase
        .from("artists")
        .update({ artist_type: artistType, is_curated: true })
        .eq("id", existing.id);
      if (updateError) {
        console.error(`Failed to update artist ${name}:`, updateError.message);
        process.exit(1);
      }
      updatedArtists += 1;
      updatedNames.push(name);
    } else if (needsUpdate && dryRun) {
      updatedArtists += 1;
      updatedNames.push(name);
    }
    continue;
  }

  if (dryRun) {
    createdArtists += 1;
    createdNames.push(name);
    continue;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("artists")
    .insert({
      name,
      artist_type: artistType,
      is_curated: true
    })
    .select("id,name")
    .single();
  if (insertError || !inserted) {
    console.error(`Failed to create artist ${name}:`, insertError?.message ?? "unknown error");
    process.exit(1);
  }
  artistByLowerName.set(key, { id: inserted.id, name, artist_type: artistType, is_curated: true });
  artistIdByNameLower.set(key, inserted.id);
  createdArtists += 1;
  createdNames.push(name);
}

if (!dryRun) {
  const { data: refreshed, error: refreshError } = await supabase
    .from("artists")
    .select("id,name");
  if (refreshError) {
    console.error("Failed to refresh artists:", refreshError.message);
    process.exit(1);
  }
  for (const artist of refreshed ?? []) {
    artistIdByNameLower.set(String(artist.name).toLowerCase(), artist.id);
  }
}

const desiredLinks = [];
for (const artist of sureArtists) {
  const artistId = artistIdByNameLower.get(String(artist.name).toLowerCase());
  if (!artistId) continue;
  for (const event of artist.events ?? []) {
    if (!event?.eventId) continue;
    desiredLinks.push({ eventId: event.eventId, artistId });
  }
}

const uniqueEventIds = Array.from(new Set(desiredLinks.map((item) => item.eventId)));
const { data: existingLinks, error: linksError } = await supabase
  .from("event_artists")
  .select("event_id,artist_id,billing_order")
  .in("event_id", uniqueEventIds);
if (linksError) {
  console.error("Failed loading event links:", linksError.message);
  process.exit(1);
}

const existingLinkSet = new Set(
  (existingLinks ?? []).map((link) => `${link.event_id}:${link.artist_id}`)
);
const nextOrderByEvent = new Map();
for (const link of existingLinks ?? []) {
  const current = nextOrderByEvent.get(link.event_id) ?? 0;
  nextOrderByEvent.set(link.event_id, Math.max(current, Number(link.billing_order) || 0));
}

const rowsToInsert = [];
for (const link of desiredLinks) {
  const key = `${link.eventId}:${link.artistId}`;
  if (existingLinkSet.has(key)) continue;
  const current = nextOrderByEvent.get(link.eventId) ?? 0;
  const next = current + 1;
  nextOrderByEvent.set(link.eventId, next);
  existingLinkSet.add(key);
  rowsToInsert.push({
    event_id: link.eventId,
    artist_id: link.artistId,
    billing_order: next
  });
}

if (!dryRun && rowsToInsert.length > 0) {
  const chunkSize = 200;
  for (let index = 0; index < rowsToInsert.length; index += chunkSize) {
    const chunk = rowsToInsert.slice(index, index + chunkSize);
    const { error: insertLinkError } = await supabase.from("event_artists").insert(chunk);
    if (insertLinkError) {
      console.error("Failed inserting event artist links:", insertLinkError.message);
      process.exit(1);
    }
  }
}

console.log(
  JSON.stringify(
    {
      dryRun,
      sureArtists: sureArtists.length,
      createdArtists,
      updatedArtists,
      linksToInsert: rowsToInsert.length,
      createdNames,
      updatedNames
    },
    null,
    2
  )
);
