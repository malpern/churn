import { useQuery } from "@tanstack/react-query";

import { fetchSimilarMovies } from "@/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { DiscoverRowSection } from "@/features/search/DiscoverRows";
import { useRecommendationPreferences } from "@/features/search/use-recommendation-preferences";
import { useTitleRequests } from "@/features/search/use-title-requests";

/**
 * "More like this" under a movie: the movies Radarr's metadata recommends for
 * it. New ones can be requested in place; ones already in the library link to
 * their page, so the row is also a way around the library. Hidden when there
 * is nothing to show.
 */
export function MoreLikeThis({ tmdbId }: { tmdbId: number }) {
  const requests = useTitleRequests();
  const taste = useRecommendationPreferences();
  const similarQuery = useQuery({
    queryKey: ["similar", tmdbId],
    queryFn: () => fetchSimilarMovies(tmdbId),
    staleTime: 10 * 60_000,
  });

  if (similarQuery.isLoading) {
    return (
      <section aria-busy="true" className="flex flex-col gap-4">
        <h2 className="font-heading text-xl font-semibold tracking-tight">More like this</h2>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="aspect-2/3 w-full" />
          ))}
        </div>
      </section>
    );
  }
  const data = similarQuery.data;
  if (!data || data.state !== "ok" || data.results.length === 0) {
    return null;
  }
  return (
    <DiscoverRowSection
      row={{ id: `similar-${tmdbId}`, title: "More like this", results: data.results }}
      onRequest={requests.onRequest}
      requestingKey={requests.requestingKey}
      requestLinks={requests.requestLinks}
      requestErrors={requests.requestErrors}
      requestDisabled={requests.requestDisabled}
      isFavorite={taste.isFavorite}
      onToggleFavorite={taste.toggleFavorite}
      onDismiss={taste.hide}
    />
  );
}
