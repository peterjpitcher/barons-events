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
import { Badge } from "@/components/ui/badge";

type ArtistDetailEditorProps = {
  artist: ArtistDetail;
};

const scoreTone = (value: number): "success" | "info" | "warning" | "danger" => {
  if (value >= 75) return "success";
  if (value >= 60) return "info";
  if (value >= 45) return "warning";
  return "danger";
};

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatSentiment(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${((value + 1) * 50).toFixed(0)}/100`;
}

export function ArtistDetailEditor({ artist }: ArtistDetailEditorProps) {
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
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>{artist.name}</CardTitle>
            <CardDescription>
              {artist.eventCount} linked event{artist.eventCount === 1 ? "" : "s"} · {artist.debriefCount} debrief
              {artist.debriefCount === 1 ? "" : "s"}
            </CardDescription>
          </div>
          <Badge variant={scoreTone(artist.effectivenessScore)}>
            Effectiveness {Math.round(artist.effectivenessScore)}/100
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <p>
            <span className="font-semibold text-[var(--color-text)]">Avg sales uplift:</span>{" "}
            {formatPercent(artist.averageSalesUpliftPercent)}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">Avg promo score:</span>{" "}
            {artist.averagePromoEffectiveness ? `${artist.averagePromoEffectiveness.toFixed(2)}/5` : "—"}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">Sentiment:</span>{" "}
            {formatSentiment(artist.averageSentimentScore)}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">Would book again:</span>{" "}
            {formatPercent(artist.wouldBookAgainRate)}
          </p>
        </CardContent>
      </Card>

      <Card>
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
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? "artist-name-error" : undefined}
                />
                <FieldError id="artist-name-error" message={nameError} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="artist-type">Type</Label>
                <Select id="artist-type" name="artistType" defaultValue={artist.artistType}>
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
                <Input id="artist-email" name="email" type="email" defaultValue={artist.email ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="artist-phone">Phone</Label>
                <Input id="artist-phone" name="phone" defaultValue={artist.phone ?? ""} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="artist-description">Description</Label>
              <Textarea
                id="artist-description"
                name="description"
                rows={4}
                defaultValue={artist.description ?? ""}
                placeholder="Genre, crowd fit, known strengths, and operational notes."
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <SubmitButton
                label="Archive artist"
                pendingLabel="Archiving..."
                variant="destructive"
                formAction={archiveFormAction}
              />
              <SubmitButton label="Save artist" pendingLabel="Saving..." variant="secondary" />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
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
                className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white/80 p-4 text-sm shadow-soft"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/events/${entry.eventId}`}
                      className="font-semibold text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-700)]"
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
                      <span className="font-medium text-[var(--color-text)]">Attendance:</span>{" "}
                      {entry.debrief.attendance ?? "—"}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--color-text)]">Promo score:</span>{" "}
                      {entry.debrief.promo_effectiveness ? `${entry.debrief.promo_effectiveness}/5` : "—"}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--color-text)]">Event takings:</span>{" "}
                      {formatCurrency(entry.debrief.actual_total_takings)}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--color-text)]">Sales uplift:</span>{" "}
                      {formatPercent(entry.debrief.sales_uplift_percent)}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--color-text)]">Sentiment score:</span>{" "}
                      {formatSentiment(entry.sentimentScore)}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--color-text)]">Would book again:</span>{" "}
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
