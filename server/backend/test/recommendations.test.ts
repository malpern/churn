import { describe, expect, it } from "vitest";

import { genreWeights, rankRecommendations, tasteSignals } from "../src/recommendations.js";
import type { ServarrRecommendedMovie } from "../src/upstream/servarr.js";

function movie(
  tmdbId: number,
  title: string,
  genres: string[],
  rating: number,
  extra: Partial<ServarrRecommendedMovie> = {},
): ServarrRecommendedMovie {
  return { tmdbId, title, genres, ratings: { tmdb: { value: rating, votes: 100 } }, ...extra };
}

describe("tasteSignals", () => {
  it("keeps movies only, and counts plays from Jellyfin's user data", () => {
    const signals = tasteSignals([
      { Type: "Movie", Genres: ["Drama"], UserData: { Played: true, PlayCount: 2 } },
      { Type: "Movie", Genres: ["Comedy"], UserData: { Played: false } },
      { Type: "Movie", Genres: ["Comedy"], UserData: { Played: true } },
      { Type: "Series", Genres: ["Animation"], UserData: { Played: true, PlayCount: 9 } },
    ]);
    expect(signals).toEqual([
      { genres: ["Drama"], playCount: 2 },
      { genres: ["Comedy"], playCount: 0 },
      { genres: ["Comedy"], playCount: 1 },
    ]);
  });
});

describe("genreWeights", () => {
  it("weighs a played movie above one only in the library, and caps replays", () => {
    const weights = genreWeights([
      { genres: ["Drama"], playCount: 50 },
      { genres: ["Comedy"], playCount: 0 },
    ]);
    expect(weights.get("drama")).toBe(5);
    expect(weights.get("comedy")).toBe(1);
  });
});

describe("rankRecommendations", () => {
  it("puts suggestions matching what was watched first, then by rating", () => {
    const results = rankRecommendations(
      [
        movie(1, "Loud Comedy", ["Comedy"], 9),
        movie(2, "Quiet Drama", ["Drama"], 6),
        movie(3, "Better Drama", ["Drama"], 8),
      ],
      [
        { genres: ["Drama"], playCount: 1 },
        { genres: ["Comedy"], playCount: 0 },
      ],
    );
    expect(results.map((result) => result.title)).toEqual([
      "Better Drama",
      "Quiet Drama",
      "Loud Comedy",
    ]);
    expect(results[0]).toMatchObject({ kind: "movie", service: "radarr", tmdbId: 3, inLibrary: false });
  });

  it("drops movies Radarr already has, excludes, or lists twice, and respects the limit", () => {
    const results = rankRecommendations(
      [
        movie(1, "Owned", ["Drama"], 9, { isExisting: true }),
        movie(2, "Dismissed", ["Drama"], 9, { isExcluded: true }),
        movie(3, "Kept", ["Drama"], 7),
        movie(3, "Kept again", ["Drama"], 7),
        movie(4, "Also kept", ["Drama"], 6),
        { title: "No TMDB id", genres: ["Drama"] },
      ],
      [],
      1,
    );
    expect(results.map((result) => result.title)).toEqual(["Kept"]);
  });

  it("falls back to rating when there is no watch history", () => {
    const results = rankRecommendations(
      [movie(1, "Fine", ["Drama"], 6), movie(2, "Great", ["Comedy"], 8)],
      [],
    );
    expect(results.map((result) => result.title)).toEqual(["Great", "Fine"]);
  });
});
