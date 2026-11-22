import { mapMovieResource } from "./search.js";
import type { SearchResult } from "./types.js";
import type { JellyfinItem } from "./upstream/jellyfin.js";
import type { ServarrRecommendedMovie } from "./upstream/servarr.js";

/** How many recommendations the page shows. */
export const RECOMMENDATION_LIMIT = 18;

/** A movie that counts as a signal for what this person likes. */
export interface TasteSignal {
  genres: string[];
  /** 0 when only in the library, otherwise how many times it was played. */
  playCount: number;
  /** Marked as a favourite in churn, which outweighs any play count. */
  favorite?: boolean;
}

/** A suggestion, and how many of this person's favourites suggested it. */
export interface Candidate {
  movie: ServarrRecommendedMovie;
  favoriteSeeds: number;
}

/**
 * The signed-in person's movies from Jellyfin, as taste signals. Jellyfin is
 * the only record of what anyone watched or marked as a favourite, so both come
 * from its per-user `UserData`, never from a churn-side history.
 */
export function tasteSignals(items: JellyfinItem[]): TasteSignal[] {
  return items
    .filter((item) => item.Type === "Movie")
    .map((item) => ({
      genres: item.Genres ?? [],
      playCount: item.UserData?.Played ? Math.max(1, item.UserData.PlayCount ?? 1) : 0,
      ...(item.UserData?.IsFavorite ? { favorite: true } : {}),
    }));
}

/**
 * How much each genre is worth for this person. A favourite counts most, a
 * played movie three times one that is only in the library, and replays add a
 * little more, capped so one movie cannot drown out the rest.
 */
export function genreWeights(signals: TasteSignal[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const signal of signals) {
    const weight = signal.favorite
      ? 6
      : signal.playCount > 0
        ? 3 + Math.min(signal.playCount - 1, 2)
        : 1;
    for (const genre of signal.genres) {
      const key = genre.toLowerCase();
      weights.set(key, (weights.get(key) ?? 0) + weight);
    }
  }
  return weights;
}

/** A suggestion a favourite led to is worth this much per favourite. */
const FAVORITE_SEED_BONUS = 4;

/**
 * Turn suggestions into search-result cards, best match first.
 *
 * Radarr does not say which library movie a suggestion came from and returns
 * them unordered, so the order is churn's: the share of a suggestion's genres
 * this person has played, kept or favourited, plus a bonus for each favourite
 * that suggested it, then rating. Movies Radarr has or excludes, and the
 * person's own favourites, are dropped.
 */
export function rankRecommendations(
  candidates: Candidate[],
  signals: TasteSignal[],
  options: { favoriteIds?: Set<number>; limit?: number } = {},
): SearchResult[] {
  const limit = options.limit ?? RECOMMENDATION_LIMIT;
  const favoriteIds = options.favoriteIds ?? new Set<number>();
  const weights = genreWeights(signals);
  const seen = new Set<number>();
  const scored: Array<{ result: SearchResult; score: number; rating: number }> = [];
  for (const { movie, favoriteSeeds } of candidates) {
    const id = movie.tmdbId;
    if (movie.isExisting || movie.isExcluded || !id || seen.has(id) || favoriteIds.has(id)) {
      continue;
    }
    const result = mapMovieResource(movie, false);
    if (!result) {
      continue;
    }
    seen.add(id);
    const genres = movie.genres ?? [];
    const genreScore =
      genres.length === 0
        ? 0
        : genres.reduce((sum, genre) => sum + (weights.get(genre.toLowerCase()) ?? 0), 0) /
          genres.length;
    scored.push({
      result,
      score: genreScore + favoriteSeeds * FAVORITE_SEED_BONUS,
      rating: result.rating ?? 0,
    });
  }
  scored.sort((a, b) => b.score - a.score || b.rating - a.rating);
  return scored.slice(0, limit).map((entry) => entry.result);
}
