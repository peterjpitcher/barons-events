"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { archiveArtistAction, createArtistAction } from "@/actions/artists";
import type { ArtistPerformanceSummary } from "@/lib/artists";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError } from "@/components/ui/field-error";
import { Plus, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

type ArtistsManagerProps = {
  artists: ArtistPerformanceSummary[];
};

type ArtistSortKey = "name" | "artistType" | "eventCount" | "averageSalesUpliftPercent" | "averageSentimentScore" | "effectivenessScore";
type SortDirection = "asc" | "desc";

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatScore(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}/100`;
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

export function ArtistsManager({ artists }: ArtistsManagerProps) {
  const [state, formAction] = useActionState(createArtistAction, undefined);
  const [archiveState, archiveFormAction] = useActionState(archiveArtistAction, undefined);
  const [sortBy, setSortBy] = useState<{ key: ArtistSortKey; direction: SortDirection }>({
    key: "name",
    direction: "asc"
  });
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const nameError = state?.fieldErrors?.name;

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      formRef.current?.reset();
      router.refresh();
    } else if (!state.fieldErrors) {
      toast.error(state.message);
    }
  }, [state, router]);

  useEffect(() => {
    if (!archiveState?.message) return;
    if (archiveState.success) {
      toast.success(archiveState.message);
      router.refresh();
      return;
    }
    toast.error(archiveState.message);
  }, [archiveState, router]);

  const sortedArtists = useMemo(() => {
    const list = [...artists];
    list.sort((left, right) => {
      const base = (() => {
        switch (sortBy.key) {
          case "name":
            return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
          case "artistType":
            return left.artistType.localeCompare(right.artistType, undefined, { sensitivity: "base" });
          case "eventCount":
            return left.eventCount - right.eventCount;
          case "averageSalesUpliftPercent":
            return compareNullableNumber(left.averageSalesUpliftPercent, right.averageSalesUpliftPercent);
          case "averageSentimentScore":
            return compareNullableNumber(left.averageSentimentScore, right.averageSentimentScore);
          case "effectivenessScore":
            return left.effectivenessScore - right.effectivenessScore;
          default:
            return 0;
        }
      })();

      if (base !== 0) {
        return sortBy.direction === "asc" ? base : -base;
      }

      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
    return list;
  }, [artists, sortBy]);

  const toggleSort = (key: ArtistSortKey) => {
    setSortBy((current) => {
      if (current.key !== key) {
        return { key, direction: "asc" };
      }
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  };

  const sortIcon = (key: ArtistSortKey) => {
    if (sortBy.key !== key) return <ArrowUpDown className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />;
    return sortBy.direction === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
    );
  };

  const ariaSort = (key: ArtistSortKey): "none" | "ascending" | "descending" => {
    if (sortBy.key !== key) return "none";
    return sortBy.direction === "asc" ? "ascending" : "descending";
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add an artist / band / host</CardTitle>
          <CardDescription>Create reusable artist records and link them to future events.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            ref={formRef}
            action={formAction}
            className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)_auto]"
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="artist-name">Name</Label>
              <Input
                id="artist-name"
                name="name"
                required
                placeholder="e.g. Randy and The Rockets"
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "artist-name-error" : undefined}
                className={nameError ? errorInputClass : undefined}
              />
              <FieldError id="artist-name-error" message={nameError} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="artist-type">Type</Label>
              <Select id="artist-type" name="artistType" defaultValue="artist">
                <option value="artist">Artist</option>
                <option value="band">Band</option>
                <option value="host">Host</option>
                <option value="dj">DJ</option>
                <option value="comedian">Comedian</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="artist-email">Email</Label>
              <Input id="artist-email" name="email" type="email" placeholder="Optional contact email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="artist-phone">Phone</Label>
              <Input id="artist-phone" name="phone" placeholder="Optional contact phone" />
            </div>
            <div className="flex items-end justify-end">
              <SubmitButton
                label="Add artist"
                pendingLabel="Saving..."
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                hideLabel
              />
            </div>
            <div className="md:col-span-5 space-y-2">
              <Label htmlFor="artist-description">Description</Label>
              <Input
                id="artist-description"
                name="description"
                placeholder="Optional summary of style, genre, audience fit, or USP."
              />
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="bg-[var(--color-muted-surface)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
              <th className="px-4 py-3" aria-sort={ariaSort("name")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
                  onClick={() => toggleSort("name")}
                >
                  Artist {sortIcon("name")}
                </button>
              </th>
              <th className="px-4 py-3" aria-sort={ariaSort("artistType")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
                  onClick={() => toggleSort("artistType")}
                >
                  Type {sortIcon("artistType")}
                </button>
              </th>
              <th className="px-4 py-3" aria-sort={ariaSort("eventCount")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
                  onClick={() => toggleSort("eventCount")}
                >
                  Events {sortIcon("eventCount")}
                </button>
              </th>
              <th className="px-4 py-3" aria-sort={ariaSort("averageSalesUpliftPercent")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
                  onClick={() => toggleSort("averageSalesUpliftPercent")}
                >
                  Avg uplift {sortIcon("averageSalesUpliftPercent")}
                </button>
              </th>
              <th className="px-4 py-3" aria-sort={ariaSort("averageSentimentScore")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
                  onClick={() => toggleSort("averageSentimentScore")}
                >
                  Sentiment {sortIcon("averageSentimentScore")}
                </button>
              </th>
              <th className="px-4 py-3" aria-sort={ariaSort("effectivenessScore")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
                  onClick={() => toggleSort("effectivenessScore")}
                >
                  Effectiveness {sortIcon("effectivenessScore")}
                </button>
              </th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {artists.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-subtle">
                  No artists yet. Add your first artist above.
                </td>
              </tr>
            ) : (
              sortedArtists.map((artist) => (
                <tr key={artist.id} className="border-t border-[var(--color-border)]">
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/artists/${artist.id}`}
                      className="font-medium text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-700)]"
                    >
                      {artist.name}
                    </Link>
                    <p className="mt-1 text-xs text-subtle">
                      {artist.email ?? "No email"} · {artist.phone ?? "No phone"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-sm">{artist.artistType}</td>
                  <td className="px-4 py-3 text-sm">{artist.eventCount}</td>
                  <td className="px-4 py-3 text-sm">{formatPercent(artist.averageSalesUpliftPercent)}</td>
                  <td className="px-4 py-3 text-sm">{formatScore(artist.averageSentimentScore === null ? null : (artist.averageSentimentScore + 1) * 50)}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-[var(--color-primary-700)]">
                    {formatScore(artist.effectivenessScore)}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/artists/${artist.id}`}>Edit</Link>
                      </Button>
                      <form action={archiveFormAction}>
                        <input type="hidden" name="artistId" value={artist.id} />
                        <SubmitButton label="Archive" pendingLabel="Archiving..." variant="destructive" size="sm" />
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
