import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { requireAuth } from "../auth.js";
import { ApiError } from "../errors.js";
import { isMovieAvailable, mapMovieResource } from "../search.js";
import { buildDiscoverRows } from "../discover.js";
import { metadataCollection, metadataRecommendations } from "../radarr-metadata.js";
import type { FavoriteStore } from "../recommendation-favorites.js";
import {
  rankRecommendations,
  tasteSignals,
  type Candidate,
  type TasteSignal,
} from "../recommendations.js";
import type {
  CollectionResponse,
  DiscoverResponse,
  SearchResult,
  FavoriteMovieSummary,
  RecommendationPreferences,
  RecommendationsResponse,
} from "../types.js";
import { createJellyfinClient } from "../upstream/jellyfin.js";
import {
  createArrClient,
  type ServarrImportList,
  type ServarrMovieResource,
  type ServarrRecommendedMovie,
} from "../upstream/servarr.js";
import { errorMessage, stateForError } from "../upstream/states.js";

/**
 * Radarr asks its metadata service for every library movie, so its answer is
 * reused for a while. Hiding a movie clears it, so the change shows at once.
 */
const RADARR_TTL_MS = 30 * 60 * 1000;
/** Lookups of single movies a favourite suggested change rarely. */
const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;
/** Favourites that seed suggestions, newest first, and suggestions taken from each. */
const SEEDING_FAVORITES = 10;
const SEEDS_PER_FAVORITE = 6;

let radarrCache: { url: string; expires: number; movies: ServarrRecommendedMovie[] } | null = null;
let discoverCache: {
  url: string;
  expires: number;
  movies: ServarrRecommendedMovie[];
  lists: ServarrImportList[];
} | null = null;
const lookupCache = new Map<number, { expires: number; movie: ServarrMovieResource | null }>();

/** Forget cached Radarr answers. For tests. */
export function clearRecommendationCache(): void {
  radarrCache = null;
  discoverCache = null;
  lookupCache.clear();
}

export function registerRecommendationRoutes(
  app: FastifyInstance,
  config: AppConfig,
  favorites: FavoriteStore,
): void {
  app.get("/api/recommendations/movies", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = requireAuth(request);
    const radarr = config.services.radarr;
    if (!radarr.apiKey) {
      const response: RecommendationsResponse = {
        state: "unconfigured",
        detail: "Radarr is not configured, so there are no movie recommendations.",
        results: [],
      };
      return response;
    }

    const loved = favorites.list(auth.user.id);
    const jellyfin = createJellyfinClient(
      config.services.jellyfin,
      config.requestTimeoutMs,
      auth.accessToken,
      { deviceId: auth.deviceId },
    );
    const [suggested, library] = await Promise.allSettled([
      loadRadarrRecommendations(config),
      jellyfin.listLibrary(auth.user.id),
    ]);
    if (suggested.status === "rejected") {
      const response: RecommendationsResponse = {
        state: stateForError(suggested.reason),
        detail: errorMessage(suggested.reason),
        results: [],
      };
      return response;
    }

    const candidates = await withFavoriteSeeds(config, suggested.value, loved);
    // Without Jellyfin the suggestions still show, ordered by favourites and rating.
    const signals: TasteSignal[] = [
      ...(library.status === "fulfilled" ? tasteSignals(library.value) : []),
      ...loved.map((movie) => ({ genres: movie.genres, playCount: 0, favorite: true })),
    ];
    const response: RecommendationsResponse = {
      state: "ok",
      results: rankRecommendations(candidates, signals, {
        favoriteIds: new Set(loved.map((movie) => movie.tmdbId)),
      }),
    };
    return response;
  });

  app.get("/api/discover/movies", async (request, reply) => {
    reply.header("cache-control", "no-store");
    requireAuth(request);
    if (!config.services.radarr.apiKey) {
      const response: DiscoverResponse = {
        state: "unconfigured",
        detail: "Radarr is not configured, so there is nothing to discover.",
        rows: [],
      };
      return response;
    }
    try {
      const { movies, lists } = await loadDiscover(config);
      const response: DiscoverResponse = { state: "ok", rows: buildDiscoverRows(movies, lists) };
      return response;
    } catch (error) {
      const response: DiscoverResponse = {
        state: stateForError(error),
        detail: errorMessage(error),
        rows: [],
      };
      return response;
    }
  });

  app.get<{ Params: { tmdbId: string } }>(
    "/api/recommendations/similar/:tmdbId",
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      requireAuth(request);
      const tmdbId = parseTmdbId(request.params.tmdbId);
      if (!config.services.radarr.apiKey) {
        const response: RecommendationsResponse = {
          state: "unconfigured",
          detail: "Radarr is not configured.",
          results: [],
        };
        return response;
      }
      const client = createArrClient("radarr", config.services.radarr, config.requestTimeoutMs);
      try {
        const [ids, library, excluded] = await Promise.all([
          metadataRecommendations(tmdbId, config.requestTimeoutMs),
          client.listMovies(),
          client
            .listExclusions()
            .then((entries) => new Set(entries.map((entry) => entry.tmdbId)))
            .catch(() => new Set<number>()),
        ]);
        const response: RecommendationsResponse = {
          state: "ok",
          results: await similarMovies(client, ids, library, excluded, tmdbId),
        };
        return response;
      } catch (error) {
        const response: RecommendationsResponse = {
          state: stateForError(error),
          detail: errorMessage(error),
          results: [],
        };
        return response;
      }
    },
  );

  app.get<{ Params: { tmdbId: string } }>(
    "/api/recommendations/collection/:tmdbId",
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      requireAuth(request);
      const tmdbId = parseTmdbId(request.params.tmdbId);
      const collection = await metadataCollection(tmdbId, config.requestTimeoutMs);
      if (!collection) {
        const response: CollectionResponse = { state: "ok" };
        return response;
      }
      // Which parts the household has comes from Radarr; without it the parts
      // still show, just without "in library" marks.
      let owned: Map<number, ServarrMovieResource> | null = null;
      let state: CollectionResponse["state"] = "ok";
      let detail: string | undefined;
      if (config.services.radarr.apiKey) {
        try {
          const library = await createArrClient(
            "radarr",
            config.services.radarr,
            config.requestTimeoutMs,
          ).listMovies();
          owned = new Map(
            library.filter((movie) => movie.tmdbId).map((movie) => [movie.tmdbId!, movie] as const),
          );
        } catch (error) {
          state = stateForError(error);
          detail = errorMessage(error);
        }
      }
      const results: SearchResult[] = [];
      for (const part of collection.parts) {
        const mine = owned?.get(part.tmdbId!);
        const result = mapMovieResource(
          part,
          owned ? mine !== undefined : null,
          mine ? isMovieAvailable(mine) : undefined,
        );
        if (!result) continue;
        results.push(mine?.id ? { ...result, radarrId: mine.id } : result);
      }
      const response: CollectionResponse = {
        state,
        ...(detail ? { detail } : {}),
        collection: {
          tmdbId: collection.tmdbId,
          name: collection.name,
          overview: collection.overview,
          results,
        },
      };
      return response;
    },
  );

  app.get("/api/recommendations/preferences", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = requireAuth(request);
    const preferences: RecommendationPreferences = {
      favorites: favorites.list(auth.user.id).map(summary),
      hidden: [],
      hiddenState: "ok",
    };
    const radarr = config.services.radarr;
    if (!radarr.apiKey) {
      preferences.hiddenState = "unconfigured";
      preferences.hiddenDetail = "Radarr is not configured.";
      return preferences;
    }
    try {
      const exclusions = await createArrClient("radarr", radarr, config.requestTimeoutMs).listExclusions();
      preferences.hidden = exclusions
        .filter((entry) => Number.isSafeInteger(entry.id) && entry.tmdbId > 0)
        .map((entry) => ({
          id: entry.id,
          tmdbId: entry.tmdbId,
          title: entry.movieTitle?.trim() || `TMDB ${entry.tmdbId}`,
          year: entry.movieYear || undefined,
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
    } catch (error) {
      preferences.hiddenState = stateForError(error);
      preferences.hiddenDetail = errorMessage(error);
    }
    return preferences;
  });

  app.put<{ Params: { tmdbId: string }; Body: unknown }>(
    "/api/recommendations/favorites/:tmdbId",
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const auth = requireAuth(request);
      const tmdbId = parseTmdbId(request.params.tmdbId);
      const body = parseFavoriteBody(request.body);
      const next = await favorites.add(auth.user.id, { tmdbId, ...body });
      return { favorites: next.map(summary) };
    },
  );

  app.delete<{ Params: { tmdbId: string } }>(
    "/api/recommendations/favorites/:tmdbId",
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const auth = requireAuth(request);
      const next = await favorites.remove(auth.user.id, parseTmdbId(request.params.tmdbId));
      return { favorites: next.map(summary) };
    },
  );

  app.post<{ Body: unknown }>("/api/recommendations/hidden", async (request, reply) => {
    reply.header("cache-control", "no-store");
    requireAuth(request);
    const body = request.body as { tmdbId?: unknown; title?: unknown; year?: unknown } | null;
    const tmdbId = parseTmdbId(String(body?.tmdbId ?? ""));
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!title) {
      throw new ApiError(400, "invalid_body", "title is required");
    }
    const year = typeof body?.year === "number" && Number.isSafeInteger(body.year) ? body.year : undefined;
    const client = requireRadarr(config);
    try {
      const existing = (await client.listExclusions()).find((entry) => entry.tmdbId === tmdbId);
      const exclusion =
        existing ?? (await client.addExclusion({ tmdbId, movieTitle: title, movieYear: year }));
      radarrCache = null;
      discoverCache = null;
      return { id: exclusion.id, tmdbId, title, year };
    } catch (error) {
      throw new ApiError(502, "radarr_exclusion_failed", errorMessage(error));
    }
  });

  app.delete<{ Params: { id: string } }>("/api/recommendations/hidden/:id", async (request, reply) => {
    reply.header("cache-control", "no-store");
    requireAuth(request);
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new ApiError(400, "invalid_id", "id must be a positive integer");
    }
    try {
      await requireRadarr(config).deleteExclusion(id);
      radarrCache = null;
      discoverCache = null;
      return reply.code(204).send();
    } catch (error) {
      throw new ApiError(502, "radarr_exclusion_failed", errorMessage(error));
    }
  });
}

function requireRadarr(config: AppConfig) {
  const radarr = config.services.radarr;
  if (!radarr.apiKey) {
    throw new ApiError(503, "radarr_unconfigured", "Radarr is not configured");
  }
  return createArrClient("radarr", radarr, config.requestTimeoutMs);
}

/**
 * Trending, popular and every import list's movies come from one Radarr call,
 * plus the list names. Cached like the recommendations: Radarr refreshes its
 * lists on its own schedule (at most every 12 hours), so a short cache loses
 * nothing.
 */
async function loadDiscover(
  config: AppConfig,
): Promise<{ movies: ServarrRecommendedMovie[]; lists: ServarrImportList[] }> {
  const service = config.services.radarr;
  if (discoverCache && discoverCache.url === service.url && discoverCache.expires > Date.now()) {
    return discoverCache;
  }
  const client = createArrClient(
    "radarr",
    service,
    Math.max(config.requestTimeoutMs, config.searchTimeoutMs),
  );
  const [movies, lists] = await Promise.all([
    client.listDiscoverMovies({ trending: true, popular: true }),
    client.listImportLists().catch(() => [] as ServarrImportList[]),
  ]);
  discoverCache = { url: service.url, expires: Date.now() + RADARR_TTL_MS, movies, lists };
  return discoverCache;
}

async function loadRadarrRecommendations(config: AppConfig): Promise<ServarrRecommendedMovie[]> {
  const service = config.services.radarr;
  if (radarrCache && radarrCache.url === service.url && radarrCache.expires > Date.now()) {
    return radarrCache.movies;
  }
  const client = createArrClient(
    "radarr",
    service,
    Math.max(config.requestTimeoutMs, config.searchTimeoutMs),
  );
  const movies = await client.listMovieRecommendations();
  radarrCache = { url: service.url, expires: Date.now() + RADARR_TTL_MS, movies };
  return movies;
}

/**
 * Radarr only suggests from the library, so each favourite adds the movies
 * Radarr's metadata recommends for it. Those are looked up through Radarr for
 * their posters and details, and marked as owned or excluded the way Radarr's
 * own suggestions already are. Any failure here leaves Radarr's list as it is.
 */
async function withFavoriteSeeds(
  config: AppConfig,
  suggested: ServarrRecommendedMovie[],
  loved: FavoriteMovieSummary[],
): Promise<Candidate[]> {
  const seeds = new Map<number, number>();
  const seeding = loved.slice(0, SEEDING_FAVORITES);
  const lists = await Promise.all(
    seeding.map((movie) => metadataRecommendations(movie.tmdbId, config.requestTimeoutMs)),
  );
  for (const ids of lists) {
    for (const id of ids.slice(0, SEEDS_PER_FAVORITE)) {
      seeds.set(id, (seeds.get(id) ?? 0) + 1);
    }
  }
  const candidates: Candidate[] = suggested.map((movie) => ({
    movie,
    favoriteSeeds: movie.tmdbId ? (seeds.get(movie.tmdbId) ?? 0) : 0,
  }));
  const known = new Set(suggested.map((movie) => movie.tmdbId));
  const missing = [...seeds.keys()].filter((id) => !known.has(id));
  if (missing.length === 0) {
    return candidates;
  }

  const client = createArrClient("radarr", config.services.radarr, config.requestTimeoutMs);
  const [libraryIds, excludedIds, looked] = await Promise.all([
    client
      .listMovies()
      .then((movies) => new Set(movies.map((movie) => movie.tmdbId)))
      .catch(() => null),
    client
      .listExclusions()
      .then((entries) => new Set(entries.map((entry) => entry.tmdbId)))
      .catch(() => new Set<number>()),
    Promise.all(missing.map((id) => lookupMovie(client, id))),
  ]);
  if (!libraryIds) {
    // Without the library list an owned movie could be suggested; skip seeding.
    return candidates;
  }
  missing.forEach((id, index) => {
    const movie = looked[index];
    if (!movie) return;
    candidates.push({
      movie: { ...movie, isExisting: libraryIds.has(id), isExcluded: excludedIds.has(id) },
      favoriteSeeds: seeds.get(id) ?? 0,
    });
  });
  return candidates;
}

/** How many related movies the movie page shows. */
const SIMILAR_LIMIT = 18;

/**
 * "More like this" for one movie: the movies Radarr's metadata recommends for
 * it, in its order. Movies already in Radarr stay, marked requested or
 * available and linked to their page, so the row doubles as navigation around
 * the library; hidden movies are dropped.
 */
async function similarMovies(
  client: ReturnType<typeof createArrClient>,
  ids: number[],
  library: ServarrMovieResource[],
  excluded: Set<number>,
  self: number,
): Promise<SearchResult[]> {
  const owned = new Map(
    library.filter((movie) => movie.tmdbId).map((movie) => [movie.tmdbId!, movie] as const),
  );
  const wanted = [...new Set(ids)]
    .filter((id) => id !== self && !excluded.has(id))
    .slice(0, SIMILAR_LIMIT);
  const movies = await Promise.all(
    wanted.map(async (id) => owned.get(id) ?? (await lookupMovie(client, id))),
  );
  const results: SearchResult[] = [];
  for (const movie of movies) {
    if (!movie?.tmdbId) continue;
    const mine = owned.get(movie.tmdbId);
    const result = mapMovieResource(
      movie,
      mine !== undefined,
      mine ? isMovieAvailable(mine) : undefined,
    );
    if (!result) continue;
    results.push(mine?.id ? { ...result, radarrId: mine.id } : result);
  }
  return results;
}

async function lookupMovie(
  client: ReturnType<typeof createArrClient>,
  tmdbId: number,
): Promise<ServarrMovieResource | null> {
  const cached = lookupCache.get(tmdbId);
  if (cached && cached.expires > Date.now()) {
    return cached.movie;
  }
  const movie = await client.lookupMovieByTmdbId(tmdbId).catch(() => null);
  lookupCache.set(tmdbId, { expires: Date.now() + LOOKUP_TTL_MS, movie });
  return movie;
}

function summary(movie: FavoriteMovieSummary): FavoriteMovieSummary {
  return {
    tmdbId: movie.tmdbId,
    title: movie.title,
    year: movie.year,
    genres: movie.genres,
    imageUrl: movie.imageUrl,
  };
}

function parseTmdbId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError(400, "invalid_tmdb_id", "tmdbId must be a positive integer");
  }
  return id;
}

function parseFavoriteBody(body: unknown): Omit<FavoriteMovieSummary, "tmdbId"> {
  const value = (body ?? {}) as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.trim().slice(0, 200) : "";
  if (!title) {
    throw new ApiError(400, "invalid_body", "title is required");
  }
  const year =
    typeof value.year === "number" && Number.isSafeInteger(value.year) ? value.year : undefined;
  const genres = Array.isArray(value.genres)
    ? value.genres
        .filter((genre): genre is string => typeof genre === "string")
        .map((genre) => genre.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 10)
    : [];
  // Only churn's own image proxy, so a stored favourite cannot point anywhere else.
  const imageUrl =
    typeof value.imageUrl === "string" && value.imageUrl.startsWith("/api/search/images/")
      ? value.imageUrl.slice(0, 2000)
      : undefined;
  return { title, year, genres, imageUrl };
}
