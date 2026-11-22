/**
 * Radarr's public metadata service, the source Radarr itself uses for movie
 * details and recommendations. It needs no key. churn asks it for one thing
 * Radarr's API does not expose: the recommendations for a single movie that is
 * not in the library (a favourite).
 */
export const RADARR_METADATA_URL = "https://api.radarr.video/v1";

const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<number, { expires: number; ids: number[] }>();

/** TMDB ids Radarr's metadata recommends for `tmdbId`; empty on any failure. */
export async function metadataRecommendations(
  tmdbId: number,
  timeoutMs: number,
  now: () => number = Date.now,
): Promise<number[]> {
  const cached = cache.get(tmdbId);
  if (cached && cached.expires > now()) {
    return cached.ids;
  }
  let ids: number[] = [];
  try {
    const response = await fetch(`${RADARR_METADATA_URL}/movie/${tmdbId}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      const body = (await response.json()) as { Recommendations?: Array<{ TmdbId?: unknown }> };
      ids = (body.Recommendations ?? [])
        .map((entry) => entry.TmdbId)
        .filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
    }
  } catch {
    ids = [];
  }
  cache.set(tmdbId, { expires: now() + TTL_MS, ids });
  return ids;
}

/** For tests. */
export function clearMetadataCache(): void {
  cache.clear();
}
