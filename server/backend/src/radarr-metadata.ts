import type { ServarrMovieResource } from "./upstream/servarr.js";

/**
 * Radarr's public metadata service, the source Radarr itself uses for movie
 * details, recommendations and collections. It needs no key. churn asks it for
 * what Radarr's API does not expose for movies outside the library: a movie's
 * recommendations, and which collection (series) it belongs to and the parts.
 */
export const RADARR_METADATA_URL = "https://api.radarr.video/v1";

const TTL_MS = 24 * 60 * 60 * 1000;

interface MetadataMovie {
  TmdbId?: number;
  ImdbId?: string;
  Title?: string;
  Year?: number;
  Overview?: string;
  Runtime?: number;
  Genres?: string[];
  Studio?: string;
  Images?: Array<{ CoverType?: string; Url?: string }>;
  MovieRatings?: { Tmdb?: { Value?: number; Count?: number }; Imdb?: { Value?: number; Count?: number } };
  Recommendations?: Array<{ TmdbId?: unknown }>;
  Collection?: { TmdbId?: number; Name?: string } | null;
}

interface MetadataCollection {
  TmdbId?: number;
  Name?: string;
  Overview?: string | null;
  Parts?: MetadataMovie[] | null;
}

/** A movie's series, with its parts in release order. */
export interface MovieCollection {
  tmdbId: number;
  name: string;
  overview?: string;
  parts: ServarrMovieResource[];
}

const movieCache = new Map<number, { expires: number; movie: MetadataMovie | null }>();
const collectionCache = new Map<number, { expires: number; collection: MetadataCollection | null }>();

async function fetchJson<T>(path: string, timeoutMs: number): Promise<T | null> {
  try {
    const response = await fetch(`${RADARR_METADATA_URL}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

async function metadataMovie(
  tmdbId: number,
  timeoutMs: number,
  now: () => number,
): Promise<MetadataMovie | null> {
  const cached = movieCache.get(tmdbId);
  if (cached && cached.expires > now()) {
    return cached.movie;
  }
  const movie = await fetchJson<MetadataMovie>(`/movie/${tmdbId}`, timeoutMs);
  movieCache.set(tmdbId, { expires: now() + TTL_MS, movie });
  return movie;
}

/** TMDB ids Radarr's metadata recommends for `tmdbId`; empty on any failure. */
export async function metadataRecommendations(
  tmdbId: number,
  timeoutMs: number,
  now: () => number = Date.now,
): Promise<number[]> {
  const movie = await metadataMovie(tmdbId, timeoutMs, now);
  return (movie?.Recommendations ?? [])
    .map((entry) => entry.TmdbId)
    .filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
}

/** The collection `tmdbId` belongs to, or null when it has none or on any failure. */
export async function metadataCollection(
  tmdbId: number,
  timeoutMs: number,
  now: () => number = Date.now,
): Promise<MovieCollection | null> {
  const movie = await metadataMovie(tmdbId, timeoutMs, now);
  const id = movie?.Collection?.TmdbId;
  if (!id || !Number.isSafeInteger(id)) {
    return null;
  }
  let cached = collectionCache.get(id);
  if (!cached || cached.expires <= now()) {
    const collection = await fetchJson<MetadataCollection>(`/movie/collection/${id}`, timeoutMs);
    cached = { expires: now() + TTL_MS, collection };
    collectionCache.set(id, cached);
  }
  const collection = cached.collection;
  const parts = (collection?.Parts ?? [])
    .map(toMovieResource)
    .filter((part): part is ServarrMovieResource => part !== null)
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  if (!collection || parts.length < 2) {
    return null;
  }
  return {
    tmdbId: id,
    name: collection.Name?.trim() || movie?.Collection?.Name?.trim() || "Collection",
    overview: collection.Overview?.trim() || undefined,
    parts,
  };
}

/** Radarr's metadata shape to the movie resource the search mapping reads. */
function toMovieResource(movie: MetadataMovie): ServarrMovieResource | null {
  if (!movie.TmdbId || !movie.Title) return null;
  const poster = movie.Images?.find((image) => image.CoverType === "Poster")?.Url;
  const tmdb = movie.MovieRatings?.Tmdb;
  const imdb = movie.MovieRatings?.Imdb;
  return {
    tmdbId: movie.TmdbId,
    imdbId: movie.ImdbId,
    title: movie.Title,
    year: movie.Year,
    overview: movie.Overview,
    runtime: movie.Runtime,
    genres: movie.Genres,
    studio: movie.Studio,
    images: poster ? [{ coverType: "poster", remoteUrl: poster }] : [],
    ratings: {
      ...(tmdb?.Value ? { tmdb: { value: tmdb.Value, votes: tmdb.Count } } : {}),
      ...(imdb?.Value ? { imdb: { value: imdb.Value, votes: imdb.Count } } : {}),
    },
  };
}

/** For tests. */
export function clearMetadataCache(): void {
  movieCache.clear();
  collectionCache.clear();
}
