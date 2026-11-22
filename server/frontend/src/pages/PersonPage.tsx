import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";

import { ApiClientError, fetchPerson } from "@/api/client";
import type { LibraryItem, PersonResponse } from "@/api/types";
import { MotionImage } from "@/components/MotionImage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { initials, openAtTop } from "@/features/person/CastStrip";
import { TmdbSuggestion } from "@/features/person/TmdbSuggestion";
import { useTmdbSettings } from "@/features/person/use-tmdb-settings";
import { DiscoverRowSection } from "@/features/search/DiscoverRows";
import { useRecommendationPreferences } from "@/features/search/use-recommendation-preferences";
import { useTitleRequests } from "@/features/search/use-title-requests";
import { Synopsis } from "@/features/title/Synopsis";

/**
 * Someone from a title's cast or crew: who they are (from Jellyfin), what of
 * theirs the household has, and, with the optional TMDB key, the rest of
 * their films to request.
 */
export function PersonPage({ id }: { id: string }) {
  const personQuery = useQuery({
    queryKey: ["person", id],
    queryFn: () => fetchPerson(id),
    staleTime: 10 * 60_000,
    retry: (count, error) => !(error instanceof ApiClientError && error.status === 404) && count < 2,
  });

  if (personQuery.isLoading) {
    return <PersonSkeleton />;
  }
  if (!personQuery.data) {
    return (
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>This person isn’t in Jellyfin</AlertTitle>
        <AlertDescription>
          {personQuery.error instanceof ApiClientError && personQuery.error.status !== 404
            ? personQuery.error.message
            : "Jellyfin has no page for them. Go back and pick someone else."}
        </AlertDescription>
      </Alert>
    );
  }
  const data = personQuery.data;
  return (
    <div className="flex flex-col gap-10">
      <PersonHeader person={data.person} />
      <LibrarySection items={data.library} name={data.person.name} />
      <MoreFilms data={data} />
    </div>
  );
}

function PersonHeader({ person }: { person: PersonResponse["person"] }) {
  const facts = [
    person.born ? `Born ${formatDate(person.born)}` : null,
    person.birthplace ?? null,
  ].filter(Boolean);
  return (
    <header className="flex flex-col items-start gap-6 sm:flex-row sm:items-end">
      <div className="size-32 shrink-0 overflow-hidden rounded-full bg-muted sm:size-40">
        {person.imageUrl ? (
          <MotionImage
            src={`${person.imageUrl}&maxWidth=320`}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-4xl font-medium text-muted-foreground">
            {initials(person.name)}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {person.name}
        </h1>
        {facts.length > 0 ? (
          <p className="text-sm text-muted-foreground">{facts.join(" · ")}</p>
        ) : null}
        {person.overview ? (
          <Synopsis text={person.overview} lines={3} className="max-w-prose text-muted-foreground" />
        ) : null}
      </div>
    </header>
  );
}

function LibrarySection({ items, name }: { items: LibraryItem[]; name: string }) {
  return (
    <section aria-labelledby="person-library" className="flex flex-col gap-4">
      <h2 id="person-library" className="font-heading text-xl font-semibold tracking-tight">
        In your library
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing with {name} in the library right now.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((item) => (
            <li key={item.id}>
              <LibraryTitleCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LibraryTitleCard({ item }: { item: LibraryItem }) {
  const [failed, setFailed] = useState(false);
  const href =
    item.type === "Series"
      ? `#/library/show/jellyfin/${encodeURIComponent(item.id)}`
      : `#/library/movie/jellyfin/${encodeURIComponent(item.id)}`;
  return (
    <a href={href} onClick={openAtTop} className="group flex flex-col gap-2 rounded-lg outline-none">
      <div className="motion-poster-card relative aspect-2/3 overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-background group-focus-visible:ring-2 group-focus-visible:ring-ring">
        {item.imageUrl && !failed ? (
          <MotionImage
            src={item.imageUrl}
            alt={`${item.name} poster`}
            loading="lazy"
            className="size-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="flex size-full items-center justify-center px-3 text-center text-sm font-medium text-balance">
            {item.name}
          </span>
        )}
      </div>
      <span className="flex flex-col">
        <span className="line-clamp-2 text-sm font-medium group-hover:underline">{item.name}</span>
        <span className="text-xs text-muted-foreground">
          {[item.year, item.type === "Series" ? "Show" : null].filter(Boolean).join(" · ")}
        </span>
      </span>
    </a>
  );
}

function MoreFilms({ data }: { data: PersonResponse }) {
  const { isAdmin } = useTmdbSettings();
  const requests = useTitleRequests();
  const taste = useRecommendationPreferences();
  const more = data.more;

  if (more.state === "no_key") {
    return <TmdbSuggestion placement="person" />;
  }
  if (more.state === "invalid_key") {
    return isAdmin ? (
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>TMDB stopped accepting the key</AlertTitle>
        <AlertDescription>
          <span>
            Their other films can’t be shown until the key is replaced.{" "}
            <a href="#/settings" className="underline underline-offset-4">
              Update it in Settings
            </a>
          </span>
        </AlertDescription>
      </Alert>
    ) : null;
  }
  if (more.state !== "ok" || more.results.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      <DiscoverRowSection
        row={{
          id: `person-${data.person.id}`,
          title: `More from ${data.person.name}`,
          subtitle: "Films they acted in, directed or wrote, most popular first.",
          results: more.results,
        }}
        onRequest={requests.onRequest}
        requestingKey={requests.requestingKey}
        requestLinks={requests.requestLinks}
        requestErrors={requests.requestErrors}
        requestDisabled={requests.requestDisabled}
        isFavorite={taste.isFavorite}
        onToggleFavorite={taste.toggleFavorite}
      />
      <p className="text-xs text-muted-foreground">From TMDB.</p>
    </div>
  );
}

function PersonSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-10">
      <div className="flex items-end gap-6">
        <Skeleton className="size-32 rounded-full sm:size-40" />
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="aspect-2/3 w-full" />
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" }).format(date);
}
