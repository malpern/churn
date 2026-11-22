/**
 * The few TMDB calls churn makes when an administrator has added a key. TMDB
 * hands out two kinds of credential and both work: a v3 "API key" (sent as the
 * `api_key` query parameter) and a v4 "API read access token" (a JWT, sent as a
 * bearer token). Only ids of movies and people are ever sent; never anything
 * about who watched what.
 */

const TMDB_API_URL = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_URL = "https://image.tmdb.org/t/p";

export class TmdbError extends Error {
  constructor(
    readonly kind: "invalid_key" | "unreachable" | "http",
    message: string,
  ) {
    super(message);
  }
}

export interface TmdbMovieCredit {
  id: number;
  title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  adult?: boolean;
  /** Cast credits. */
  character?: string;
  /** Crew credits. */
  job?: string;
}

interface TmdbMovieCredits {
  cast?: TmdbMovieCredit[];
  crew?: TmdbMovieCredit[];
}

/** Crew jobs worth listing on a person's page; everyone else is cast. */
const CREW_JOBS = new Set(["Director", "Writer", "Screenplay", "Novel", "Story", "Creator"]);

function isBearerToken(key: string): boolean {
  return key.startsWith("eyJ") && key.split(".").length === 3;
}

async function tmdbGet<T>(key: string, pathname: string, timeoutMs: number): Promise<T> {
  const url = new URL(`${TMDB_API_URL}${pathname}`);
  const headers: Record<string, string> = { accept: "application/json" };
  if (isBearerToken(key)) {
    headers.authorization = `Bearer ${key}`;
  } else {
    url.searchParams.set("api_key", key);
  }
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new TmdbError("unreachable", "TMDB could not be reached");
  }
  if (response.status === 401) {
    throw new TmdbError("invalid_key", "TMDB did not accept that key");
  }
  if (!response.ok) {
    throw new TmdbError("http", `TMDB returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Throws `TmdbError("invalid_key")` when TMDB rejects the key. */
export async function verifyTmdbKey(key: string, timeoutMs: number): Promise<void> {
  await tmdbGet(key, "/configuration", timeoutMs);
}

/**
 * Every film a person acted in, directed or wrote, most-voted first, one entry
 * per film. Adult titles are left out.
 */
export async function tmdbPersonMovies(
  key: string,
  personTmdbId: number,
  timeoutMs: number,
): Promise<TmdbMovieCredit[]> {
  const credits = await tmdbGet<TmdbMovieCredits>(
    key,
    `/person/${personTmdbId}/movie_credits`,
    timeoutMs,
  );
  const seen = new Set<number>();
  const merged: TmdbMovieCredit[] = [];
  for (const credit of [
    ...(credits.crew ?? []).filter((entry) => entry.job && CREW_JOBS.has(entry.job)),
    ...(credits.cast ?? []),
  ]) {
    if (!Number.isSafeInteger(credit.id) || credit.adult || !credit.title || seen.has(credit.id)) {
      continue;
    }
    seen.add(credit.id);
    merged.push(credit);
  }
  return merged.sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0));
}

/** A movie or show from TMDB's discover, trending or search results. */
export interface TmdbTitle {
  id: number;
  media: "movie" | "tv";
  title: string;
  /** YYYY-MM-DD; release date for movies, first air date for shows. */
  date?: string;
  overview?: string;
  posterPath?: string;
  voteAverage: number;
  voteCount: number;
  popularity: number;
}

interface TmdbListItem {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  adult?: boolean;
}

/** TMDB's genre id for documentaries, the same for movies and shows. */
export const TMDB_DOCUMENTARY_GENRE = 99;

function toTitle(item: TmdbListItem, media: "movie" | "tv"): TmdbTitle | null {
  const title = (media === "movie" ? item.title : item.name)?.trim();
  if (!Number.isSafeInteger(item.id) || !title || item.adult) return null;
  const date = media === "movie" ? item.release_date : item.first_air_date;
  return {
    id: item.id,
    media,
    title,
    ...(date ? { date } : {}),
    ...(item.overview ? { overview: item.overview } : {}),
    ...(item.poster_path ? { posterPath: item.poster_path } : {}),
    voteAverage: item.vote_average ?? 0,
    voteCount: item.vote_count ?? 0,
    popularity: item.popularity ?? 0,
  };
}

/** Keyword ids and names matching a search, TMDB's best matches first. */
export async function tmdbSearchKeywords(
  key: string,
  query: string,
  timeoutMs: number,
): Promise<Array<{ id: number; name: string }>> {
  const response = await tmdbGet<{ results?: Array<{ id: number; name: string }> }>(
    key,
    `/search/keyword?${new URLSearchParams({ query, page: "1" }).toString()}`,
    timeoutMs,
  );
  return (response.results ?? []).filter((entry) => Number.isSafeInteger(entry.id) && entry.name);
}

export interface TmdbDiscoverOptions {
  media: "movie" | "tv";
  /** Any of these keywords (TMDB's OR). */
  keywordIds?: number[];
  sortBy: "popularity.desc" | "vote_average.desc" | "vote_count.desc";
  minVotes?: number;
  minAverage?: number;
  /** Only titles released (or first aired) on or after this date. */
  since?: string;
  /** Leave out titles tagged with any of these keywords. */
  withoutKeywordIds?: number[];
}

/**
 * Genres that are never "learning" even when tagged documentary: reality,
 * talk, soap and news shows; horror films (where ghost "documentaries" live).
 */
const EXCLUDED_GENRES = { movie: "27", tv: "10763,10764,10766,10767" } as const;

/** One page of documentaries from TMDB's discover. */
export async function tmdbDiscoverDocumentaries(
  key: string,
  options: TmdbDiscoverOptions,
  timeoutMs: number,
): Promise<TmdbTitle[]> {
  const query = new URLSearchParams({
    with_genres: String(TMDB_DOCUMENTARY_GENRE),
    sort_by: options.sortBy,
    include_adult: "false",
    without_genres: EXCLUDED_GENRES[options.media],
    page: "1",
  });
  if (options.withoutKeywordIds?.length) query.set("without_keywords", options.withoutKeywordIds.join(","));
  if (options.keywordIds?.length) query.set("with_keywords", options.keywordIds.join("|"));
  if (options.minVotes !== undefined) query.set("vote_count.gte", String(options.minVotes));
  if (options.minAverage !== undefined) query.set("vote_average.gte", String(options.minAverage));
  if (options.since) {
    query.set(options.media === "movie" ? "primary_release_date.gte" : "first_air_date.gte", options.since);
  }
  const response = await tmdbGet<{ results?: TmdbListItem[] }>(
    key,
    `/discover/${options.media}?${query.toString()}`,
    timeoutMs,
  );
  return (response.results ?? [])
    .map((item) => toTitle(item, options.media))
    .filter((title): title is TmdbTitle => title !== null);
}

/** The TVDB id Sonarr needs to add a show, or undefined when TMDB has none. */
export async function tmdbTvdbId(key: string, tvId: number, timeoutMs: number): Promise<number | undefined> {
  const response = await tmdbGet<{ tvdb_id?: number | null }>(key, `/tv/${tvId}/external_ids`, timeoutMs);
  return typeof response.tvdb_id === "number" && response.tvdb_id > 0 ? response.tvdb_id : undefined;
}
