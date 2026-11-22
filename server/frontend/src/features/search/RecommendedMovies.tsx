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
          />
        ))}
      </div>
    </section>
  );
}

function RecommendedHeading() {
  return (
    <div className="flex flex-col gap-1">
      <h2 id="recommended-heading" className="flex items-center gap-2 font-heading text-xl font-semibold tracking-tight">
        <SparklesIcon aria-hidden="true" className="size-4 text-primary" />
        Recommended for you
      </h2>
      <p className="text-sm text-muted-foreground">
        Movies like the ones you've watched and kept. Search above for anything else.
      </p>
    </div>
  );
}
