import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getComputedDates } from "@/lib/planning/inspiration-dates";
import type { PlanningInspirationItem, InspirationCategory, InspirationSource } from "@/lib/planning/types";

type InspirationItemInput = Omit<PlanningInspirationItem, 'id'>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function deduplicateItems(items: InspirationItemInput[]): InspirationItemInput[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.eventDate}|${item.eventName.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Source 1: gov.uk bank holidays ─────────────────────────────────────────

export async function fetchBankHolidays(
  windowStart: Date,
  windowEnd: Date
): Promise<InspirationItemInput[]> {
  try {
    const res = await fetch('https://www.gov.uk/bank-holidays.json');
    if (!res.ok) {
      console.warn(`fetchBankHolidays: gov.uk API returned ${res.status} — skipping bank holidays`);
      return [];
    }
    const data = (await res.json()) as {
      'england-and-wales': { events: Array<{ title: string; date: string }> };
    };
    const events = data['england-and-wales']?.events ?? [];
    const startStr = toIsoDate(windowStart);
    const endStr = toIsoDate(windowEnd);

    return events
      .filter(e => e.date >= startStr && e.date <= endStr)
      .map(e => ({
        eventName: e.title,
        eventDate: e.date,
        category: 'bank_holiday' as InspirationCategory,
        description: null,
        source: 'gov_uk_api' as InspirationSource,
      }));
  } catch (err) {
    console.warn('fetchBankHolidays: failed to fetch bank holidays — continuing without them', err);
    return [];
  }
}

// ─── Source 3: OpenAI sporting events ───────────────────────────────────────

type OpenAiEvent = { event_name: string; event_date: string; description: string };

async function fetchSportingEvents(
  windowStart: Date,
  windowEnd: Date,
  bankHolidayContext: InspirationItemInput[]
): Promise<InspirationItemInput[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('fetchSportingEvents: OPENAI_API_KEY not set — skipping sporting events');
    return [];
  }

  const startStr = toIsoDate(windowStart);
  const endStr = toIsoDate(windowEnd);
  const bankHolidayLines = bankHolidayContext
    .map(h => `- ${h.eventDate}: ${h.eventName}`)
    .join('\n');

  const body = {
    model: process.env.OPENAI_WEBSITE_COPY_MODEL ?? 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: [
          'You are a UK sports and events calendar assistant.',
          'Return only major UK sporting fixtures.',
          'UK events only — no US events (no Thanksgiving, Super Bowl, etc.).',
          'Return valid ISO 8601 dates (YYYY-MM-DD) only.',
          'If you are not certain of an exact date, omit the event.',
          'Always return valid JSON matching the schema.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Today's date: ${toIsoDate(new Date())}`,
          `Window: ${startStr} to ${endStr}`,
          '',
          'Known bank holidays in this window (use as date anchors):',
          bankHolidayLines || '(none)',
          '',
          'List major UK sporting events in this window.',
          'Include: Six Nations, FA Cup rounds, Wimbledon, British GP, The Ashes, Cheltenham Festival, Grand National, Rugby World Cup (if applicable).',
          'Only include events with known or highly likely exact dates.',
          'Exclude events whose exact dates you are uncertain about.',
        ].join('\n'),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'uk_sporting_events',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['events'],
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['event_name', 'event_date', 'description'],
                properties: {
                  event_name: { type: 'string' },
                  event_date: { type: 'string', description: 'YYYY-MM-DD' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error('fetchSportingEvents: OpenAI request failed', res.status);
      return [];
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content) as { events?: OpenAiEvent[] };
    const events = parsed.events ?? [];

    return events
      .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
      .filter(e => e.event_date >= startStr && e.event_date <= endStr)
      .map(e => ({
        eventName: e.event_name.trim(),
        eventDate: e.event_date,
        category: 'sporting' as InspirationCategory,
        description: e.description?.trim() || null,
        source: 'openai' as InspirationSource,
      }));
  } catch (err) {
    console.error('fetchSportingEvents: unexpected error', err);
    return [];
  }
}

// ─── Main: merge & upsert ────────────────────────────────────────────────────

/**
 * Fetches inspiration items from all three sources, deduplicates, and upserts
 * to the DB. Returns the count of items inserted.
 *
 * Sources: gov.uk bank holidays API, algorithmically computed dates (getComputedDates),
 * and OpenAI for UK sporting fixtures.
 */
export async function generateInspirationItems(
  windowStart: Date,
  windowEnd: Date
): Promise<number> {
  const generatedAt = new Date().toISOString();

  // Fetch bank holidays first (used as OpenAI context)
  const bankHolidays = await fetchBankHolidays(windowStart, windowEnd);

  // Fetch sporting events (uses bank holidays as context)
  const sportingEvents = await fetchSportingEvents(windowStart, windowEnd, bankHolidays);

  // All computed dates (fixed seasonal + floating)
  const computedDates = getComputedDates(windowStart, windowEnd);

  const all = deduplicateItems([
    ...bankHolidays,
    ...computedDates,
    ...sportingEvents,
  ]).sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  console.log(
    `generateInspirationItems: bank_holiday=${bankHolidays.length} ` +
    `computed=${computedDates.length} ` +
    `sporting=${sportingEvents.length} total_after_dedup=${all.length}`
  );

  const db = createSupabaseAdminClient();

  // Step 1: Fetch current inspiration item IDs before deleting
  const { data: currentItems, error: selectError } = await db
    .from('planning_inspiration_items')
    .select('id');
  if (selectError) {
    console.error('generateInspirationItems: could not read current IDs', selectError);
    throw new Error(`Failed to read inspiration items: ${selectError.message}`);
  }
  const currentIds = (currentItems ?? []).map((r: { id: string }) => r.id);

  // Step 2: Delete dismissals pointing at items about to be replaced
  if (currentIds.length > 0) {
    await db
      .from('planning_inspiration_dismissals')
      .delete()
      .in('inspiration_item_id', currentIds);
  }

  // Step 3: Delete all existing inspiration items (replaced with fresh batch)
  // Supabase requires a filter on DELETE — this dummy neq filter deletes all rows
  // (no real ID can match this nil UUID) while satisfying the SDK constraint.
  await db
    .from('planning_inspiration_items')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (all.length === 0) return 0;

  // Step 4: Insert fresh batch
  const rows = all.map(item => ({
    event_name: item.eventName,
    event_date: item.eventDate,
    category: item.category,
    description: item.description,
    source: item.source,
    generated_at: generatedAt,
  }));

  const { error } = await db.from('planning_inspiration_items').insert(rows);
  if (error) {
    console.error('generateInspirationItems: insert failed', error);
    throw new Error(`Failed to insert inspiration items: ${error.message}`);
  }

  return all.length;
}
