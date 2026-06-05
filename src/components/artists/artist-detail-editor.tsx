"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { archiveArtistAction, updateArtistAction } from "@/actions/artists";
import type { ArtistDetail } from "@/lib/artists";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError } from "@/components/ui/field-error";
import { formatCurrency } from "@/lib/utils/format";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/design-primitives";

type ArtistDetailEditorProps = {
  artist: ArtistDetail;
  canEdit?: boolean;
};

const scoreTone = (value: number): "success" | "info" | "warning" | "danger" => {
  if (value >= 75) return "success";
  if (value >= 60) return "info";
  if (value >= 45) return "warning";
  return "danger";
};

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatSentiment(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${((value + 1) * 50).toFixed(0)}/100`;
}

export function ArtistDetailEditor({ artist, canEdit = false }: ArtistDetailEditorProps) {
  const [state, formAction] = useActionState(updateArtistAction, undefined);
  const [archiveState, archiveFormAction] = useActionState(archiveArtistAction, undefined);
  const router = useRouter();
  const nameError = state?.fieldErrors?.name;

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      router.refresh();
    } else if (!state.fieldErrors) {
      toast.error(state.message);
    }
  }, [state, router]);

  useEffect(() => {
    if (!archiveState?.message) return;
    if (archiveState.success) {
      toast.success(archiveState.message);
      router.push("/artists");
      router.refresh();
      return;
    }
    toast.error(archiveState.message);
  }, [archiveState, router]);

  return (
    <div className="app-page">
      <Link href="/artists" className="text-sm text-subtle underline">
        ← Back to artists
      </Link>
      <div className="hidden md:block">
        <PageHeader
          eyebrow="Artist profile"
          title={artist.name}
          description={`${artist.eventCount} linked event${artist.eventCount === 1 ? "" : "s"} · ${artist.debriefCount} debrief${artist.debriefCount === 1 ? "" : "s"}`}
          actions={
            <Badge variant={scoreTone(artist.effectivenessScore)}>
              Effectiveness {Math.round(artist.effectivenessScore)}/100
            </Badge>
          }
        />
      </div>
      <section className="mobile-card text-center md:hidden">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--navy)] text-xl font-semibold text-white">
          {artist.name.slice(0, 2).toUpperCase()}
        </div>
        <h1 className="mt-3 text-xl font-semibold text-[var(--navy)]">{artist.name}</h1>
        <p className="mt-1 text-sm capitalize text-[var(--ink-muted)]">{artist.artistType}</p>
        <Badge variant={scoreTone(artist.effectivenessScore)} className="mt-3">
          Effectiveness {Math.round(artist.effectivenessScore)}/100
        </Badge>
        <div className="mt-4 grid grid-cols-2 gap-2 text-left">
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-3">
            <p className="text-[0.68rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">Events</p>
            <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{artist.eventCount}</p>
          </div>
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-3">
            <p className="text-[0.68rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">Debriefs</p>
            <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{artist.debriefCount}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          {artist.phone ? (
            <a href={`tel:${artist.phone}`} className="inline-flex h-11 items-center justify-center rounded-[8px] bg-[var(--navy)] text-sm font-semibold text-white">
              Call artist
            </a>
          ) : null}
          {artist.email ? (
            <a href={`mailto:${artist.email}`} className="inline-flex h-11 items-center justify-center rounded-[8px] border border-[var(--hair)] text-sm font-semibold text-[var(--ink)]">
              Email artist
            </a>
          ) : null}
        </div>
      </section>
      <Card className="mobile-card md:rounded-[var(--radius-lg)]">
        <CardHeader>
          <CardTitle>Performance snapshot</CardTitle>
          <CardDescription>Debrief metrics from linked events.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <p>
            <span className="font-semibold text-[var(--ink)]">Avg sales uplift:</span>{" "}
            {formatPercent(artist.averageSalesUpliftPercent)}
          </p>
          <p>
            <span className="font-semibold text-[var(--ink)]">Avg promo score:</span>{" "}
            {artist.averagePromoEffectiveness ? `${artist.averagePromoEffectiveness.toFixed(2)}/5` : "—"}
          </p>
          <p>
            <span className="font-semibold text-[var(--ink)]">Sentiment:</span>{" "}
            {formatSentiment(artist.averageSentimentScore)}
          </p>
          <p>
            <span className="font-semibold text-[var(--ink)]">Would book again:</span>{" "}
            {formatPercent(artist.wouldBookAgainRate)}
          </p>
        </CardContent>
      </Card>

      <Card className="mobile-card md:rounded-[var(--radius-lg)]">
        <CardHeader>
          <CardTitle>Artist profile</CardTitle>
          <CardDescription>Keep contacts and descriptions current so future booking is quick.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4" noValidate>
            <input type="hidden" name="artistId" value={artist.id} />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="artist-name">Name</Label>
                <Input
                  id="artist-name"
                  name="name"
                  defaultValue={artist.name}
                  disabled={!canEdit}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? "artist-name-error" : undefined}
                  className="h-12 text-[16px] md:h-10 md:text-sm"
                />
                <FieldError id="artist-name-error" message={nameError} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="artist-type">Type</Label>
                <Select id="artist-type" name="artistType" defaultValue={artist.artistType} disabled={!canEdit} className="h-12 text-[16px] md:h-10 md:text-sm">
                  <option value="artist">Artist</option>
                  <option value="band">Band</option>
                  <option value="host">Host</option>
                  <option value="dj">DJ</option>
                  <option value="comedian">Comedian</option>
                  <option value="other">Other</option>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="artist-email">Email</Label>
                <Input id="artist-email" name="email" type="email" autoComplete="email" defaultValue={artist.email ?? ""} disabled={!canEdit} className="h-12 text-[16px] md:h-10 md:text-sm" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="artist-phone">Phone</Label>
                <Input id="artist-phone" name="phone" type="tel" autoComplete="tel" defaultValue={artist.phone ?? ""} disabled={!canEdit} className="h-12 text-[16px] md:h-10 md:text-sm" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="artist-description">Description</Label>
              <Textarea
                id="artist-description"
                name="description"
                rows={4}
                defaultValue={artist.description ?? ""}
                disabled={!canEdit}
                placeholder="Genre, crowd fit, known strengths, and operational notes."
                className="text-[16px] md:text-sm"
              />
            </div>
            {canEdit ? (
              <div className="grid gap-2 md:flex md:flex-wrap md:justify-end">
                <SubmitButton
                  label="Archive artist"
                  pendingLabel="Archiving..."
                  variant="destructive"
                  formAction={archiveFormAction}
                  className="h-11 md:h-10"
                />
                <SubmitButton label="Save artist" pendingLabel="Saving..." variant="secondary" className="h-11 md:h-10" />
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card className="mobile-card md:rounded-[var(--radius-lg)]">
        <CardHeader>
          <CardTitle>Linked event debriefs</CardTitle>
          <CardDescription>All debrief outcomes for this artist in one timeline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {artist.events.length === 0 ? (
            <p className="text-sm text-subtle">No linked events yet.</p>
          ) : (
            artist.events.map((entry) => (
              <div
                key={`${entry.eventId}-${entry.startAt}`}
                className="mobile-list-card text-sm md:rounded-[8px]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/events/${entry.eventId}`}
                      className="font-semibold text-[var(--ink)] transition-colors hover:text-[var(--navy)]"
                    >
                      {entry.eventTitle}
                    </Link>
                    <p className="text-xs text-subtle">
                      {new Date(entry.startAt).toLocaleString("en-GB")} · {entry.venueName ?? "Unknown venue"}
                    </p>
                  </div>
                  <Badge variant="neutral">{entry.status.replace(/_/g, " ")}</Badge>
                </div>
                {entry.debrief ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <p>
                      <span className="font-medium text-[var(--ink)]">Attendance:</span>{" "}
                      {entry.debrief.attendance ?? "—"}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--ink)]">Promo score:</span>{" "}
                      {entry.debrief.promo_effectiveness ? `${entry.debrief.promo_effectiveness}/5` : "—"}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--ink)]">Event takings:</span>{" "}
                      {formatCurrency(entry.debrief.actual_total_takings)}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--ink)]">Sales uplift:</span>{" "}
                      {formatPercent(entry.debrief.sales_uplift_percent)}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--ink)]">Sentiment score:</span>{" "}
                      {formatSentiment(entry.sentimentScore)}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--ink)]">Would book again:</span>{" "}
                      {typeof entry.debrief.would_book_again === "boolean"
                        ? entry.debrief.would_book_again
                          ? "Yes"
                          : "No"
                        : "—"}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-subtle">No debrief submitted yet for this event.</p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
