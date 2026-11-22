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
}

/**
 * The signed-in person's movies from Jellyfin, as taste signals. Jellyfin is
 * the only record of what anyone watched, so played movies come from its
 * per-user `UserData`, never from a churn-side history.
 */
export function tasteSignals(items: JellyfinItem[]): TasteSignal[] {
  return items
    .filter((item) => item.Type === "Movie")
    .map((item) => ({
      genres: item.Genres ?? [],
      playCount: item.UserData?.Played ? Math.max(1, item.UserData.PlayCount ?? 1) : 0,
    }));
}

/**
 * How much each genre is worth for this person. A movie they played counts
 * three times as much as one that is only in the library, and replays add a
 * little more, capped so one favourite cannot drown out the rest.
 */
export function genreWeights(signals: TasteSignal[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const signal of signals) {
    const weight = signal.playCount > 0 ? 3 + Math.min(signal.playCount - 1, 2) : 1;
    for (const genre of signal.genres) {
      const key = genre.toLowerCase();
      weights.set(key, (weights.get(key) ?? 0) + weight);
    }
  }
  return weights;
}

/**
 * Turn Radarr's recommendations into search-result cards, best match first.
 *
 * Radarr does not say which library movie a suggestion came from and returns
 * them unordered, so the order is churn's: the share of a suggestion's genres
 * this person has played or kept, then its rating. Movies Radarr already has or
 * excludes are dropped, so a dismissal lives in Radarr, not in churn.
 */
export function rankRecommendations(
  candidates: ServarrRecommendedMovie[],
  signals: TasteSignal[],
  limit = RECOMMENDATION_LIMIT,
): SearchResult[] {
  const weights = genreWeights(signals);
  const seen = new Set<number>();
  const scored: Array<{ result: SearchResult; score: number; rating: number }> = [];
  for (const movie of candidates) {
    if (movie.isExisting || movie.isExcluded || !movie.tmdbId || seen.has(movie.tmdbId)) {
      continue;
    }
    const result = mapMovieResource(movie, false);
    if (!result) {
      continue;
    }
    seen.add(movie.tmdbId);
    const genres = movie.genres ?? [];
    const score =
      genres.length === 0
        ? 0
        : genres.reduce((sum, genre) => sum + (weights.get(genre.toLowerCase()) ?? 0), 0) /
          genres.length;
    scored.push({ result, score, rating: result.rating ?? 0 });
  }
  scored.sort((a, b) => b.score - a.score || b.rating - a.rating);
  return scored.slice(0, limit).map((entry) => entry.result);
}
