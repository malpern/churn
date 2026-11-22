import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { requireAuth } from "../auth.js";
import { rankRecommendations, tasteSignals, type TasteSignal } from "../recommendations.js";
import type { RecommendationsResponse } from "../types.js";
import { createJellyfinClient } from "../upstream/jellyfin.js";
import { createArrClient, type ServarrRecommendedMovie } from "../upstream/servarr.js";
import { errorMessage, stateForError } from "../upstream/states.js";

/**
 * Radarr asks its metadata service for every library movie, so its answer is
 * reused for a while; it only changes when the library does. Requests clear it
 * implicitly by changing `isExisting`, which is why the TTL stays short.
 */
const RADARR_TTL_MS = 30 * 60 * 1000;
let radarrCache: { url: string; expires: number; movies: ServarrRecommendedMovie[] } | null = null;

/** Forget Radarr's cached answer. For tests. */
export function clearRecommendationCache(): void {
  radarrCache = null;
}

export function registerRecommendationRoutes(app: FastifyInstance, config: AppConfig): void {
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

    const jellyfin = createJellyfinClient(
      config.services.jellyfin,
      config.requestTimeoutMs,
      auth.accessToken,
      { deviceId: auth.deviceId },
    );
    const [candidates, library] = await Promise.allSettled([
      loadRadarrRecommendations(config),
      jellyfin.listLibrary(auth.user.id),
    ]);
    if (candidates.status === "rejected") {
      const response: RecommendationsResponse = {
        state: stateForError(candidates.reason),
        detail: errorMessage(candidates.reason),
        results: [],
      };
      return response;
    }

    // Without Jellyfin the suggestions still show, ordered by rating alone.
    const signals: TasteSignal[] =
      library.status === "fulfilled" ? tasteSignals(library.value) : [];
    const response: RecommendationsResponse = {
      state: "ok",
      results: rankRecommendations(candidates.value, signals),
    };
    return response;
  });
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
