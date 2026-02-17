import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const AUDIT_ACTION = "event.website_copy_generated";
const AUDIT_CHANGES = [
  "Public title",
  "Public teaser",
  "Public description",
  "Public highlights",
  "SEO title",
  "SEO description",
  "SEO slug"
];
const REQUIRED_WEBSITE_FIELDS = [
  "public_title",
  "public_teaser",
  "public_description",
  "public_highlights",
  "seo_title",
  "seo_description",
  "seo_slug"
];
const EVENT_SELECT = `
  id,
  title,
  event_type,
  status,
  start_at,
  end_at,
  venue_space,
  expected_headcount,
  wet_promo,
  food_promo,
  goal_focus,
  cost_total,
  cost_details,
  booking_type,
  ticket_price,
  check_in_cutoff_minutes,
  age_policy,
  accessibility_notes,
  cancellation_window_hours,
  terms_and_conditions,
  public_title,
  public_teaser,
  public_description,
  public_highlights,
  seo_title,
  seo_description,
  seo_slug,
  booking_url,
  notes,
  venue:venues(name,address),
  artists:event_artists(
    billing_order,
    artist:artists(name)
  )
`;

function usage() {
  console.log(
    [
      "Backfill AI website copy for approved/completed events.",
      "",
      "Usage:",
      "  node scripts/backfill-website-copy.mjs [options]",
      "",
      "Options:",
      "  --apply                    Run AI generation and write updates.",
      "  --force                    Include events even if they already have audit + website fields.",
      "  --limit=<n>                Max events to process in this run (default: all candidates).",
      "  --event-id=<uuid>          Target a specific event ID. Repeat to include multiple IDs.",
      "  --actor-id=<uuid>          Optional audit actor_id for inserted audit entries.",
      "  --model=<name>             Override model (default: OPENAI_WEBSITE_COPY_MODEL or gpt-4o-mini).",
      "  --verbose                  Print per-event progress details.",
      "  --help                     Show this help.",
      "",
      "Defaults:",
      "  Without --apply, this runs in scan mode only and does not call OpenAI or mutate data."
    ].join("\n")
  );
}

function loadEnv(path) {
  if (!fs.existsSync(path)) return {};
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

function parseArgs(argv) {
  const args = {
    apply: false,
    force: false,
    verbose: false,
    limit: null,
    eventIds: [],
    actorId: null,
    model: null
  };

  for (const arg of argv) {
    if (arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--verbose") {
      args.verbose = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.split("=")[1] ?? "", 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        console.error(`Invalid --limit value: ${arg}`);
        process.exit(1);
      }
      args.limit = parsed;
      continue;
    }
    if (arg.startsWith("--event-id=")) {
      const value = (arg.split("=")[1] ?? "").trim();
      if (!value.length) {
        console.error(`Invalid --event-id value: ${arg}`);
        process.exit(1);
      }
      args.eventIds.push(value);
      continue;
    }
    if (arg.startsWith("--actor-id=")) {
      const value = (arg.split("=")[1] ?? "").trim();
      if (!value.length) {
        console.error(`Invalid --actor-id value: ${arg}`);
        process.exit(1);
      }
      args.actorId = value;
      continue;
    }
    if (arg.startsWith("--model=")) {
      const value = (arg.split("=")[1] ?? "").trim();
      if (!value.length) {
        console.error(`Invalid --model value: ${arg}`);
        process.exit(1);
      }
      args.model = value;
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    usage();
    process.exit(1);
  }

  args.eventIds = Array.from(new Set(args.eventIds));
  return args;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRequiredWebsiteContent(event) {
  return REQUIRED_WEBSITE_FIELDS.every((field) => {
    if (field === "public_highlights") {
      return Array.isArray(event.public_highlights) && event.public_highlights.length > 0;
    }
    return isNonEmptyString(event[field]);
  });
}

function clampText(value, maxChars) {
  const cleaned = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned.length) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars).trim();
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function formatUkDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London"
  }).format(date);
}

function formatUkShortDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London"
  }).format(date);
}

function formatUkTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London"
  }).format(date);
}

function formatUkTimeRange(startAt, endAt) {
  const start = formatUkTime(startAt);
  if (!start) return null;
  const end = formatUkTime(endAt);
  if (!end) return start;
  return `${start}-${end}`;
}

function toSlug(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug.length ? slug : "event";
}

function splitGoalFocus(goalFocus) {
  if (!isNonEmptyString(goalFocus)) return [];
  return goalFocus
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitVenueSpaces(venueSpace) {
  if (!isNonEmptyString(venueSpace)) return [];
  return venueSpace
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normaliseHighlights(value) {
  if (!Array.isArray(value)) return [];
  const deduped = [];
  const seen = new Set();
  for (const item of value) {
    const cleaned = clampText(String(item ?? "").replace(/^\s*[-*•]\s*/, ""), 90);
    if (!cleaned.length) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(cleaned);
    if (deduped.length >= 5) break;
  }
  return deduped;
}

function fallbackHighlights(event) {
  const highlights = [];
  const date = formatUkDate(event.start_at);
  const time = formatUkTimeRange(event.start_at, event.end_at);
  if (date && time) {
    highlights.push(`${date} | ${time}`);
  } else if (date) {
    highlights.push(date);
  }

  if (isNonEmptyString(event.venue?.name)) {
    highlights.push(`Hosted at ${event.venue.name}`);
  }

  if (isNonEmptyString(event.event_type)) {
    highlights.push(`${event.event_type} experience`);
  }

  if (Array.isArray(event.artistNames) && event.artistNames.length) {
    highlights.push(`Featuring ${event.artistNames.slice(0, 2).join(" & ")}`);
  }

  if (isNonEmptyString(event.public_teaser)) {
    highlights.push(clampText(event.public_teaser, 90));
  }

  return normaliseHighlights(highlights).slice(0, 5);
}

function ensureIncludesDate(value, dateToken, maxChars) {
  const base = clampText(value, maxChars);
  if (!isNonEmptyString(dateToken)) return base;
  if (base.toLowerCase().includes(dateToken.toLowerCase())) return base;

  const suffix = ` | ${dateToken}`;
  if (suffix.length >= maxChars) {
    return clampText(dateToken, maxChars);
  }
  const head = clampText(base, maxChars - suffix.length);
  return `${head}${suffix}`.trim();
}

function ensureSlugIncludesDate(slug, isoDate) {
  const cleaned = toSlug(slug);
  if (!isNonEmptyString(isoDate)) return cleaned;
  if (cleaned.includes(isoDate)) return cleaned;
  return toSlug(`${cleaned}-${isoDate}`);
}

function parseJsonFromContent(content) {
  if (!content) return null;
  const text = Array.isArray(content)
    ? content
        .filter((part) => part && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("")
    : typeof content === "string"
      ? content
      : "";
  if (!text.length) return null;

  const direct = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  if (direct) return direct;

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const maybeJson = text.slice(start, end + 1);
    try {
      return JSON.parse(maybeJson);
    } catch {
      return null;
    }
  }
  return null;
}

function extractArtistNames(artists) {
  if (!Array.isArray(artists)) return [];
  return artists
    .map((entry) => {
      const artistValue = Array.isArray(entry?.artist) ? entry.artist[0] : entry?.artist;
      return typeof artistValue?.name === "string" ? artistValue.name.trim() : null;
    })
    .filter((name) => Boolean(name));
}

function buildEventBrief(event) {
  const ukDate = formatUkDate(event.start_at);
  const ukShortDate = formatUkShortDate(event.start_at);
  const ukIso = toIsoDate(event.start_at);
  const ukTimeRange = formatUkTimeRange(event.start_at, event.end_at);
  const venueSpaces = splitVenueSpaces(event.venue_space);
  const goalFocus = splitGoalFocus(event.goal_focus);
  const lines = [
    `Event title (internal): ${isNonEmptyString(event.title) ? event.title : "Not provided"}`,
    `Event type: ${isNonEmptyString(event.event_type) ? event.event_type : "Not provided"}`,
    event.artistNames.length ? `Artist lineup: ${event.artistNames.join(", ")}` : "Artist lineup: Not provided",
    `Venue name (use for location): ${isNonEmptyString(event.venue?.name) ? event.venue.name : "Not provided"}`,
    `Venue address: ${isNonEmptyString(event.venue?.address) ? event.venue.address : "Not provided"}`,
    venueSpaces.length ? `Venue spaces: ${venueSpaces.join(", ")}` : "Venue spaces: Not specified",
    ukDate ? `Date (UK): ${ukDate}` : "Date (UK): Not provided",
    ukShortDate ? `Date (UK short): ${ukShortDate}` : "Date (UK short): Not provided",
    ukIso ? `Date (ISO): ${ukIso}` : "Date (ISO): Not provided",
    ukTimeRange ? `Time (UK): ${ukTimeRange}` : "Time (UK): Not provided",
    isNonEmptyString(event.start_at) ? `Start (UTC): ${event.start_at}` : "Start (UTC): Not provided",
    isNonEmptyString(event.end_at) ? `End (UTC): ${event.end_at}` : "End (UTC): Not provided",
    goalFocus.length ? `Goals: ${goalFocus.join(", ")}` : "Goals: Not provided",
    typeof event.expected_headcount === "number" ? `Expected headcount: ${event.expected_headcount}` : "Expected headcount: Not provided",
    isNonEmptyString(event.wet_promo) ? `Wet promotion: ${event.wet_promo}` : "Wet promotion: Not provided",
    isNonEmptyString(event.food_promo) ? `Food promotion: ${event.food_promo}` : "Food promotion: Not provided",
    typeof event.cost_total === "number" ? `Planned cost total: ${event.cost_total}` : "Planned cost total: Not provided",
    isNonEmptyString(event.cost_details) ? `Cost details: ${event.cost_details}` : "Cost details: Not provided",
    isNonEmptyString(event.booking_type) ? `Booking model: ${event.booking_type}` : "Booking model: Not provided",
    typeof event.ticket_price === "number" ? `Ticket price: ${event.ticket_price}` : "Ticket price: Not provided",
    typeof event.check_in_cutoff_minutes === "number"
      ? `Last admission/check-in cutoff: ${event.check_in_cutoff_minutes} minutes before start`
      : "Last admission/check-in cutoff: Not provided",
    isNonEmptyString(event.age_policy) ? `Age policy: ${event.age_policy}` : "Age policy: Not provided",
    isNonEmptyString(event.accessibility_notes)
      ? `Accessibility notes: ${event.accessibility_notes}`
      : "Accessibility notes: Not provided",
    typeof event.cancellation_window_hours === "number"
      ? `Cancellation/refund window: ${event.cancellation_window_hours} hours`
      : "Cancellation/refund window: Not provided",
    isNonEmptyString(event.terms_and_conditions)
      ? `Terms and conditions: ${event.terms_and_conditions}`
      : "Terms and conditions: Not provided",
    isNonEmptyString(event.booking_url) ? "Booking link exists: Yes (do not output URLs)" : "Booking link exists: No",
    isNonEmptyString(event.notes) ? `Event details: ${event.notes}` : "Event details: Not provided",
    isNonEmptyString(event.public_title) ? `Existing public title: ${event.public_title}` : "Existing public title: None",
    isNonEmptyString(event.public_teaser) ? `Existing public teaser: ${event.public_teaser}` : "Existing public teaser: None",
    isNonEmptyString(event.public_description)
      ? `Existing public description: ${event.public_description}`
      : "Existing public description: None",
    Array.isArray(event.public_highlights) && event.public_highlights.length
      ? `Existing public highlights: ${event.public_highlights.join(" | ")}`
      : "Existing public highlights: None"
  ];
  return lines.join("\n");
}

async function generateWebsiteCopyViaOpenAI(event, options) {
  const body = {
    model: options.model,
    messages: [
      {
        role: "system",
        content: [
          "You are a UK hospitality marketing copywriter focused on conversion.",
          "Always return valid JSON only.",
          "Do not invent facts that are not in the event brief.",
          "Do not include URLs in any field."
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "Create high-impact website copy for this event.",
          "Requirements:",
          "- publicTitle <= 80 chars.",
          "- publicTeaser <= 160 chars.",
          "- publicHighlights: array of 3-5 concise bullets, each <= 90 chars.",
          "- publicDescription: booking-focused description with venue and UK date/time.",
          "- seoTitle <= 60 chars and includes date.",
          "- seoDescription <= 155 chars and includes date.",
          "- seoSlug: lowercase words with hyphens and includes date.",
          "",
          `Event brief:\n${buildEventBrief(event)}`
        ].join("\n")
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "event_website_copy",
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "publicTitle",
            "publicTeaser",
            "publicHighlights",
            "publicDescription",
            "seoTitle",
            "seoDescription",
            "seoSlug"
          ],
          properties: {
            publicTitle: { type: "string" },
            publicTeaser: { type: "string" },
            publicHighlights: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: { type: "string" }
            },
            publicDescription: { type: "string" },
            seoTitle: { type: "string" },
            seoDescription: { type: "string" },
            seoSlug: { type: "string" }
          }
        }
      }
    }
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = parseJsonFromContent(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAI response did not contain valid JSON payload.");
  }

  const eventDateShort = formatUkShortDate(event.start_at);
  const eventIsoDate = toIsoDate(event.start_at);
  const safeTitle = clampText(parsed.publicTitle, 80);
  const safeTeaser = clampText(parsed.publicTeaser, 160);
  const safeDescription = String(parsed.publicDescription ?? "").trim();
  const safeHighlights = normaliseHighlights(parsed.publicHighlights);
  const fallback = fallbackHighlights(event);
  const mergedHighlights = safeHighlights.length ? safeHighlights : fallback;
  const safeSeoTitle = ensureIncludesDate(parsed.seoTitle, eventDateShort, 60);
  const safeSeoDescription = ensureIncludesDate(parsed.seoDescription, eventDateShort, 155);
  const safeSeoSlug = ensureSlugIncludesDate(parsed.seoSlug ?? safeTitle, eventIsoDate);

  if (!safeTitle || !safeTeaser || !safeDescription || mergedHighlights.length < 3 || !safeSeoTitle || !safeSeoDescription || !safeSeoSlug) {
    throw new Error("OpenAI response missing required website copy fields after normalisation.");
  }

  return {
    public_title: safeTitle,
    public_teaser: safeTeaser,
    public_description: safeDescription,
    public_highlights: mergedHighlights,
    seo_title: safeSeoTitle,
    seo_description: safeSeoDescription,
    seo_slug: safeSeoSlug
  };
}

async function chunkedGeneratedAuditIds(supabase, eventIds) {
  if (!eventIds.length) return new Set();
  const chunkSize = 200;
  const generatedIds = new Set();
  for (let index = 0; index < eventIds.length; index += chunkSize) {
    const chunk = eventIds.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from("audit_log")
      .select("entity_id")
      .eq("entity", "event")
      .eq("action", AUDIT_ACTION)
      .in("entity_id", chunk);
    if (error) {
      throw new Error(`Failed to load website-copy audit rows: ${error.message}`);
    }
    for (const row of data ?? []) {
      if (isNonEmptyString(row.entity_id)) {
        generatedIds.add(row.entity_id);
      }
    }
  }
  return generatedIds;
}

const args = parseArgs(process.argv.slice(2));
const env = { ...loadEnv(".env.local"), ...process.env };
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const openAiApiKey = env.OPENAI_API_KEY;
const model = args.model ?? env.OPENAI_WEBSITE_COPY_MODEL ?? "gpt-4o-mini";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

if (args.apply && !openAiApiKey) {
  console.error("OPENAI_API_KEY is required when using --apply.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

let eventsQuery = supabase
  .from("events")
  .select(EVENT_SELECT)
  .in("status", ["approved", "completed"])
  .order("start_at", { ascending: true });

if (args.eventIds.length) {
  eventsQuery = eventsQuery.in("id", args.eventIds);
}

const { data: events, error: eventsError } = await eventsQuery;
if (eventsError) {
  console.error(`Failed loading events: ${eventsError.message}`);
  process.exit(1);
}

const eventRows = (events ?? []).map((event) => {
  const venueValue = Array.isArray(event.venue) ? event.venue[0] : event.venue;
  return {
    ...event,
    venue: venueValue ?? null,
    artistNames: extractArtistNames(event.artists)
  };
});

const auditEventIds = await chunkedGeneratedAuditIds(
  supabase,
  eventRows.map((event) => event.id)
);

const candidates = eventRows
  .map((event) => {
    const hasAudit = auditEventIds.has(event.id);
    const hasRequiredContent = hasRequiredWebsiteContent(event);
    return {
      ...event,
      hasAudit,
      hasRequiredContent,
      shouldProcess: args.force ? true : !hasAudit || !hasRequiredContent
    };
  })
  .filter((event) => event.shouldProcess);

const limitedCandidates = args.limit ? candidates.slice(0, args.limit) : candidates;

const scanSummary = {
  mode: args.apply ? "apply" : "scan",
  force: args.force,
  limit: args.limit ?? null,
  model,
  totalApprovedOrCompleted: eventRows.length,
  withGeneratedAudit: eventRows.filter((event) => auditEventIds.has(event.id)).length,
  withRequiredWebsiteContent: eventRows.filter((event) => hasRequiredWebsiteContent(event)).length,
  candidates: candidates.length,
  candidatesAfterLimit: limitedCandidates.length
};

if (!args.apply) {
  console.log(JSON.stringify(scanSummary, null, 2));
  if (limitedCandidates.length) {
    const sample = limitedCandidates.slice(0, 20).map((event) => ({
      id: event.id,
      title: event.title,
      status: event.status,
      hasAudit: event.hasAudit,
      hasRequiredContent: event.hasRequiredContent
    }));
    console.log(JSON.stringify({ sample }, null, 2));
  }
  process.exit(0);
}

const results = {
  ...scanSummary,
  processed: 0,
  updated: 0,
  failed: 0,
  failures: []
};

for (const event of limitedCandidates) {
  results.processed += 1;
  if (args.verbose) {
    console.log(`Processing ${event.id} (${event.title ?? "Untitled event"})...`);
  }

  try {
    const generatedPayload = await generateWebsiteCopyViaOpenAI(event, {
      apiKey: openAiApiKey,
      model
    });

    const { error: updateError } = await supabase
      .from("events")
      .update(generatedPayload)
      .eq("id", event.id);
    if (updateError) {
      throw new Error(`Event update failed: ${updateError.message}`);
    }

    const auditMeta = {
      changes: AUDIT_CHANGES,
      backfill: true,
      generatedBy: model,
      previousAuditPresent: event.hasAudit,
      previousRequiredContentPresent: event.hasRequiredContent
    };
    const auditInsert = {
      entity: "event",
      entity_id: event.id,
      action: AUDIT_ACTION,
      actor_id: args.actorId ?? null,
      meta: auditMeta
    };
    const { error: auditError } = await supabase.from("audit_log").insert(auditInsert);
    if (auditError) {
      throw new Error(`Audit insert failed: ${auditError.message}`);
    }

    results.updated += 1;
  } catch (error) {
    results.failed += 1;
    results.failures.push({
      id: event.id,
      title: event.title,
      status: event.status,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

console.log(JSON.stringify(results, null, 2));
if (results.failed > 0) {
  process.exit(1);
}
