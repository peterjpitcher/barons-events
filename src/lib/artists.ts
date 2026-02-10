import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type ArtistRow = Database["public"]["Tables"]["artists"]["Row"];
type EventArtistRow = Database["public"]["Tables"]["event_artists"]["Row"];
type DebriefRow = Database["public"]["Tables"]["debriefs"]["Row"];

const ARTIST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_TERMS = [
  "amazing",
  "brilliant",
  "great",
  "excellent",
  "fantastic",
  "buzz",
  "busy",
  "packed",
  "popular",
  "uplift",
  "strong",
  "loved",
  "impressive",
  "successful",
  "recommend"
];
const NEGATIVE_TERMS = [
  "poor",
  "quiet",
  "slow",
  "flat",
  "late",
  "issue",
  "problem",
  "complaint",
  "weak",
  "low",
  "disappoint",
  "cancel",
  "refund",
  "confused",
  "no-show"
];

export type ArtistOption = {
  id: string;
  name: string;
  artistType: string;
  email: string | null;
  phone: string | null;
  description: string | null;
  isCurated?: boolean;
  isArchived?: boolean;
};

export type ArtistPerformanceSummary = ArtistOption & {
  eventCount: number;
  debriefCount: number;
  averageSalesUpliftPercent: number | null;
  averagePromoEffectiveness: number | null;
  averageSentimentScore: number | null;
  wouldBookAgainRate: number | null;
  effectivenessScore: number;
};

export type ArtistEventDebrief = {
  eventId: string;
  eventTitle: string;
  eventType: string;
  status: string;
  startAt: string;
  venueName: string | null;
  billingOrder: number;
  roleLabel: string | null;
  debrief: DebriefRow | null;
  sentimentScore: number | null;
};

export type ArtistDetail = ArtistPerformanceSummary & {
  events: ArtistEventDebrief[];
};

type SyncEventArtistsParams = {
  eventId: string;
  actorId: string;
  artistIds?: string[];
  artistNames?: string[];
};

function normaliseOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normaliseArtistName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function parseArtistNames(value: string | null | undefined): string[] {
  if (!value) return [];
  const unique = new Set<string>();
  value
    .split(",")
    .map((item) => normaliseArtistName(item))
    .filter(Boolean)
    .forEach((item) => unique.add(item));
  return Array.from(unique);
}

function scoreSentimentFromTexts(texts: Array<string | null | undefined>): number | null {
  const merged = texts
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (!merged.trim().length) return null;

  let positive = 0;
  let negative = 0;
  POSITIVE_TERMS.forEach((term) => {
    const matches = merged.match(new RegExp(`\\b${term}\\w*\\b`, "g"));
    positive += matches?.length ?? 0;
  });
  NEGATIVE_TERMS.forEach((term) => {
    const matches = merged.match(new RegExp(`\\b${term}\\w*\\b`, "g"));
    negative += matches?.length ?? 0;
  });

  if (positive === 0 && negative === 0) return 0;

  const score = (positive - negative) / (positive + negative);
  return Math.max(-1, Math.min(1, score));
}

function average(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!filtered.length) return null;
  return filtered.reduce((total, value) => total + value, 0) / filtered.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toUpliftScore(upliftPercent: number | null): number {
  if (upliftPercent === null) return 50;
  const clipped = clamp(upliftPercent, -50, 150);
  return ((clipped + 50) / 200) * 100;
}

function toSentimentScore(sentiment: number | null): number {
  if (sentiment === null) return 50;
  return ((clamp(sentiment, -1, 1) + 1) / 2) * 100;
}

function toPromoScore(promo: number | null): number {
  if (promo === null) return 50;
  return clamp((promo / 5) * 100, 0, 100);
}

function toRebookScore(rate: number | null): number {
  if (rate === null) return 50;
  return clamp(rate, 0, 100);
}

function getDebriefUpliftPercent(debrief: DebriefRow | null): number | null {
  if (!debrief) return null;
  if (typeof debrief.sales_uplift_percent === "number" && Number.isFinite(debrief.sales_uplift_percent)) {
    return debrief.sales_uplift_percent;
  }

  const wet = typeof debrief.wet_takings === "number" ? debrief.wet_takings : null;
  const food = typeof debrief.food_takings === "number" ? debrief.food_takings : null;
  const baselineWet = typeof debrief.baseline_wet_takings === "number" ? debrief.baseline_wet_takings : null;
  const baselineFood = typeof debrief.baseline_food_takings === "number" ? debrief.baseline_food_takings : null;
  const actualTotal = (wet ?? 0) + (food ?? 0);
  const baselineTotal = (baselineWet ?? 0) + (baselineFood ?? 0);
  if (baselineTotal <= 0) return null;
  return ((actualTotal - baselineTotal) / baselineTotal) * 100;
}

function buildPerformanceFromDebriefs(debriefs: DebriefRow[]): Omit<
  ArtistPerformanceSummary,
  keyof ArtistOption | "eventCount" | "debriefCount"
> {
  const upliftAvg = average(debriefs.map(getDebriefUpliftPercent));
  const promoAvg = average(debriefs.map((debrief) => debrief.promo_effectiveness));
  const sentimentAvg = average(
    debriefs.map((debrief) =>
      scoreSentimentFromTexts([
        debrief.highlights,
        debrief.issues,
        debrief.guest_sentiment_notes,
        debrief.operational_notes,
        debrief.next_time_actions
      ])
    )
  );
  const rebookAnswers = debriefs.filter((debrief) => typeof debrief.would_book_again === "boolean");
  const rebookRate = rebookAnswers.length
    ? (rebookAnswers.filter((debrief) => debrief.would_book_again).length / rebookAnswers.length) * 100
    : null;

  const effectivenessScore = Math.round(
    toUpliftScore(upliftAvg) * 0.4 +
      toSentimentScore(sentimentAvg) * 0.25 +
      toPromoScore(promoAvg) * 0.2 +
      toRebookScore(rebookRate) * 0.15
  );

  return {
    averageSalesUpliftPercent: upliftAvg,
    averagePromoEffectiveness: promoAvg,
    averageSentimentScore: sentimentAvg,
    wouldBookAgainRate: rebookRate,
    effectivenessScore
  };
}

export async function listArtists(): Promise<ArtistOption[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("artists")
    .select("*")
    .eq("is_curated", true)
    .eq("is_archived", false)
    .order("name");

  if (error) {
    throw new Error(`Could not load artists: ${error.message}`);
  }

  return ((data ?? []) as ArtistRow[]).map((artist) => ({
    id: artist.id,
    name: artist.name,
    artistType: artist.artist_type,
    email: artist.email,
    phone: artist.phone,
    description: artist.description,
    isCurated: artist.is_curated,
    isArchived: artist.is_archived
  }));
}

export async function listArchivedArtists(): Promise<ArtistOption[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase.from("artists").select("*").eq("is_archived", true).order("name");

  if (error) {
    throw new Error(`Could not load archived artists: ${error.message}`);
  }

  return ((data ?? []) as ArtistRow[]).map((artist) => ({
    id: artist.id,
    name: artist.name,
    artistType: artist.artist_type,
    email: artist.email,
    phone: artist.phone,
    description: artist.description,
    isCurated: artist.is_curated,
    isArchived: artist.is_archived
  }));
}

export async function listArtistsWithPerformance(): Promise<ArtistPerformanceSummary[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("artists")
    .select(
      `
      *,
      event_links:event_artists(
        event_id,
        event:events(
          id,
          debrief:debriefs(*)
        )
      )
    `
    )
    .eq("is_curated", true)
    .eq("is_archived", false)
    .order("name");

  if (error) {
    throw new Error(`Could not load artist performance: ${error.message}`);
  }

  return ((data ?? []) as any[]).map((row) => {
    const links = Array.isArray(row.event_links) ? row.event_links : [];
    const debriefEntries: Array<DebriefRow | null> = links.map((link: any): DebriefRow | null => {
        const eventValue = Array.isArray(link?.event) ? link.event[0] : link?.event;
        const debriefValue = Array.isArray(eventValue?.debrief) ? eventValue.debrief[0] : eventValue?.debrief;
        return debriefValue && typeof debriefValue === "object" ? (debriefValue as DebriefRow) : null;
      });
    const debriefs = debriefEntries.filter((entry): entry is DebriefRow => Boolean(entry));

    const performance = buildPerformanceFromDebriefs(debriefs);
    const eventIds = new Set<string>();
    links.forEach((link: any) => {
      const eventValue = Array.isArray(link?.event) ? link.event[0] : link?.event;
      if (typeof eventValue?.id === "string") eventIds.add(eventValue.id);
    });

    return {
      id: row.id,
      name: row.name,
      artistType: row.artist_type,
      email: row.email,
      phone: row.phone,
      description: row.description,
      isArchived: row.is_archived,
      eventCount: eventIds.size,
      debriefCount: debriefs.length,
      ...performance
    };
  });
}

export async function getArtistDetail(artistId: string): Promise<ArtistDetail | null> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("artists")
    .select(
      `
      *,
      event_links:event_artists(
        billing_order,
        role_label,
        event:events(
          id,
          title,
          event_type,
          status,
          start_at,
          venue:venues(name),
          debrief:debriefs(*)
        )
      )
    `
    )
    .eq("id", artistId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load artist detail: ${error.message}`);
  }
  if (!data) return null;

  const links = Array.isArray((data as any).event_links) ? (data as any).event_links : [];
  const eventEntries: Array<ArtistEventDebrief | null> = links.map((link: any): ArtistEventDebrief | null => {
      const eventValue = Array.isArray(link?.event) ? link.event[0] : link?.event;
      if (!eventValue || typeof eventValue.id !== "string") return null;
      const venueValue = Array.isArray(eventValue.venue) ? eventValue.venue[0] : eventValue.venue;
      const debriefValue = Array.isArray(eventValue.debrief) ? eventValue.debrief[0] : eventValue.debrief;
      const debrief = debriefValue && typeof debriefValue === "object" ? (debriefValue as DebriefRow) : null;
      return {
        eventId: eventValue.id,
        eventTitle: eventValue.title,
        eventType: eventValue.event_type,
        status: eventValue.status,
        startAt: eventValue.start_at,
        venueName: typeof venueValue?.name === "string" ? venueValue.name : null,
        billingOrder: typeof link.billing_order === "number" ? link.billing_order : 1,
        roleLabel: normaliseOptionalText(link.role_label),
        debrief,
        sentimentScore: debrief
          ? scoreSentimentFromTexts([
              debrief.highlights,
              debrief.issues,
              debrief.guest_sentiment_notes,
              debrief.operational_notes,
              debrief.next_time_actions
            ])
          : null
      } as ArtistEventDebrief;
    });
  const events = eventEntries
    .filter((entry): entry is ArtistEventDebrief => Boolean(entry))
    .sort((left: ArtistEventDebrief, right: ArtistEventDebrief) => {
      if (left.billingOrder !== right.billingOrder) return left.billingOrder - right.billingOrder;
      return new Date(right.startAt).getTime() - new Date(left.startAt).getTime();
    });

  const debriefs = events.map((entry) => entry.debrief).filter((entry): entry is DebriefRow => Boolean(entry));
  const performance = buildPerformanceFromDebriefs(debriefs);

  return {
    id: data.id,
    name: data.name,
    artistType: data.artist_type,
    email: data.email,
    phone: data.phone,
    description: data.description,
    isArchived: data.is_archived,
    eventCount: events.length,
    debriefCount: debriefs.length,
    ...performance,
    events
  };
}

export async function createArtist(payload: {
  name: string;
  artistType: string;
  email?: string | null;
  phone?: string | null;
  description?: string | null;
  createdBy?: string | null;
}): Promise<ArtistRow> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("artists")
    .insert({
      name: normaliseArtistName(payload.name),
      artist_type: payload.artistType,
      email: normaliseOptionalText(payload.email),
      phone: normaliseOptionalText(payload.phone),
      description: normaliseOptionalText(payload.description),
      is_curated: true,
      is_archived: false,
      created_by: payload.createdBy ?? null
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not create artist: ${error.message}`);
  }

  return data as ArtistRow;
}

export async function updateArtist(
  artistId: string,
  updates: {
    name: string;
    artistType: string;
    email?: string | null;
    phone?: string | null;
    description?: string | null;
  }
): Promise<ArtistRow> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("artists")
    .update({
      name: normaliseArtistName(updates.name),
      artist_type: updates.artistType,
      email: normaliseOptionalText(updates.email),
      phone: normaliseOptionalText(updates.phone),
      description: normaliseOptionalText(updates.description),
      is_curated: true
    })
    .eq("id", artistId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not update artist: ${error.message}`);
  }

  return data as ArtistRow;
}

export async function setArtistArchived(artistId: string, archived: boolean): Promise<ArtistRow> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("artists")
    .update({
      is_archived: archived,
      is_curated: true
    })
    .eq("id", artistId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not ${archived ? "archive" : "restore"} artist: ${error.message}`);
  }

  return data as ArtistRow;
}

function artistHasProfileData(artist: Pick<ArtistRow, "artist_type" | "email" | "phone" | "description">): boolean {
  return (
    artist.artist_type !== "artist" ||
    Boolean(normaliseOptionalText(artist.email)) ||
    Boolean(normaliseOptionalText(artist.phone)) ||
    Boolean(normaliseOptionalText(artist.description))
  );
}

export async function cleanupOrphanArtists(params: {
  candidateArtistIds: string[];
  maxDeletes?: number;
}): Promise<{
  deletedCount: number;
  deletedArtistIds: string[];
  deletedArtistNames: string[];
}> {
  const candidateArtistIds = Array.from(
    new Set(
      (params.candidateArtistIds ?? []).filter(
        (artistId): artistId is string => typeof artistId === "string" && ARTIST_ID_PATTERN.test(artistId)
      )
    )
  );
  if (!candidateArtistIds.length) {
    return { deletedCount: 0, deletedArtistIds: [], deletedArtistNames: [] };
  }

  const maxDeletes = Math.max(1, Math.min(100, params.maxDeletes ?? 25));
  const supabase = await createSupabaseActionClient();

  const { data: artistRows, error: artistsError } = await supabase
    .from("artists")
    .select("id,name,artist_type,email,phone,description,is_curated,is_archived")
    .in("id", candidateArtistIds);
  if (artistsError) {
    throw new Error(`Could not load artists for cleanup: ${artistsError.message}`);
  }

  const { data: linkRows, error: linkError } = await supabase
    .from("event_artists")
    .select("artist_id")
    .in("artist_id", candidateArtistIds);
  if (linkError) {
    throw new Error(`Could not load artist links for cleanup: ${linkError.message}`);
  }

  const linkedArtistIds = new Set(
    ((linkRows ?? []) as Array<{ artist_id: string | null }>).map((entry) => entry.artist_id).filter((value): value is string => Boolean(value))
  );

  const cleanupCandidates = ((artistRows ?? []) as ArtistRow[])
    .filter((artist) => !linkedArtistIds.has(artist.id))
    .filter((artist) => !artist.is_curated)
    .filter((artist) => !artist.is_archived)
    .filter((artist) => !artistHasProfileData(artist))
    .slice(0, maxDeletes);

  const artistIdsToDelete = cleanupCandidates.map((artist) => artist.id);
  if (!artistIdsToDelete.length) {
    return { deletedCount: 0, deletedArtistIds: [], deletedArtistNames: [] };
  }

  const { error: deleteError } = await supabase.from("artists").delete().in("id", artistIdsToDelete);
  if (deleteError) {
    throw new Error(`Could not clean orphan artists: ${deleteError.message}`);
  }

  return {
    deletedCount: artistIdsToDelete.length,
    deletedArtistIds: artistIdsToDelete,
    deletedArtistNames: cleanupCandidates.map((artist) => artist.name)
  };
}

export async function syncEventArtists(params: SyncEventArtistsParams): Promise<{
  previousNames: string[];
  nextNames: string[];
  unresolvedNames: string[];
}> {
  const supabase = await createSupabaseActionClient();

  const cleanedIds = Array.from(
    new Set((params.artistIds ?? []).filter((id): id is string => typeof id === "string" && ARTIST_ID_PATTERN.test(id)))
  );
  const cleanedNames = Array.from(new Set((params.artistNames ?? []).map((name) => normaliseArtistName(name)).filter(Boolean)));

  const { data: allArtists, error: allArtistsError } = await supabase.from("artists").select("*");
  if (allArtistsError) {
    throw new Error(`Could not load artist directory: ${allArtistsError.message}`);
  }

  const byId = new Map<string, ArtistRow>();
  const byName = new Map<string, ArtistRow>();
  ((allArtists ?? []) as ArtistRow[]).forEach((artist) => {
    byId.set(artist.id, artist);
    if (!artist.is_archived) {
      byName.set(artist.name.toLowerCase(), artist);
    }
  });

  const resolvedIds: string[] = [];
  cleanedIds.forEach((artistId) => {
    if (byId.has(artistId) && !resolvedIds.includes(artistId)) {
      resolvedIds.push(artistId);
    }
  });
  const unresolvedNames: string[] = [];

  cleanedNames.forEach((name) => {
    const artist = byName.get(name.toLowerCase());
    if (!artist) {
      unresolvedNames.push(name);
      return;
    }
    if (artist && !resolvedIds.includes(artist.id)) {
      resolvedIds.push(artist.id);
    }
  });

  const { data: existingLinks, error: existingError } = await supabase
    .from("event_artists")
    .select("artist_id, artist:artists(name)")
    .eq("event_id", params.eventId)
    .order("billing_order", { ascending: true });

  if (existingError) {
    throw new Error(`Could not load existing event artists: ${existingError.message}`);
  }

  const previousNames = ((existingLinks ?? []) as any[])
    .map((entry) => {
      const artistValue = Array.isArray(entry.artist) ? entry.artist[0] : entry.artist;
      return typeof artistValue?.name === "string" ? artistValue.name : null;
    })
    .filter((name): name is string => Boolean(name));

  const { error: clearError } = await supabase.from("event_artists").delete().eq("event_id", params.eventId);
  if (clearError) {
    throw new Error(`Could not replace event artists: ${clearError.message}`);
  }

  if (resolvedIds.length > 0) {
    const rows = resolvedIds.map((artistId, index) => ({
      event_id: params.eventId,
      artist_id: artistId,
      billing_order: index + 1,
      created_by: params.actorId
    }));
    const { error: insertLinksError } = await supabase.from("event_artists").insert(rows);
    if (insertLinksError) {
      throw new Error(`Could not save event artists: ${insertLinksError.message}`);
    }
  }

  const nextNames = resolvedIds.map((artistId) => byId.get(artistId)?.name).filter((name): name is string => Boolean(name));

  return { previousNames, nextNames, unresolvedNames };
}

export function eventArtistNamesFromLinks(links: Array<EventArtistRow & { artist?: ArtistRow | null }>): string[] {
  return links
    .map((link) => normaliseOptionalText(link.artist?.name ?? null))
    .filter((name): name is string => Boolean(name));
}
