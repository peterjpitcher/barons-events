#!/usr/bin/env node

/**
 * Compare the latest planning analytics snapshot with the most recent
 * weekly digest payload stored in Supabase. Intended for staging sign-off.
 *
 * Usage:
 *   node --env-file=.env.local scripts/check-planning-parity.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing Supabase credentials. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEFAULT_EVENT_DURATION_MS = 1000 * 60 * 60 * 2;

const toMs = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const fetchPlanningMetrics = async () => {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,title,status,start_at,end_at,venue_id,venue_space,assigned_reviewer_id,venues(name)"
    )
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch events: ${error.message}`);
  }

  const events = data ?? [];
  const statusCounts = {};
  const awaitingReviewer = [];
  const groupedByVenue = new Map();

  for (const row of events) {
    const status = row.status ?? "unknown";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;

    if (status === "submitted" && !row.assigned_reviewer_id) {
      awaitingReviewer.push(row);
    }

    const venueRecord = Array.isArray(row.venues)
      ? row.venues[0] ?? null
      : row.venues ?? null;

    const venueKey = `${row.venue_id ?? venueRecord?.name ?? "unknown"}::${
      row.venue_space ?? "general"
    }`;

    const startMs = toMs(row.start_at);
    if (startMs === null) continue;

    let endMs = toMs(row.end_at);
    if (endMs === null || endMs < startMs) {
      endMs = startMs + DEFAULT_EVENT_DURATION_MS;
    }

    if (!groupedByVenue.has(venueKey)) {
      groupedByVenue.set(venueKey, []);
    }

    groupedByVenue.get(venueKey).push({
      id: row.id,
      startMs,
      endMs,
    });
  }

  let conflictCount = 0;
  for (const entries of groupedByVenue.values()) {
    entries.sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < entries.length; i += 1) {
      const current = entries[i];
      for (let j = i + 1; j < entries.length; j += 1) {
        const comparison = entries[j];
        if (current.endMs < comparison.startMs) {
          break;
        }
        const overlaps =
          current.startMs <= comparison.endMs &&
          comparison.startMs <= current.endMs;
        if (overlaps) {
          conflictCount += 1;
        }
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totalEvents: events.length,
    statusCounts,
    conflicts: conflictCount,
    awaitingReviewer: awaitingReviewer.length,
  };
};

const fetchLatestDigest = async () => {
  const { data, error } = await supabase
    .from("weekly_digest_logs")
    .select("payload")
    .order("sent_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to fetch weekly digest logs: ${error.message}`);
  }

  return data?.[0]?.payload ?? null;
};

const diffMetrics = (planning, digest) => {
  if (!digest) {
    return {
      statusCounts: null,
      conflicts: null,
      awaitingReviewer: null,
      isAligned: false,
      note: "No weekly digest snapshot recorded.",
    };
  }

  const statusDiff = {};
  const statusKeys = new Set([
    ...Object.keys(planning.statusCounts ?? {}),
    ...Object.keys(digest.status_counts ?? {}),
  ]);

  for (const key of statusKeys) {
    const planningValue = planning.statusCounts[key] ?? 0;
    const digestValue = digest.status_counts?.[key] ?? 0;
    statusDiff[key] = planningValue - digestValue;
  }

  const conflictsDiff = planning.conflicts - (digest.conflicts ?? 0);
  const awaitingDiff =
    planning.awaitingReviewer - (digest.awaiting_reviewer ?? 0);

  const isAligned =
    Object.values(statusDiff).every((value) => value === 0) &&
    conflictsDiff === 0 &&
    awaitingDiff === 0;

  return {
    statusCounts: statusDiff,
    conflicts: conflictsDiff,
    awaitingReviewer: awaitingDiff,
    isAligned,
    note: isAligned
      ? "Planning feed and weekly digest metrics are aligned."
      : "Differences detected between planning feed and weekly digest payload.",
  };
};

async function main() {
  try {
    const planningMetrics = await fetchPlanningMetrics();
    const latestDigest = await fetchLatestDigest();
    const diff = diffMetrics(planningMetrics, latestDigest);

    const report = {
      planningMetrics,
      latestDigest: latestDigest
        ? {
            generated_at: latestDigest.generated_at ?? null,
            status_counts: latestDigest.status_counts ?? {},
            conflicts: latestDigest.conflicts ?? 0,
            awaiting_reviewer: latestDigest.awaiting_reviewer ?? 0,
            recipients: latestDigest.recipients ?? [],
          }
        : null,
      diff,
    };

    console.log(JSON.stringify(report, null, 2));

    if (!diff.isAligned) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}

await main();
