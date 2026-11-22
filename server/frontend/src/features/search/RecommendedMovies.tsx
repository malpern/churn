import { SparklesIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import type { RecommendationsResponse, SearchResult } from "@/api/types";

import { SearchResultCard } from "./SearchResultCard";

interface RecommendedMoviesProps {
  data?: RecommendationsResponse;
  loading: boolean;
  onRequest: (result: SearchResult) => void;
  requestingKey: string | null;
  requestLinks: Record<string, string>;
  requestErrors: Record<string, string>;
  requestDisabled: boolean;
  isFavorite: (result: SearchResult) => boolean;
  onToggleFavorite: (result: SearchResult) => void;
  onDismiss: (result: SearchResult) => void;
}

/**
 * What to watch when you don't know what to search for: Radarr's suggestions
 * for movies like the ones in the library, ordered by what this person has
 * actually watched in Jellyfin. Hidden when there is nothing to show, so the
 * page falls back to its plain search prompt.
 */
export function RecommendedMovies({
  data,
  loading,
  onRequest,
  requestingKey,
  requestLinks,
  requestErrors,
  requestDisabled,
  isFavorite,
  onToggleFavorite,
  onDismiss,
}: RecommendedMoviesProps) {
  if (loading && !data) {
    return (
      <section aria-busy="true" className="flex flex-col gap-4">
        <RecommendedHeading />
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="aspect-2/3 w-full" />
          ))}
        </div>
      </section>
    );
  }
  if (!data || data.state !== "ok" || data.results.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="recommended-heading" className="flex flex-col gap-4">
      <RecommendedHeading />
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {data.results.map((result) => (
          <SearchResultCard
            key={result.key}
            result={result}
            onRequest={onRequest}
            requestHref={requestLinks[result.key]}
            requestError={requestErrors[result.key]}
            requesting={requestingKey === result.key}
            requestDisabled={requestDisabled}
            favorite={isFavorite(result)}
            onToggleFavorite={onToggleFavorite}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  );
}

function RecommendedHeading() {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
      <h2 id="recommended-heading" className="flex items-center gap-2 font-heading text-xl font-semibold tracking-tight">
        <SparklesIcon aria-hidden="true" className="size-4 text-primary" />
        Recommended for you
      </h2>
        <a
          href="#/recommendations"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Manage
        </a>
      </div>
      <p className="text-sm text-muted-foreground">
        Movies like the ones you've watched, kept or marked with a heart. Search above for anything else.
      </p>
    </div>
  );
}
