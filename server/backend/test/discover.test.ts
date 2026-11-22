import { describe, expect, it } from "vitest";

import { buildDiscoverRows } from "../src/discover.js";
import type { ServarrRecommendedMovie } from "../src/upstream/servarr.js";

function movie(tmdbId: number, title: string, extra: Partial<ServarrRecommendedMovie>): ServarrRecommendedMovie {
  return { tmdbId, title, ...extra };
}

describe("buildDiscoverRows", () => {
  it("splits Radarr's feed into trending, popular and one row per enabled list", () => {
    const rows = buildDiscoverRows(
      [
        movie(1, "Hot and big", { isTrending: true, isPopular: true, popularity: 90 }),
        movie(2, "Hot", { isTrending: true, popularity: 50 }),
        movie(3, "Big", { isPopular: true, popularity: 70 }),
        movie(4, "Cult pick", { lists: [7], popularity: 5 }),
        movie(5, "Owned", { isTrending: true, isExisting: true, popularity: 99 }),
        movie(6, "Hidden", { isPopular: true, isExcluded: true, popularity: 99 }),
        movie(8, "Disabled list only", { lists: [9] }),
      ],
      [
        { id: 7, name: "Midnight Movies", enabled: true, enableAuto: false },
        { id: 9, name: "Switched off", enabled: false },
      ],
    );
    expect(rows.map((row) => [row.id, row.title, row.results.map((result) => result.title)])).toEqual([
      ["trending", "Trending now", ["Hot and big", "Hot"]],
      ["popular", "Popular", ["Big"]],
      ["list:7", "Midnight Movies", ["Cult pick"]],
    ]);
    expect(rows[0]!.results[0]).toMatchObject({ kind: "movie", service: "radarr", inLibrary: false });
  });

  it("drops empty rows and caps each row", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      movie(index + 1, `Movie ${index + 1}`, { isTrending: true, popularity: 10 - index }),
    );
    const rows = buildDiscoverRows(many, [], 2);
    expect(rows.map((row) => row.id)).toEqual(["trending"]);
    expect(rows[0]!.results.map((result) => result.title)).toEqual(["Movie 1", "Movie 2"]);
  });
});
