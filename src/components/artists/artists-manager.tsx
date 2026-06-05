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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Plus, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

type ArtistsManagerProps = {
  artists: ArtistPerformanceSummary[];
  canEdit?: boolean;
};

type ArtistSortKey = "name" | "artistType" | "eventCount" | "averageSalesUpliftPercent" | "averageSentimentScore" | "effectivenessScore";
type SortDirection = "asc" | "desc";

const errorInputClass = "!border-[var(--burgundy)] focus-visible:!border-[var(--burgundy)]";

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

export function ArtistsManager({ artists, canEdit = false }: ArtistsManagerProps) {
  const [state, formAction] = useActionState(createArtistAction, undefined);
  const [archiveState, archiveFormAction] = useActionState(archiveArtistAction, undefined);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
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
      setCreateOpen(false);
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

  const artistTypes = useMemo(
    () => Array.from(new Set(artists.map((artist) => artist.artistType))).sort(),
    [artists]
  );

  const filteredArtists = useMemo(() => {
    const term = search.trim().toLowerCase();
    return artists.filter((artist) => {
      if (typeFilter !== "all" && artist.artistType !== typeFilter) return false;
      if (!term) return true;
      return [
        artist.name,
        artist.artistType,
        artist.email ?? "",
        artist.phone ?? ""
      ].some((value) => value.toLowerCase().includes(term));
    });
  }, [artists, search, typeFilter]);

  const sortedArtists = useMemo(() => {
    const list = [...filteredArtists];
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
  }, [filteredArtists, sortBy]);

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

  const createForm = (mobileSheet = false) => (
    <Card className={mobileSheet ? "border-0 shadow-none" : undefined}>
      <CardHeader className={mobileSheet ? "hidden" : undefined}>
        <CardTitle>Add an artist / band / host</CardTitle>
        <CardDescription>Create reusable artist records and link them to future events.</CardDescription>
      </CardHeader>
      <CardContent className={mobileSheet ? "p-0" : undefined}>
        <form
          ref={formRef}
          action={formAction}
          className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)_auto]"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor={mobileSheet ? "mobile-artist-name" : "artist-name"}>Name</Label>
            <Input
              id={mobileSheet ? "mobile-artist-name" : "artist-name"}
              name="name"
              required
              placeholder="e.g. Randy and The Rockets"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? `${mobileSheet ? "mobile-" : ""}artist-name-error` : undefined}
              className={cn("h-12 text-[16px] md:h-10 md:text-sm", nameError ? errorInputClass : undefined)}
            />
            <FieldError id={`${mobileSheet ? "mobile-" : ""}artist-name-error`} message={nameError} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={mobileSheet ? "mobile-artist-type" : "artist-type"}>Type</Label>
            <Select id={mobileSheet ? "mobile-artist-type" : "artist-type"} name="artistType" defaultValue="artist" className="h-12 text-[16px] md:h-10 md:text-sm">
              <option value="artist">Artist</option>
              <option value="band">Band</option>
              <option value="host">Host</option>
              <option value="dj">DJ</option>
              <option value="comedian">Comedian</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={mobileSheet ? "mobile-artist-email" : "artist-email"}>Email</Label>
            <Input id={mobileSheet ? "mobile-artist-email" : "artist-email"} name="email" type="email" autoComplete="email" placeholder="Optional contact email" className="h-12 text-[16px] md:h-10 md:text-sm" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={mobileSheet ? "mobile-artist-phone" : "artist-phone"}>Phone</Label>
            <Input id={mobileSheet ? "mobile-artist-phone" : "artist-phone"} name="phone" type="tel" autoComplete="tel" placeholder="Optional contact phone" className="h-12 text-[16px] md:h-10 md:text-sm" />
          </div>
          <div className="flex items-end justify-end">
            <SubmitButton
              label="Add artist"
              pendingLabel="Saving..."
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              hideLabel={!mobileSheet}
              className="h-11 w-full md:h-10 md:w-auto"
            />
          </div>
          <div className="md:col-span-5 space-y-2">
            <Label htmlFor={mobileSheet ? "mobile-artist-description" : "artist-description"}>Description</Label>
            <Input
              id={mobileSheet ? "mobile-artist-description" : "artist-description"}
              name="description"
              placeholder="Optional summary of style, genre, audience fit, or USP."
              className="h-12 text-[16px] md:h-10 md:text-sm"
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5">
      {canEdit ? (
        <>
          <div className="md:hidden">
            <Button type="button" variant="primary" className="h-11 w-full" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add artist
            </Button>
            <Sheet open={createOpen} onOpenChange={setCreateOpen}>
              <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Add artist</SheetTitle>
                </SheetHeader>
                <div className="p-5">{createForm(true)}</div>
              </SheetContent>
            </Sheet>
          </div>
          <div className="hidden md:block">{createForm()}</div>
        </>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search artists"
            className="mobile-search md:h-8 md:max-w-xs md:text-sm"
          />
          <div className="mobile-scroll-row md:flex md:flex-wrap md:justify-end md:gap-2">
            <button type="button" className={cn("mobile-chip", typeFilter === "all" && "mobile-chip-active")} onClick={() => setTypeFilter("all")}>
              All
            </button>
            {artistTypes.map((type) => (
              <button key={type} type="button" className={cn("mobile-chip capitalize", typeFilter === type && "mobile-chip-active")} onClick={() => setTypeFilter(type)}>
                {type}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2 md:hidden">
          {sortedArtists.length === 0 ? (
            <p className="mobile-card py-8 text-center text-sm text-[var(--ink-soft)]">No artists match your filters.</p>
          ) : (
            sortedArtists.map((artist) => (
              <div key={artist.id} className="mobile-list-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/artists/${artist.id}`} className="block truncate font-semibold text-[var(--ink)]">
                      {artist.name}
                    </Link>
                    <p className="mt-1 text-sm capitalize text-[var(--ink-muted)]">{artist.artistType}</p>
                  </div>
                  <span className="text-right text-sm font-semibold text-[var(--navy)]">
                    {formatScore(artist.effectivenessScore)}
                    <span className="block text-xs font-medium text-[var(--ink-soft)]">score</span>
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[var(--ink-muted)]">
                  <span>Events <strong className="block text-sm text-[var(--ink)]">{artist.eventCount}</strong></span>
                  <span>Uplift <strong className="block text-sm text-[var(--ink)]">{formatPercent(artist.averageSalesUpliftPercent)}</strong></span>
                  <span>Sentiment <strong className="block text-sm text-[var(--ink)]">{formatScore(artist.averageSentimentScore === null ? null : (artist.averageSentimentScore + 1) * 50)}</strong></span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {artist.phone ? (
                    <a href={`tel:${artist.phone}`} className="rounded-full bg-[var(--canvas-2)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)]">Call</a>
                  ) : null}
                  {artist.email ? (
                    <a href={`mailto:${artist.email}`} className="rounded-full bg-[var(--canvas-2)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)]">Email</a>
                  ) : null}
                  <Link href={`/artists/${artist.id}`} className="rounded-full bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white">
                    View
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="data-table-shell hidden md:block">
        <table className="data-table min-w-full">
          <thead>
            <tr className="bg-[var(--canvas-2)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
              <th className="px-4 py-3" aria-sort={ariaSort("name")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--ink)]"
                  onClick={() => toggleSort("name")}
                >
                  Artist {sortIcon("name")}
                </button>
              </th>
              <th className="px-4 py-3" aria-sort={ariaSort("artistType")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--ink)]"
                  onClick={() => toggleSort("artistType")}
                >
                  Type {sortIcon("artistType")}
                </button>
              </th>
              <th className="px-4 py-3" aria-sort={ariaSort("eventCount")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--ink)]"
                  onClick={() => toggleSort("eventCount")}
                >
                  Events {sortIcon("eventCount")}
                </button>
              </th>
              <th className="px-4 py-3" aria-sort={ariaSort("averageSalesUpliftPercent")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--ink)]"
                  onClick={() => toggleSort("averageSalesUpliftPercent")}
                >
                  Avg uplift {sortIcon("averageSalesUpliftPercent")}
                </button>
              </th>
              <th className="px-4 py-3" aria-sort={ariaSort("averageSentimentScore")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--ink)]"
                  onClick={() => toggleSort("averageSentimentScore")}
                >
                  Sentiment {sortIcon("averageSentimentScore")}
                </button>
              </th>
              <th className="px-4 py-3" aria-sort={ariaSort("effectivenessScore")}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--ink)]"
                  onClick={() => toggleSort("effectivenessScore")}
                >
                  Effectiveness {sortIcon("effectivenessScore")}
                </button>
              </th>
              <th className="px-4 py-3 text-right">{canEdit ? "Actions" : ""}</th>
            </tr>
          </thead>
          <tbody>
            {sortedArtists.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-subtle">
                  {artists.length === 0 ? `No artists yet.${canEdit ? " Add your first artist above." : ""}` : "No artists match your filters."}
                </td>
              </tr>
            ) : (
              sortedArtists.map((artist) => (
                <tr key={artist.id} className="border-t border-[var(--hair)]">
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/artists/${artist.id}`}
                      className="font-medium text-[var(--ink)] transition-colors hover:text-[var(--navy)]"
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
                  <td className="px-4 py-3 text-sm font-semibold text-[var(--navy)]">
                    {formatScore(artist.effectivenessScore)}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/artists/${artist.id}`}>{canEdit ? "Edit" : "View"}</Link>
                      </Button>
                      {canEdit ? (
                        <form action={archiveFormAction}>
                          <input type="hidden" name="artistId" value={artist.id} />
                          <SubmitButton label="Archive" pendingLabel="Archiving..." variant="destructive" size="sm" />
                        </form>
                      ) : null}
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
