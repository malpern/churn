import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { requireAuth } from "../auth.js";
import { ApiError } from "../errors.js";
import {
  LEARN_SUBJECTS,
  chooseKeywordIds,
  dailySeed,
  mentionsTopic,
  pickExploration,
  rankTitles,
  type LearnSubject,
} from "../learn.js";
import {
  MAX_INTERESTS_LENGTH,
  parseTopics,
  type LearningInterestStore,
} from "../learning-interests.js";
import { isMovieAvailable, isSeriesAvailable, mapMovieResource, mapSeriesResource } from "../search.js";
import type { TmdbKeyStore } from "../tmdb-key.js";
import type {
  DiscoverRow,
  LearnInterestsResponse,
  LearnResponse,
  LearnState,
  LearnSubjectResponse,
  SearchResult,
} from "../types.js";
import {
  createArrClient,
  type ServarrMovieResource,
  type ServarrSeriesResource,
} from "../upstream/servarr.js";
import {
  TMDB_IMAGE_URL,
  TmdbError,
  tmdbDiscoverDocumentaries,
  tmdbSearchKeywords,
  tmdbTvdbId,
  type TmdbDiscoverOptions,
  type TmdbTitle,
} from "../upstream/tmdb.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Keyword ids and TVDB ids barely change. */
const ID_TTL_MS = 30 * DAY_MS;
/** Discover answers move slowly; half a day keeps the page fast. */
const DISCOVER_TTL_MS = 12 * 60 * 60 * 1000;
const RADARR_POOL_TTL_MS = 30 * 60 * 1000;
const SHELF_SIZE = 18;
const MIN_SHELF = 4;
const MAX_INTEREST_SHELVES = 8;
/** Shows per shelf, since each needs a TVDB lookup before it can be requested. */
const MAX_SHOWS_PER_SHELF = 6;

const keywordCache = new Map<string, { expires: number; ids: number[] }>();
const discoverCache = new Map<string, { expires: number; titles: TmdbTitle[] }>();
const tvdbCache = new Map<number, { expires: number; id: number | undefined }>();
let radarrPool: { expires: number; movies: ServarrMovieResource[] } | null = null;

/** Forget cached TMDB and Radarr answers. For tests. */
export function clearLearnCache(): void {
  keywordCache.clear();
  discoverCache.clear();
  tvdbCache.clear();
  radarrPool = null;
}

export function registerLearnRoutes(
  app: FastifyInstance,
  config: AppConfig,
  tmdbKey: TmdbKeyStore,
  interests: LearningInterestStore,
): void {
  app.get("/api/learn/interests", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = requireAuth(request);
    const entry = interests.get(auth.user.id);
    const response: LearnInterestsResponse = {
      text: entry?.text ?? "",
      ...(entry ? { updatedAt: entry.updatedAt } : {}),
      topics: entry ? parseTopics(entry.text) : [],
    };
    return response;
  });

  app.put<{ Body: { text?: unknown } }>("/api/learn/interests", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = requireAuth(request);
    if (typeof request.body?.text !== "string") {
      throw new ApiError(400, "invalid_interests", "Send the interests as text");
    }
    if (request.body.text.length > MAX_INTERESTS_LENGTH) {
      throw new ApiError(400, "interests_too_long", `Keep it under ${MAX_INTERESTS_LENGTH} characters`);
    }
    const entry = await interests.set(auth.user.id, request.body.text);
    const response: LearnInterestsResponse = {
      text: entry?.text ?? "",
      ...(entry ? { updatedAt: entry.updatedAt } : {}),
      topics: entry ? parseTopics(entry.text) : [],
    };
    return response;
  });

  app.get("/api/learn", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = requireAuth(request);
    const text = interests.get(auth.user.id)?.text;
    const topics = text ? parseTopics(text) : [];
    const key = tmdbKey.get()?.apiKey;
    const library = await loadLibrary(config);
    if (!key) {
      return keylessLearn(config, topics, library);
    }
    try {
      return await tmdbLearn(config, key, auth.user.id, topics, library);
    } catch (error) {
      return failedLearn(error, topics);
    }
  });

  app.get<{ Params: { subjectId: string } }>("/api/learn/subjects/:subjectId", async (request, reply) => {
    reply.header("cache-control", "no-store");
    requireAuth(request);
    const subject = LEARN_SUBJECTS.find((entry) => entry.id === request.params.subjectId);
    if (!subject) {
      throw new ApiError(404, "subject_not_found", "No such subject");
    }
    const summary = { id: subject.id, label: subject.label };
    const key = tmdbKey.get()?.apiKey;
    if (!key) {
      const response: LearnSubjectResponse = { state: "no_key", subject: summary, rows: [] };
      return response;
    }
    try {
      const library = await loadLibrary(config);
      const ids = await subjectKeywordIds(key, subject, config);
      const since = yearsAgo(3);
      const [acclaimed, recent] = await Promise.all([
        discoverBoth(key, config, { keywordIds: ids, sortBy: "vote_count.desc", minVotes: 10 }),
        discoverBoth(key, config, { keywordIds: ids, sortBy: "popularity.desc", minVotes: 5, since }),
      ]);
      const rows = await finishRows(key, config, library, [
        { id: `subject-${subject.id}-acclaimed`, title: `Acclaimed: ${subject.label}`, titles: rankTitles(acclaimed, { limit: 40 }) },
        {
          id: `subject-${subject.id}-recent`,
          title: "From the last few years",
          titles: rankTitles(recent, { limit: 40, floor: 6.3 }),
        },
      ]);
      const response: LearnSubjectResponse = { state: "ok", subject: summary, rows };
      return response;
    } catch (error) {
      const response: LearnSubjectResponse = { state: stateFor(error), subject: summary, rows: [] };
      return response;
    }
  });
}

interface Library {
  movies: Map<number, ServarrMovieResource> | null;
  excluded: Set<number>;
  series: Map<number, ServarrSeriesResource> | null;
}

async function loadLibrary(config: AppConfig): Promise<Library> {
  const radarr = config.services.radarr.apiKey
    ? createArrClient("radarr", config.services.radarr, config.requestTimeoutMs)
    : null;
  const sonarr = config.services.sonarr.apiKey
    ? createArrClient("sonarr", config.services.sonarr, config.requestTimeoutMs)
    : null;
  const [movies, excluded, series] = await Promise.all([
    radarr?.listMovies().catch(() => null) ?? null,
    radarr
      ?.listExclusions()
      .then((entries) => new Set(entries.map((entry) => entry.tmdbId)))
      .catch(() => new Set<number>()) ?? new Set<number>(),
    sonarr?.listSeries().catch(() => null) ?? null,
  ]);
  return {
    movies: movies
      ? new Map(movies.filter((movie) => movie.tmdbId).map((movie) => [movie.tmdbId!, movie] as const))
      : null,
    excluded,
    series: series
      ? new Map(series.filter((show) => show.tvdbId).map((show) => [show.tvdbId!, show] as const))
      : null,
  };
}

/**
 * The page with a TMDB key: a shelf per interest that has good documentaries,
 * then what is popular, what is acclaimed, and one subject outside the
 * person's usual, plus every subject to browse.
 */
async function tmdbLearn(
  config: AppConfig,
  key: string,
  userId: string,
  topics: string[],
  library: Library,
): Promise<LearnResponse> {
  const topicIds = await mapLimit(topics, 6, (topic) => tolerant(topicKeywordIds(key, topic, config), []));
  const allTopicIds = new Set(topicIds.flat());
  const subjectIds = new Map<string, number[]>();
  await mapLimit(LEARN_SUBJECTS, 6, async (subject) => {
    subjectIds.set(subject.id, await tolerant(subjectKeywordIds(key, subject, config), []));
  });

  const pending: PendingRow[] = [];
  const unmatched: string[] = [];
  const shown = new Set<string>();
  const shelves = await mapLimit(topics, 4, async (topic, index) => {
    const ids = topicIds[index] ?? [];
    if (ids.length === 0) return [];
    return tolerant(discoverBoth(key, config, { keywordIds: ids, sortBy: "vote_count.desc", minVotes: 5 }), []);
  });
  topics.forEach((topic, index) => {
    const titles = rankTitles(shelves[index] ?? [], { limit: SHELF_SIZE * 2 }).filter(
      (title) => !shown.has(`${title.media}:${title.id}`),
    );
    if (titles.length < MIN_SHELF || pending.length >= MAX_INTEREST_SHELVES) {
      if (titles.length < MIN_SHELF) unmatched.push(topic);
      return;
    }
    const picked = titles.slice(0, SHELF_SIZE);
    picked.forEach((title) => shown.add(`${title.media}:${title.id}`));
    pending.push({ id: `topic-${index}`, title: `Because you’re into ${topic}`, titles: picked });
  });

  const [popular, acclaimed] = await Promise.all([
    discoverBoth(key, config, { sortBy: "popularity.desc", minVotes: 20, since: yearsAgo(2) }),
    discoverBoth(key, config, { sortBy: "vote_average.desc", minVotes: 300 }),
  ]);
  pending.push({
    id: "popular",
    title: "Popular right now",
    subtitle: "Documentaries and docuseries people are watching, on any subject.",
    titles: rankTitles(popular, { limit: SHELF_SIZE, floor: 6.3 }),
  });
  pending.push({
    id: "acclaimed",
    title: "Acclaimed",
    subtitle: "The best-rated documentaries, by thousands of votes.",
    titles: rankTitles(acclaimed, { limit: SHELF_SIZE, floor: 7 }),
  });

  const explore = pickExploration(LEARN_SUBJECTS, subjectIds, allTopicIds, topics, dailySeed(userId, new Date()));
  if (explore) {
    const titles = await discoverBoth(key, config, {
      keywordIds: subjectIds.get(explore.id) ?? [],
      sortBy: "vote_count.desc",
      minVotes: 20,
    });
    pending.push({
      id: `explore-${explore.id}`,
      title: `Outside your usual: ${explore.label}`,
      subtitle: topics.length > 0 ? "Something you haven’t said you’re into. A new subject every day." : undefined,
      titles: rankTitles(titles, { limit: SHELF_SIZE, floor: 7 }),
    });
  }

  return {
    state: "ok",
    interests: { set: topics.length > 0, topics, unmatched },
    rows: await finishRows(key, config, library, pending),
    subjects: LEARN_SUBJECTS.filter((subject) => (subjectIds.get(subject.id) ?? []).length > 0).map(
      ({ id, label }) => ({ id, label }),
    ),
  };
}

/**
 * Without a key churn has only the movies Radarr's Discover already gathers.
 * The documentaries among them make one row, with ones matching an interest
 * first.
 */
async function keylessLearn(config: AppConfig, topics: string[], library: Library): Promise<LearnResponse> {
  let movies: ServarrMovieResource[] = [];
  if (config.services.radarr.apiKey) {
    if (radarrPool && radarrPool.expires > Date.now()) {
      movies = radarrPool.movies;
    } else {
      try {
        movies = await createArrClient("radarr", config.services.radarr, config.requestTimeoutMs).listDiscoverMovies({
          recommendations: true,
          trending: true,
          popular: true,
        });
        radarrPool = { expires: Date.now() + RADARR_POOL_TTL_MS, movies };
      } catch {
        movies = [];
      }
    }
  }
  const relevance = (movie: ServarrMovieResource) =>
    topics.some((topic) => mentionsTopic(`${movie.title ?? ""} ${movie.overview ?? ""}`, topic)) ? 1 : 0;
  const docs = movies
    .filter((movie) => movie.genres?.includes("Documentary") && movie.tmdbId && !library.excluded.has(movie.tmdbId))
    .sort((a, b) => relevance(b) - relevance(a));
  const results: SearchResult[] = [];
  for (const movie of docs.slice(0, SHELF_SIZE)) {
    const mine = library.movies?.get(movie.tmdbId!);
    const result = mapMovieResource(movie, library.movies ? mine !== undefined : null, mine ? isMovieAvailable(mine) : undefined);
    if (result) results.push(mine?.id ? { ...result, radarrId: mine.id } : result);
  }
  return {
    state: "no_key",
    interests: { set: topics.length > 0, topics, unmatched: [] },
    rows:
      results.length > 0
        ? [{ id: "radarr-documentaries", title: "Documentaries Radarr suggests", results }]
        : [],
    subjects: [],
  };
}

function failedLearn(error: unknown, topics: string[]): LearnResponse {
  return {
    state: stateFor(error),
    interests: { set: topics.length > 0, topics, unmatched: [] },
    rows: [],
    subjects: [],
  };
}

function stateFor(error: unknown): LearnState {
  return error instanceof TmdbError && error.kind === "invalid_key" ? "invalid_key" : "unavailable";
}

interface PendingRow {
  id: string;
  title: string;
  subtitle?: string;
  titles: TmdbTitle[];
}

/** Turn TMDB titles into request cards: library marks, exclusions, TVDB ids. */
async function finishRows(
  key: string,
  config: AppConfig,
  library: Library,
  pending: PendingRow[],
): Promise<DiscoverRow[]> {
  const rows: DiscoverRow[] = [];
  for (const row of pending) {
    let shows = 0;
    const titles = row.titles.filter((title) => {
      if (title.media === "movie") return !library.excluded.has(title.id);
      shows += 1;
      return shows <= MAX_SHOWS_PER_SHELF;
    });
    const results = await mapLimit(titles, 8, (title) => toResult(key, config, library, title));
    const kept = results.filter((result): result is SearchResult => result !== null);
    if (kept.length >= MIN_SHELF) {
      rows.push({ id: row.id, title: row.title, ...(row.subtitle ? { subtitle: row.subtitle } : {}), results: kept });
    }
  }
  return rows;
}

async function toResult(
  key: string,
  config: AppConfig,
  library: Library,
  title: TmdbTitle,
): Promise<SearchResult | null> {
  const year = Number.parseInt(title.date?.slice(0, 4) ?? "", 10);
  const common = {
    title: title.title,
    ...(Number.isSafeInteger(year) ? { year } : {}),
    ...(title.overview ? { overview: title.overview } : {}),
    ...(title.posterPath
      ? { images: [{ coverType: "poster", remoteUrl: `${TMDB_IMAGE_URL}/w500${title.posterPath}` }] }
      : {}),
    genres: ["Documentary"],
  };
  if (title.media === "movie") {
    const mine = library.movies?.get(title.id);
    const result = mapMovieResource(
      {
        ...common,
        tmdbId: title.id,
        ...(title.voteCount ? { ratings: { tmdb: { value: title.voteAverage, votes: title.voteCount } } } : {}),
      } as ServarrMovieResource,
      library.movies ? mine !== undefined : null,
      mine ? isMovieAvailable(mine) : undefined,
    );
    return result && mine?.id ? { ...result, radarrId: mine.id } : result;
  }
  const tvdbId = await cachedTvdbId(key, title.id, config);
  if (tvdbId === undefined) return null;
  const mine = library.series?.get(tvdbId);
  return mapSeriesResource(
    {
      ...common,
      tvdbId,
      tmdbId: title.id,
      ...(title.voteCount ? { ratings: { value: title.voteAverage, votes: title.voteCount } } : {}),
    } as ServarrSeriesResource,
    library.series ? mine !== undefined : null,
    mine ? isSeriesAvailable(mine) : undefined,
  );
}

async function topicKeywordIds(key: string, topic: string, config: AppConfig): Promise<number[]> {
  const cacheKey = topic.toLowerCase();
  const cached = keywordCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.ids;
  let ids = chooseKeywordIds(topic, await tmdbSearchKeywords(key, topic, timeout(config)));
  if (ids.length === 0 && /s$/i.test(topic)) {
    ids = chooseKeywordIds(topic, await tmdbSearchKeywords(key, topic.replace(/s$/i, ""), timeout(config)));
  }
  keywordCache.set(cacheKey, { expires: Date.now() + ID_TTL_MS, ids });
  return ids;
}

async function subjectKeywordIds(key: string, subject: LearnSubject, config: AppConfig): Promise<number[]> {
  const ids = await mapLimit(subject.keywords, 4, async (keyword) => {
    const cacheKey = `subject:${keyword}`;
    const cached = keywordCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.ids;
    const found = chooseKeywordIds(keyword, await tmdbSearchKeywords(key, keyword, timeout(config))).slice(0, 1);
    keywordCache.set(cacheKey, { expires: Date.now() + ID_TTL_MS, ids: found });
    return found;
  });
  return [...new Set(ids.flat())];
}

/** Movies and shows for the same query, merged. */
async function discoverBoth(
  key: string,
  config: AppConfig,
  options: Omit<TmdbDiscoverOptions, "media">,
): Promise<TmdbTitle[]> {
  if (options.keywordIds && options.keywordIds.length === 0) return [];
  const [movies, shows] = await Promise.all([
    cachedDiscover(key, config, { ...options, media: "movie" }),
    cachedDiscover(key, config, { ...options, media: "tv" }),
  ]);
  return [...movies, ...shows];
}

async function cachedDiscover(key: string, config: AppConfig, options: TmdbDiscoverOptions): Promise<TmdbTitle[]> {
  const cacheKey = JSON.stringify(options);
  const cached = discoverCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.titles;
  const titles = await tmdbDiscoverDocumentaries(key, options, timeout(config));
  discoverCache.set(cacheKey, { expires: Date.now() + DISCOVER_TTL_MS, titles });
  return titles;
}

async function cachedTvdbId(key: string, tvId: number, config: AppConfig): Promise<number | undefined> {
  const cached = tvdbCache.get(tvId);
  if (cached && cached.expires > Date.now()) return cached.id;
  try {
    const id = await tmdbTvdbId(key, tvId, timeout(config));
    tvdbCache.set(tvId, { expires: Date.now() + ID_TTL_MS, id });
    return id;
  } catch (error) {
    if (error instanceof TmdbError && error.kind === "invalid_key") throw error;
    return undefined;
  }
}

function timeout(config: AppConfig): number {
  return config.requestTimeoutMs * 4;
}

function yearsAgo(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

/** One topic failing to load should not sink the page; a rejected key should. */
async function tolerant<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof TmdbError && error.kind === "invalid_key") throw error;
    return fallback;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
