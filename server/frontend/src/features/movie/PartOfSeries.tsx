import { useQuery } from "@tanstack/react-query";

import { fetchMovieCollection } from "@/api/client";
import { DiscoverRowSection } from "@/features/search/DiscoverRows";
import { useRecommendationPreferences } from "@/features/search/use-recommendation-preferences";
import { useTitleRequests } from "@/features/search/use-title-requests";

/**
 * "Part of the … Collection": every film in the series this movie belongs to,
 * in release order, with this one marked. Parts already in the library link to
 * their page; the rest can be requested. Nothing renders for a standalone film.
 */
export function PartOfSeries({ tmdbId }: { tmdbId: number }) {
  const requests = useTitleRequests();
  const taste = useRecommendationPreferences();
  const collectionQuery = useQuery({
    queryKey: ["collection", tmdbId],
    queryFn: () => fetchMovieCollection(tmdbId),
    staleTime: 60 * 60_000,
  });
  const collection = collectionQuery.data?.collection;
  if (!collection || collection.results.length < 2) {
    return null;
  }
  return (
    <DiscoverRowSection
      row={{
        id: `collection-${collection.tmdbId}`,
        title: `Part of the ${collection.name}`,
        subtitle: collection.overview,
        results: collection.results,
      }}
      currentKey={`movie:${tmdbId}`}
      onRequest={requests.onRequest}
      requestingKey={requests.requestingKey}
      requestLinks={requests.requestLinks}
      requestErrors={requests.requestErrors}
      requestDisabled={requests.requestDisabled}
      isFavorite={taste.isFavorite}
      onToggleFavorite={taste.toggleFavorite}
    />
  );
}
