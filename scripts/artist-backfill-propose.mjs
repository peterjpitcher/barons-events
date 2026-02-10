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

function normaliseSpace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeEntities(value) {
  return value
    .replace(/&#8230;/g, "...")
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

function cleanName(raw) {
  if (!raw) return null;
  let value = decodeEntities(String(raw));
  value = value.replace(/^\*?\s*SOLD OUT\s*\*?\s*/i, "");
  value = value.replace(/\|.*$/g, "");
  value = value.replace(/\([^)]*\)/g, " ");
  value = value.replace(
    /\b(returns?|join(?:s)?|brings?|perform(?:s|ing)?|soundtracks?|promis(?:es|ing))\b.*$/i,
    ""
  );
  value = value.replace(/^[\-"'\s]+|[\-"'\s]+$/g, "");
  value = normaliseSpace(value);
  if (!value) return null;
  return value;
}

function canonicalHostName(name) {
  const cleaned = cleanName(name);
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase().replace(/[^a-z]/g, "");
  if (lower === "elliot" || lower === "elliott" || lower === "elliotts") {
    return "Elliott";
  }
  return cleaned;
}

function looksLikeDateLabel(name) {
  return /^\d{1,2}\s+[a-z]+$/i.test(name);
}

function isGenericNonArtist(name) {
  const value = name.toLowerCase();
  const blockers = [
    "extraordinaire",
    "charity pub quiz",
    "charity quiz night",
    "monthly quiz night",
    "quiz night",
    "jazz night",
    "live music",
    "band night",
    "new years eve gala",
    "barons birthday party",
    "halloween feasting",
    "christmas carols",
    "bottomless valentine",
    "charity bake sale",
    "save the rhino",
    "fundraiser"
  ];
  return blockers.some((token) => value.includes(token));
}

function inferType(eventType, name) {
  const lowerType = (eventType ?? "").toLowerCase();
  const lowerName = name.toLowerCase();
  if (lowerType.includes("quiz")) return "host";
  if (lowerName.includes("quiz")) return "host";
  if (lowerName.includes("duo")) return "artist";
  if (lowerType.includes("live music")) return "band";
  return "artist";
}

function maybeAddCandidate(candidates, event, rawName, confidence, reason, explicitType = null) {
  const cleaned = cleanName(rawName);
  if (!cleaned) return;
  if (looksLikeDateLabel(cleaned)) return;
  if (isGenericNonArtist(cleaned)) return;
  if (cleaned.length < 2 || cleaned.length > 120) return;
  const name =
    explicitType === "host" || (event.event_type ?? "").toLowerCase().includes("quiz")
      ? canonicalHostName(cleaned)
      : cleaned;
  if (!name) return;
  const key = `${event.id}:${name.toLowerCase()}`;
  if (!candidates.has(key)) {
    candidates.set(key, {
      eventId: event.id,
      eventTitle: event.title,
      eventType: event.event_type,
      startAt: event.start_at,
      name,
      confidence,
      reason,
      artistType: explicitType ?? inferType(event.event_type, name)
    });
    return;
  }
  const existing = candidates.get(key);
  if (confidence > existing.confidence) {
    existing.confidence = confidence;
    existing.reason = reason;
    if (explicitType) existing.artistType = explicitType;
  }
}

const env = loadEnv(".env.local");
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const { data: events, error } = await supabase
  .from("events")
  .select("id,title,event_type,start_at,notes")
  .order("start_at", { ascending: true });

if (error) {
  console.error("Failed to load events:", error.message);
  process.exit(1);
}

const candidates = new Map();

for (const event of events) {
  const title = decodeEntities(event.title ?? "");
  const notes = decodeEntities(event.notes ?? "");
  const cleanTitle = normaliseSpace(title.replace(/^\*?\s*SOLD OUT\s*\*?\s*/i, ""));

  // Quiz host patterns
  const quizWith = cleanTitle.match(/^quiz with (.+)$/i);
  if (quizWith) {
    maybeAddCandidate(candidates, event, quizWith[1], 0.98, "Title: Quiz with <name>", "host");
  }
  const possessiveQuiz = cleanTitle.match(/^(.+?)'?s quiz$/i);
  if (possessiveQuiz) {
    maybeAddCandidate(candidates, event, possessiveQuiz[1], 0.97, "Title: <name>'s Quiz", "host");
  }
  if (/with quizziverse/i.test(cleanTitle) || /by quizziverse/i.test(cleanTitle)) {
    maybeAddCandidate(candidates, event, "Quizziverse", 0.95, "Title references Quizziverse", "host");
  }
  const quizmaster = notes.match(/quiz\s*master(?:\s+extraordinaire)?\s+([A-Z][a-z]+)\b/i);
  const quizmasterFixed = notes.match(/quiz\s*master(?:\s+extraordinaire)?(?:\s*,)?\s+([A-Z][a-z]+)\b/i);
  if (quizmasterFixed) {
    maybeAddCandidate(candidates, event, quizmasterFixed[1], 0.95, "Notes: Quizmaster <name>", "host");
  } else if (quizmaster) {
    maybeAddCandidate(candidates, event, quizmaster[1], 0.9, "Notes: Quizmaster <name>", "host");
  }

  // Live music / band patterns
  const bandNight = cleanTitle.match(/^band night\s*[:\-]\s*(.+)$/i);
  if (bandNight) {
    maybeAddCandidate(candidates, event, bandNight[1], 0.98, "Title: Band Night", "band");
  }
  const liveMusicNamed = cleanTitle.match(/^live music\s*[:\-]\s*(.+)$/i);
  if (liveMusicNamed) {
    maybeAddCandidate(candidates, event, liveMusicNamed[1], 0.96, "Title: Live Music", "band");
  }
  const freeLiveMusic = cleanTitle.match(/^(.+?)\s*-\s*free live music/i);
  if (freeLiveMusic) {
    maybeAddCandidate(candidates, event, freeLiveMusic[1], 0.97, "Title: <name> - FREE Live Music", "band");
  }
  const jazzNight = cleanTitle.match(/^jazz night\s*-\s*(.+)$/i);
  if (jazzNight && !/at the cricketers/i.test(cleanTitle)) {
    maybeAddCandidate(candidates, event, jazzNight[1], 0.94, "Title: Jazz Night - <name>", "band");
  }
  if (
    /horsell jazz hounds/i.test(notes) &&
    (/jazz night at the cricketers/i.test(cleanTitle) || /horsell jazz hounds/i.test(cleanTitle))
  ) {
    maybeAddCandidate(candidates, event, "Horsell Jazz Hounds", 0.93, "Notes mention Horsell Jazz Hounds", "band");
  }

  // Mediumship / other named acts
  const mediumship = cleanTitle.match(/^a night of mediumship with (.+)$/i);
  if (mediumship) {
    maybeAddCandidate(candidates, event, mediumship[1], 0.98, "Title: A Night of Mediumship with <name>", "artist");
  }
  if (/lesley carver medium/i.test(cleanTitle)) {
    maybeAddCandidate(candidates, event, "Lesley Carver", 0.98, "Title: Lesley Carver Medium", "artist");
  }

  // Single-name/title performers where title is clearly the act
  if (
    !isGenericNonArtist(cleanTitle) &&
    !looksLikeDateLabel(cleanTitle) &&
    !/^(charity|monthly|smartphone|new years|christmas|halloween)/i.test(cleanTitle) &&
    /[A-Za-z]/.test(cleanTitle) &&
    (event.event_type === "Live Music" || event.event_type === "Other")
  ) {
    const likelyPerformerTitle =
      !/^(band night|live music|jazz night|quiz)/i.test(cleanTitle) &&
      cleanTitle.split(" ").length <= 7;
    if (likelyPerformerTitle) {
      maybeAddCandidate(candidates, event, cleanTitle, 0.9, "Title appears to be performer/act name");
    }
  }

  // Notes-only named performers (strict patterns)
  const fromLiveMusic = notes.match(/live music from\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/i);
  if (fromLiveMusic) {
    maybeAddCandidate(candidates, event, fromLiveMusic[1], 0.9, "Notes: live music from <name>", "artist");
  }
  const singerGuitarist = notes.match(
    /singer[\s-]guitarist\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\b/i
  );
  if (singerGuitarist) {
    maybeAddCandidate(candidates, event, singerGuitarist[1], 0.92, "Notes: singer-guitarist <name>", "artist");
  }
  const touringArtist = notes.match(
    /touring artist\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\b/i
  );
  if (touringArtist) {
    maybeAddCandidate(candidates, event, touringArtist[1], 0.9, "Notes: touring artist <name>", "artist");
  }
}

const rows = Array.from(candidates.values());
const sureRows = rows.filter((row) => row.confidence >= 0.92);
const maybeRows = rows.filter((row) => row.confidence >= 0.85 && row.confidence < 0.92);

function aggregateByArtist(inputRows) {
  const map = new Map();
  for (const row of inputRows) {
    const key = row.name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        name: row.name,
        artistType: row.artistType,
        confidence: row.confidence,
        eventCount: 0,
        events: []
      });
    }
    const item = map.get(key);
    item.eventCount += 1;
    item.confidence = Math.max(item.confidence, row.confidence);
    item.events.push({
      eventId: row.eventId,
      startAt: row.startAt,
      eventType: row.eventType,
      title: row.eventTitle,
      reason: row.reason
    });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const sureArtists = aggregateByArtist(sureRows);
const maybeArtists = aggregateByArtist(maybeRows);

const output = {
  analysedAt: new Date().toISOString(),
  eventCount: events.length,
  sureArtistCount: sureArtists.length,
  sureArtists,
  maybeArtistCount: maybeArtists.length,
  maybeArtists
};

const outputPath = "tmp/artist-backfill-proposal.json";
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`Wrote proposal to ${outputPath}`);
console.log(`Sure artists: ${sureArtists.length}`);
console.log(`Maybe artists: ${maybeArtists.length}`);
for (const artist of sureArtists) {
  console.log(`- ${artist.name} [${artist.artistType}] (${artist.eventCount} events)`);
}
