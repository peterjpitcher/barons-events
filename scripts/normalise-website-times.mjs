import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const WEBSITE_TEXT_FIELDS = [
  "public_title",
  "public_teaser",
  "public_description",
  "seo_title",
  "seo_description"
];

function loadEnv(path) {
  if (!fs.existsSync(path)) return {};
  const entries = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function normaliseWebsiteTimeText(value) {
  const from12Hour = value.replace(
    /\b(0?[1-9]|1[0-2])(?:[:.]([0-5]\d))?\s*([ap])\.?\s*m(?![a-z])/gi,
    (_, hourText, minute, dayPeriod) => {
      const minuteLabel = minute && minute !== "00" ? `.${minute}` : "";
      return `${Number(hourText)}${minuteLabel}${dayPeriod.toLowerCase()}m`;
    }
  );

  return from12Hour.replace(
    /\b([01]\d|2[0-3]):([0-5]\d)\b/g,
    (_, hourText, minute) => {
      const hour24 = Number(hourText);
      const hour12 = hour24 % 12 || 12;
      const dayPeriod = hour24 < 12 ? "am" : "pm";
      return minute === "00" ? `${hour12}${dayPeriod}` : `${hour12}.${minute}${dayPeriod}`;
    }
  );
}

function buildUpdate(row) {
  const update = {};

  for (const field of WEBSITE_TEXT_FIELDS) {
    if (typeof row[field] !== "string") continue;
    const normalised = normaliseWebsiteTimeText(row[field]);
    if (normalised !== row[field]) {
      update[field] = normalised;
    }
  }

  if (Array.isArray(row.public_highlights)) {
    const highlights = row.public_highlights.map((value) =>
      typeof value === "string" ? normaliseWebsiteTimeText(value) : value
    );
    if (JSON.stringify(highlights) !== JSON.stringify(row.public_highlights)) {
      update.public_highlights = highlights;
    }
  }

  return update;
}

async function loadEvents(supabase) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("events")
      .select(`id,${WEBSITE_TEXT_FIELDS.join(",")},public_highlights`)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load events: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

const unknownArgs = process.argv.slice(2).filter((argument) => argument !== "--apply");
if (unknownArgs.length) {
  console.error(`Unknown argument: ${unknownArgs[0]}`);
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const env = { ...loadEnv(".env.local"), ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const rows = await loadEvents(supabase);
const changes = rows
  .map((row) => ({ id: row.id, update: buildUpdate(row) }))
  .filter(({ update }) => Object.keys(update).length > 0);

const fields = {};
for (const { update } of changes) {
  for (const field of Object.keys(update)) {
    fields[field] = (fields[field] ?? 0) + 1;
  }
}

const summary = {
  mode: apply ? "apply" : "scan",
  eventsScanned: rows.length,
  eventsToUpdate: changes.length,
  fields
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

let updated = 0;
const failures = [];
for (const { id, update } of changes) {
  const { error } = await supabase.from("events").update(update).eq("id", id);
  if (error) {
    failures.push({ id, error: error.message });
  } else {
    updated += 1;
  }
}

const remaining = (await loadEvents(supabase)).filter(
  (row) => Object.keys(buildUpdate(row)).length > 0
);

console.log(JSON.stringify({
  ...summary,
  updated,
  failed: failures.length,
  failures,
  remaining: remaining.length
}, null, 2));

if (failures.length || remaining.length) {
  process.exit(1);
}
