import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  addFavoriteMovie,
  fetchRecommendationPreferences,
  hideRecommendation,
  removeFavoriteMovie,
  unhideRecommendation,
} from "@/api/client";
import type {
  FavoriteMovieSummary,
  RecommendationPreferences,
  RecommendationsResponse,
  SearchResult,
} from "@/api/types";

const PREFERENCES_KEY = ["recommendation-preferences"] as const;
const RECOMMENDATIONS_KEY = ["recommendations", "movies"] as const;

/**
 * Favourites and hidden movies for the recommendation row. Both act at once in
 * the interface and settle against the server; a hide can be undone from its
 * toast. Recommendations refresh after either, since both change the ranking.
 */
export function useRecommendationPreferences() {
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: fetchRecommendationPreferences,
    staleTime: 60_000,
  });
  const favoriteIds = useMemo(
    () => new Set(preferencesQuery.data?.favorites.map((movie) => movie.tmdbId) ?? []),
    [preferencesQuery.data],
  );

  const refreshRecommendations = () =>
    void queryClient.invalidateQueries({ queryKey: RECOMMENDATIONS_KEY });

  const setFavorites = (update: (favorites: FavoriteMovieSummary[]) => FavoriteMovieSummary[]) =>
    queryClient.setQueryData<RecommendationPreferences>(PREFERENCES_KEY, (current) =>
      current ? { ...current, favorites: update(current.favorites) } : current,
    );

  const favoriteMutation = useMutation({
    mutationFn: ({ movie, add }: { movie: FavoriteMovieSummary; add: boolean }) =>
      add ? addFavoriteMovie(movie) : removeFavoriteMovie(movie.tmdbId),
    onMutate: ({ movie, add }) =>
      setFavorites((favorites) =>
        add
          ? [movie, ...favorites.filter((entry) => entry.tmdbId !== movie.tmdbId)]
          : favorites.filter((entry) => entry.tmdbId !== movie.tmdbId),
      ),
    onSuccess: (data) => {
      setFavorites(() => data.favorites);
      refreshRecommendations();
    },
    onError: (error) => {
      toast.error("Could not update favourites", { description: error.message });
      void queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY });
    },
  });

  const unhideMutation = useMutation({
    mutationFn: (id: number) => unhideRecommendation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY });
      refreshRecommendations();
    },
    onError: (error) => toast.error("Could not bring it back", { description: error.message }),
  });

  const hideMutation = useMutation({
    mutationFn: (result: SearchResult) =>
      hideRecommendation({ tmdbId: result.tmdbId!, title: result.title, year: result.year }),
    onMutate: (result) => {
      const previous = queryClient.getQueryData<RecommendationsResponse>(RECOMMENDATIONS_KEY);
      queryClient.setQueryData<RecommendationsResponse>(RECOMMENDATIONS_KEY, (current) =>
        current
          ? { ...current, results: current.results.filter((entry) => entry.key !== result.key) }
          : current,
      );
      return { previous };
    },
    onSuccess: (hidden, result) => {
      void queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY });
      toast(`Hidden ${result.title}`, {
        description: "It won't be recommended again. Bring it back in Recommendations.",
        action: { label: "Undo", onClick: () => unhideMutation.mutate(hidden.id) },
        duration: 8_000,
      });
    },
    onError: (error, _result, context) => {
      if (context?.previous) {
        queryClient.setQueryData(RECOMMENDATIONS_KEY, context.previous);
      }
      toast.error("Could not hide that movie", { description: error.message });
    },
  });

  return {
    preferences: preferencesQuery.data,
    loading: preferencesQuery.isLoading,
    error: preferencesQuery.error,
    favoriteIds,
    isFavorite: (result: SearchResult) =>
      result.kind === "movie" && result.tmdbId !== undefined && favoriteIds.has(result.tmdbId),
    toggleFavorite: (result: SearchResult) => {
      if (result.kind !== "movie" || result.tmdbId === undefined) return;
      favoriteMutation.mutate({
        add: !favoriteIds.has(result.tmdbId),
        movie: {
          tmdbId: result.tmdbId,
          title: result.title,
          year: result.year,
          genres: result.genres ?? [],
          imageUrl: result.imageUrl,
        },
      });
    },
    removeFavorite: (movie: FavoriteMovieSummary) => favoriteMutation.mutate({ movie, add: false }),
    hide: (result: SearchResult) => {
      if (result.kind === "movie" && result.tmdbId !== undefined) hideMutation.mutate(result);
    },
    unhide: (id: number) => unhideMutation.mutate(id),
    unhiding: unhideMutation.isPending ? unhideMutation.variables : undefined,
  };
}
