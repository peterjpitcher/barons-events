#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const SEED_PATH = path.resolve(process.cwd(), "supabase/seed.sql");
const MAX_AGE_DAYS = Number.parseInt(process.env.AI_SEED_MAX_AGE_DAYS ?? "120", 10);
const MS_PER_DAY = 1000 * 60 * 60 * 24;

async function loadSeed() {
  try {
    return await readFile(SEED_PATH, "utf-8");
  } catch (error) {
    throw new Error(
      `Unable to read Supabase seed file at ${SEED_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function extractAiContentSection(sql) {
  const match = sql.match(/insert into public\.ai_content[\s\S]+?on conflict/i);
  if (!match) {
    throw new Error("AI content seed block not found. Ensure ai_content inserts exist.");
  }
  return match[0];
}

function extractAiPublishQueueSection(sql) {
  const match = sql.match(/insert into public\.ai_publish_queue[\s\S]+?;/i);
  if (!match) {
    throw new Error("AI publish queue seed block not found. Ensure ai_publish_queue inserts exist.");
  }
  return match[0];
}

function parseTimestamps(section) {
  const matches = [...section.matchAll(/timezone\('utc', '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})'\)/gi)];
  if (matches.length === 0) {
    throw new Error("No UTC timestamps detected in AI content seed block.");
  }

  return matches.map((match) => match[1]);
}

function checkFreshness(timestamps) {
  const stale = [];

  for (const stamp of timestamps) {
    const date = new Date(`${stamp}Z`);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp detected in seed file: ${stamp}`);
    }

    const ageDays = Math.floor((Date.now() - date.getTime()) / MS_PER_DAY);
    if (ageDays > MAX_AGE_DAYS) {
      stale.push({ stamp, ageDays });
    }
  }

  if (stale.length > 0) {
    const messages = stale
      .map(({ stamp, ageDays }) => `${stamp} (${ageDays} days old)`)
      .join(", ");
    throw new Error(
      `Stale AI seed data detected. Update generated_at/published_at timestamps: ${messages}. (Max age: ${MAX_AGE_DAYS} days)`
    );
  }
}

function extractAiContentIds(section) {
  return [...section.matchAll(/\(\s*'([a-f0-9-]{36})'/gi)].map((match) => match[1]);
}

function extractQueueEntries(section) {
  const entries = [
    ...section.matchAll(
      /\(\s*'([a-f0-9-]{36})',\s*'([a-f0-9-]{36})',\s*'([a-f0-9-]{36})'/gi
    ),
  ];

  if (entries.length === 0) {
    throw new Error("AI publish queue seed block does not include any entries.");
  }

  return entries.map((match) => ({
    queueId: match[1],
    eventId: match[2],
    contentId: match[3],
  }));
}

async function main() {
  const sql = await loadSeed();
  const aiContentSection = extractAiContentSection(sql);
  const queueSection = extractAiPublishQueueSection(sql);

  const timestamps = parseTimestamps(aiContentSection);
  checkFreshness(timestamps);

  const aiContentIds = extractAiContentIds(aiContentSection);
  if (aiContentIds.length === 0) {
    throw new Error("AI content seed block does not include any IDs.");
  }

  const queueEntries = extractQueueEntries(queueSection);
  const queueContentIds = queueEntries.map((entry) => entry.contentId);

  const missingLinks = queueContentIds.filter(
    (contentId) => !aiContentIds.includes(contentId)
  );

  if (missingLinks.length > 0) {
    throw new Error(
      `AI publish queue references unknown content IDs: ${missingLinks.join(", ")}`
    );
  }

  if (!/\'pending\'/i.test(queueSection)) {
    throw new Error("AI publish queue seed entry must default to status 'pending'.");
  }

  console.log(
    `[seed:ai] AI seed freshness verified (${timestamps.length} timestamps ≤ ${MAX_AGE_DAYS} days, ${queueEntries.length} publish queue link${queueEntries.length === 1 ? "" : "s"}).`
  );
}

main().catch((error) => {
  console.error(`[seed:ai] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
