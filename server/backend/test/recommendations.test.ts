import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFavoriteStore } from "../src/recommendation-favorites.js";
import {
  genreWeights,
  rankRecommendations,
  tasteSignals,
  type Candidate,
} from "../src/recommendations.js";
import type { ServarrRecommendedMovie } from "../src/upstream/servarr.js";

function movie(
  tmdbId: number,
  title: string,
  genres: string[],
  rating: number,
  extra: Partial<ServarrRecommendedMovie> = {},
  favoriteSeeds = 0,
): Candidate {
  return {
    movie: { tmdbId, title, genres, ratings: { tmdb: { value: rating, votes: 100 } }, ...extra },
    favoriteSeeds,
  };
}

const titles = (results: Array<{ title: string }>) => results.map((result) => result.title);

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

describe("tasteSignals favourites", () => {
  it("counts a movie favourited in Jellyfin as a favourite, played or not", () => {
    const signals = tasteSignals([
      { Type: "Movie", Genres: ["Western"], UserData: { IsFavorite: true } },
      { Type: "Movie", Genres: ["Drama"], UserData: { IsFavorite: true, Played: true, PlayCount: 3 } },
      { Type: "Movie", Genres: ["Comedy"], UserData: { IsFavorite: false } },
    ]);
    expect(signals).toEqual([
      { genres: ["Western"], playCount: 0, favorite: true },
      { genres: ["Drama"], playCount: 3, favorite: true },
      { genres: ["Comedy"], playCount: 0 },
    ]);
    expect(genreWeights(signals).get("western")).toBe(6);
  });
});

describe("genreWeights", () => {
  it("weighs a favourite above a played movie, and a played one above one only kept", () => {
    const weights = genreWeights([
      { genres: ["Drama"], playCount: 50 },
      { genres: ["Comedy"], playCount: 0 },
      { genres: ["Western"], playCount: 0, favorite: true },
    ]);
    expect(weights.get("drama")).toBe(5);
    expect(weights.get("comedy")).toBe(1);
    expect(weights.get("western")).toBe(6);
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
    expect(titles(results)).toEqual(["Better Drama", "Quiet Drama", "Loud Comedy"]);
    expect(results[0]).toMatchObject({ kind: "movie", service: "radarr", tmdbId: 3, inLibrary: false });
  });

  it("lifts what a favourite suggested above a genre match", () => {
    const results = rankRecommendations(
      [movie(1, "Genre match", ["Drama"], 9), movie(2, "Favourite's pick", ["Horror"], 5, {}, 1)],
      [{ genres: ["Drama"], playCount: 1 }],
    );
    expect(titles(results)).toEqual(["Favourite's pick", "Genre match"]);
  });

  it("drops owned, excluded, repeated and favourited movies, and respects the limit", () => {
    const results = rankRecommendations(
      [
        movie(1, "Owned", ["Drama"], 9, { isExisting: true }),
        movie(2, "Dismissed", ["Drama"], 9, { isExcluded: true }),
        movie(5, "Already a favourite", ["Drama"], 9),
        movie(3, "Kept", ["Drama"], 7),
        movie(3, "Kept again", ["Drama"], 7),
        movie(4, "Also kept", ["Drama"], 6),
        { movie: { title: "No TMDB id", genres: ["Drama"] }, favoriteSeeds: 0 },
      ],
      [],
      { favoriteIds: new Set([5]), limit: 1 },
    );
    expect(titles(results)).toEqual(["Kept"]);
  });

  it("falls back to rating when there is no history", () => {
    const results = rankRecommendations(
      [movie(1, "Fine", ["Drama"], 6), movie(2, "Great", ["Comedy"], 8)],
      [],
    );
    expect(titles(results)).toEqual(["Great", "Fine"]);
  });
});

describe("favourite store", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function stateDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "churn-favorites-"));
    dirs.push(dir);
    return dir;
  }

  it("keeps favourites per person, newest first, and survives a restart", async () => {
    const dir = stateDir();
    const store = createFavoriteStore({ stateDir: dir, now: () => new Date("2026-11-22T00:00:00Z") });
    await store.add("micah", { tmdbId: 1, title: "Heat", genres: ["Crime"] });
    await store.add("micah", { tmdbId: 2, title: "Ran", genres: ["Drama"] });
    await store.add("sam", { tmdbId: 3, title: "Up", genres: ["Animation"] });
    await store.add("micah", { tmdbId: 1, title: "Heat", genres: ["Crime"] });

    const reloaded = createFavoriteStore({ stateDir: dir });
    expect(reloaded.list("micah").map((entry) => entry.title)).toEqual(["Heat", "Ran"]);
    expect(reloaded.list("sam").map((entry) => entry.title)).toEqual(["Up"]);
    await reloaded.remove("micah", 1);
    expect(createFavoriteStore({ stateDir: dir }).list("micah").map((entry) => entry.title)).toEqual(["Ran"]);
    expect(JSON.parse(readFileSync(path.join(dir, "recommendation-favorites.json"), "utf8")).version).toBe(1);
  });

  it("starts empty when the file is unreadable", () => {
    const warnings: string[] = [];
    const store = createFavoriteStore({ stateDir: "/nonexistent-churn-test-dir", onWarning: (w) => warnings.push(w) });
    expect(store.list("anyone")).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
