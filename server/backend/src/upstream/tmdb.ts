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
