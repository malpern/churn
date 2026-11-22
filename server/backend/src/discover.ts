import { mapMovieResource } from "./search.js";
import type { DiscoverRow, SearchResult } from "./types.js";
import type { ServarrImportList, ServarrRecommendedMovie } from "./upstream/servarr.js";

/** Cards kept per row; the page shows a few and expands on request. */
export const DISCOVER_ROW_LIMIT = 30;

/**
 * Radarr's Discover feed as rows for Find something new: what is trending,
 * what is popular, and one row per import list configured in Radarr (an admin
 * adds a list there, with automatic adding off, and it shows up here). Radarr
 * owns every source; churn only drops what the household already has or has
 * hidden, and orders each row by Radarr's popularity score.
 */
export function buildDiscoverRows(
  movies: ServarrRecommendedMovie[],
  lists: ServarrImportList[],
  limit = DISCOVER_ROW_LIMIT,
): DiscoverRow[] {
  const usable = movies.filter((movie) => !movie.isExisting && !movie.isExcluded && movie.tmdbId);
  const byPopularity = (a: ServarrRecommendedMovie, b: ServarrRecommendedMovie) =>
    (b.popularity ?? 0) - (a.popularity ?? 0);

  const trending = usable.filter((movie) => movie.isTrending).sort(byPopularity);
  const trendingIds = new Set(trending.map((movie) => movie.tmdbId));
  // Trending and popular overlap heavily; a movie shows in the first row only.
  const popular = usable
    .filter((movie) => movie.isPopular && !trendingIds.has(movie.tmdbId))
    .sort(byPopularity);

  const rows: DiscoverRow[] = [
    {
      id: "trending",
      title: "Trending now",
      subtitle: "What people are watching this week.",
      results: toResults(trending, limit),
    },
    {
      id: "popular",
      title: "Popular",
      subtitle: "Widely watched right now.",
      results: toResults(popular, limit),
    },
  ];

  for (const list of lists) {
    if (!list.enabled || !Number.isSafeInteger(list.id)) continue;
    const onList = usable.filter((movie) => movie.lists?.includes(list.id)).sort(byPopularity);
    rows.push({
      id: `list:${list.id}`,
      title: list.name?.trim() || `Radarr list ${list.id}`,
      subtitle: "From a list in Radarr.",
      results: toResults(onList, limit),
    });
  }

  return rows.filter((row) => row.results.length > 0);
}

function toResults(movies: ServarrRecommendedMovie[], limit: number): SearchResult[] {
  const seen = new Set<number>();
  const results: SearchResult[] = [];
  for (const movie of movies) {
    if (results.length >= limit) break;
    if (!movie.tmdbId || seen.has(movie.tmdbId)) continue;
    const result = mapMovieResource(movie, false);
    if (!result) continue;
    seen.add(movie.tmdbId);
    results.push(result);
  }
  return results;
}
