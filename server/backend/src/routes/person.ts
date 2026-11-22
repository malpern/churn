import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { requireAdmin, requireAuth, type AuthContext } from "../auth.js";
import { ApiError, isUnauthorized } from "../errors.js";
import { isMovieAvailable, mapMovieResource } from "../search.js";
import type { TmdbKeyStore } from "../tmdb-key.js";
import type {
  CreditsResponse,
  LibraryItem,
  PersonCredit,
  PersonResponse,
  SearchResult,
  TmdbSettingsResponse,
} from "../types.js";
import {
  createJellyfinClient,
  mapJellyfinItem,
  providerString,
  type JellyfinPerson,
} from "../upstream/jellyfin.js";
import { createArrClient, type ServarrMovieResource } from "../upstream/servarr.js";
import { errorMessage } from "../upstream/states.js";
import {
  TMDB_IMAGE_URL,
  TmdbError,
  tmdbPersonMovies,
  verifyTmdbKey,
  type TmdbMovieCredit,
} from "../upstream/tmdb.js";

/** Enough faces for a strip; the full cast is on Jellyfin. */
const MAX_CAST = 20;
const CREW_TYPES: Record<string, string> = { Director: "Director", Writer: "Writer", Creator: "Creator" };
const MAX_MORE = 40;
/** A filmography changes rarely. */
const CREDITS_TTL_MS = 24 * 60 * 60 * 1000;
/** Once anyone has watched something, they have; "not yet" is re-checked. */
const NOT_WATCHED_TTL_MS = 10 * 60 * 1000;

const creditsCache = new Map<number, { expires: number; movies: TmdbMovieCredit[] }>();
let watched: { value: boolean; expires: number } | null = null;

/** Forget cached TMDB answers and the watched check. For tests. */
export function clearPersonCache(): void {
  creditsCache.clear();
  watched = null;
}

export function registerPersonRoutes(
  app: FastifyInstance,
  config: AppConfig,
  tmdbKey: TmdbKeyStore,
): void {
  app.get<{ Params: { itemId: string } }>("/api/cast/:itemId", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = requireAuth(request);
    if (!config.services.jellyfin.apiKey) {
      const response: CreditsResponse = { state: "unconfigured", cast: [], crew: [] };
      return response;
    }
    const client = userClient(config, auth);
    try {
      const item = await client.getItemPeople(request.params.itemId, auth.user.id);
      return creditsFor(item.People ?? []);
    } catch (error) {
      if (isUnauthorized(error)) {
        auth.destroySession();
        throw new ApiError(401, "session_expired", "Your Jellyfin session expired. Sign in again.");
      }
      const response: CreditsResponse = {
        state: "unreachable",
        detail: errorMessage(error),
        cast: [],
        crew: [],
      };
      return response;
    }
  });

  app.get<{ Params: { personId: string } }>("/api/person/:personId", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = requireAuth(request);
    if (!config.services.jellyfin.apiKey) {
      throw new ApiError(503, "jellyfin_unconfigured", "Jellyfin is not configured");
    }
    const client = userClient(config, auth);
    const personId = request.params.personId;
    let response: PersonResponse;
    try {
      const [person, credited, library] = await Promise.all([
        client.getItem(personId, auth.user.id),
        client.listItemsByPerson(personId, auth.user.id),
        client.listLibrary(auth.user.id),
      ]);
      if (person.Type !== "Person" || !person.Name) {
        throw new ApiError(404, "person_not_found", "Person not found");
      }
      const inLibrary = new Set(library.map((item) => item.Id));
      const items = credited
        .filter((item) => inLibrary.has(item.Id))
        .map(mapJellyfinItem)
        .filter((item): item is LibraryItem => item !== null);
      const tag = person.ImageTags?.Primary;
      const tmdbId = Number.parseInt(providerString(person, "tmdb") ?? "", 10);
      response = {
        person: {
          id: personId,
          name: person.Name,
          ...(person.Overview ? { overview: person.Overview } : {}),
          ...(person.PremiereDate ? { born: person.PremiereDate.slice(0, 10) } : {}),
          ...(person.ProductionLocations?.[0] ? { birthplace: person.ProductionLocations[0] } : {}),
          ...(tag ? { imageUrl: imageUrl(personId, tag) } : {}),
          ...(Number.isSafeInteger(tmdbId) && tmdbId > 0 ? { tmdbId } : {}),
        },
        library: items,
        more: { state: "no_key", results: [] },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isUnauthorized(error)) {
        auth.destroySession();
        throw new ApiError(401, "session_expired", "Your Jellyfin session expired. Sign in again.");
      }
      throw new ApiError(404, "person_not_found", "Person not found");
    }
    response.more = await moreFilms(config, tmdbKey.get()?.apiKey, response);
    return response;
  });

  app.get("/api/settings/tmdb", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = requireAdmin(request);
    return settingsResponse(config, tmdbKey, auth);
  });

  app.put<{ Body: { apiKey?: unknown } }>("/api/settings/tmdb", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = requireAdmin(request);
    const apiKey = typeof request.body?.apiKey === "string" ? request.body.apiKey.trim() : "";
    if (!apiKey || apiKey.length > 1024 || /\s/.test(apiKey)) {
      throw new ApiError(400, "invalid_key", "Paste the API key or read access token from TMDB");
    }
    try {
      await verifyTmdbKey(apiKey, config.requestTimeoutMs * 4);
    } catch (error) {
      if (error instanceof TmdbError && error.kind === "invalid_key") {
        throw new ApiError(400, "invalid_key", "TMDB did not accept that key");
      }
      throw new ApiError(502, "tmdb_unreachable", "Could not reach TMDB to check the key. Try again.");
    }
    await tmdbKey.set(apiKey, auth.user.name);
    creditsCache.clear();
    return settingsResponse(config, tmdbKey, auth);
  });

  app.delete("/api/settings/tmdb", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = requireAdmin(request);
    await tmdbKey.clear();
    creditsCache.clear();
    return settingsResponse(config, tmdbKey, auth);
  });
}

function userClient(config: AppConfig, auth: AuthContext) {
  return createJellyfinClient(config.services.jellyfin, config.requestTimeoutMs, auth.accessToken, {
    deviceId: auth.deviceId,
  });
}

function imageUrl(itemId: string, tag: string): string {
  return `/api/library/images/${encodeURIComponent(itemId)}?tag=${encodeURIComponent(tag)}`;
}

/** Actors in billing order, then directors and writers, one entry per person. */
export function creditsFor(people: JellyfinPerson[]): CreditsResponse {
  const toCredit = (person: JellyfinPerson, role: string | undefined): PersonCredit | null => {
    if (!person.Id || !person.Name?.trim()) return null;
    return {
      id: person.Id,
      name: person.Name.trim(),
      ...(role?.trim() ? { role: role.trim() } : {}),
      ...(person.PrimaryImageTag ? { imageUrl: imageUrl(person.Id, person.PrimaryImageTag) } : {}),
    };
  };
  const cast: PersonCredit[] = [];
  const castIds = new Set<string>();
  for (const person of people) {
    if (person.Type !== "Actor" || cast.length >= MAX_CAST) continue;
    const credit = toCredit(person, person.Role);
    if (credit && !castIds.has(credit.id)) {
      castIds.add(credit.id);
      cast.push(credit);
    }
  }
  const crewById = new Map<string, PersonCredit>();
  for (const person of people) {
    const job = person.Type ? CREW_TYPES[person.Type] : undefined;
    if (!job) continue;
    const existing = person.Id ? crewById.get(person.Id) : undefined;
    if (existing) {
      if (!existing.role?.split(", ").includes(job)) existing.role = `${existing.role}, ${job}`;
      continue;
    }
    const credit = toCredit(person, job);
    if (credit) crewById.set(credit.id, credit);
  }
  const crew = [...crewById.values()].sort(
    (a, b) => Number(!a.role?.startsWith("Director")) - Number(!b.role?.startsWith("Director")),
  );
  return { state: "ok", cast, crew };
}

/**
 * Films of theirs the household does not have yet. Films already in Jellyfin
 * are listed above, so they are left out; films Radarr has but Jellyfin does
 * not (still downloading) show as requested.
 */
async function moreFilms(
  config: AppConfig,
  apiKey: string | undefined,
  person: PersonResponse,
): Promise<PersonResponse["more"]> {
  if (!apiKey) return { state: "no_key", results: [] };
  const tmdbId = person.person.tmdbId;
  if (tmdbId === undefined) return { state: "no_tmdb_id", results: [] };
  let movies: TmdbMovieCredit[];
  const cached = creditsCache.get(tmdbId);
  if (cached && cached.expires > Date.now()) {
    movies = cached.movies;
  } else {
    try {
      movies = await tmdbPersonMovies(apiKey, tmdbId, config.requestTimeoutMs * 4);
      creditsCache.set(tmdbId, { expires: Date.now() + CREDITS_TTL_MS, movies });
    } catch (error) {
      return {
        state: error instanceof TmdbError && error.kind === "invalid_key" ? "invalid_key" : "unavailable",
        results: [],
      };
    }
  }

  const inJellyfin = new Set(person.library.map((item) => item.tmdbId).filter(Boolean));
  let radarr: Map<number, ServarrMovieResource> | null = null;
  if (config.services.radarr.apiKey) {
    try {
      const library = await createArrClient(
        "radarr",
        config.services.radarr,
        config.requestTimeoutMs,
      ).listMovies();
      radarr = new Map(
        library.filter((movie) => movie.tmdbId).map((movie) => [movie.tmdbId!, movie] as const),
      );
    } catch {
      radarr = null;
    }
  }

  const results: SearchResult[] = [];
  for (const movie of movies) {
    if (results.length >= MAX_MORE) break;
    if (inJellyfin.has(movie.id)) continue;
    const mine = radarr?.get(movie.id);
    const result = mapMovieResource(
      toMovieResource(movie),
      radarr ? mine !== undefined : null,
      mine ? isMovieAvailable(mine) : undefined,
    );
    if (result) results.push(mine?.id ? { ...result, radarrId: mine.id } : result);
  }
  return { state: "ok", results };
}

function toMovieResource(movie: TmdbMovieCredit): ServarrMovieResource {
  const year = Number.parseInt(movie.release_date?.slice(0, 4) ?? "", 10);
  return {
    title: movie.title,
    tmdbId: movie.id,
    ...(Number.isSafeInteger(year) ? { year } : {}),
    ...(movie.overview ? { overview: movie.overview } : {}),
    ...(movie.poster_path
      ? { images: [{ coverType: "poster", remoteUrl: `${TMDB_IMAGE_URL}/w500${movie.poster_path}` }] }
      : {}),
    ...(movie.vote_average && movie.vote_count
      ? { ratings: { tmdb: { value: movie.vote_average, votes: movie.vote_count } } }
      : {}),
  } as ServarrMovieResource;
}

async function settingsResponse(
  config: AppConfig,
  tmdbKey: TmdbKeyStore,
  auth: AuthContext,
): Promise<TmdbSettingsResponse> {
  const record = tmdbKey.get();
  if (record) {
    return {
      configured: true,
      ...(record.addedAt ? { addedAt: record.addedAt } : {}),
      ...(record.addedBy ? { addedBy: record.addedBy } : {}),
      suggest: false,
    };
  }
  return { configured: false, suggest: await someoneHasWatched(config, auth) };
}

/**
 * Whether anyone in the household has finished a movie or an episode. The
 * signed-in administrator is checked first; the rest through the server's
 * Jellyfin key. Errors read as "not yet", which only delays a suggestion.
 */
async function someoneHasWatched(config: AppConfig, auth: AuthContext): Promise<boolean> {
  if (watched && (watched.value || watched.expires > Date.now())) return watched.value;
  let value = false;
  try {
    value = await userClient(config, auth).hasPlayedAnything(auth.user.id);
    if (!value && config.services.jellyfin.apiKey) {
      const server = createJellyfinClient(config.services.jellyfin, config.requestTimeoutMs);
      const users = await server.listUsers();
      for (const user of users.slice(0, 20)) {
        if (user.Id && user.Id !== auth.user.id && (await server.hasPlayedAnything(user.Id))) {
          value = true;
          break;
        }
      }
    }
  } catch {
    value = false;
  }
  watched = { value, expires: Date.now() + NOT_WATCHED_TTL_MS };
  return value;
}
