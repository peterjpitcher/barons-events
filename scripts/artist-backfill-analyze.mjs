import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvFromDotEnv(path) {
  const text = fs.readFileSync(path, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
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
    env[key] = value;
  }
  return env;
}

const env = loadEnvFromDotEnv(".env.local");
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const { data: events, error } = await supabase
  .from("events")
  .select("id,title,event_type,start_at,status,notes")
  .order("start_at", { ascending: true });

if (error) {
  console.error("Failed to load events:", error.message);
  process.exit(1);
}

console.log(`Loaded ${events.length} events`);
for (const event of events.slice(0, 200)) {
  const note = (event.notes ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const noteSuffix = note.length ? ` | notes: ${note}` : "";
  console.log(
    `${String(event.start_at).slice(0, 10)} | ${event.event_type} | ${event.title}${noteSuffix}`
  );
}
