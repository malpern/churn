import { describe, expect, it } from "vitest";

import {
  LEARN_SUBJECTS,
  chooseKeywordIds,
  dailySeed,
  looksLikeJunk,
  mentionsTopic,
  pickExploration,
  qualityScore,
  rankTitles,
} from "../src/learn.js";
import { parseTopics } from "../src/learning-interests.js";
import type { TmdbTitle } from "../src/upstream/tmdb.js";

function title(id: number, voteAverage: number, voteCount: number, media: "movie" | "tv" = "movie"): TmdbTitle {
  return { id, media, title: `T${id}`, voteAverage, voteCount, popularity: 1 };
}

describe("parseTopics", () => {
  it("reads a Topics line that wraps until a blank line", () => {
    const text = "I like things.\n\nTopics: jazz, space exploration,\nAI; the Roman Empire.\n\nTopics are fun.";
    expect(parseTopics(text)).toEqual(["jazz", "space exploration", "AI", "the Roman Empire"]);
  });

  it("falls back to the lead-in of each bullet, and dedupes", () => {
    const text = "- Gardening: soil\n* **Design** — motion\n- gardening: again\nplain line: ignored";
    expect(parseTopics(text)).toEqual(["Gardening", "Design"]);
  });

  it("returns nothing for free prose without either", () => {
    expect(parseTopics("I just like learning about lots of things.")).toEqual([]);
  });
});

describe("keyword choice", () => {
  const results = [
    { id: 1, name: "keyboarding" },
    { id: 2, name: "keyboard" },
    { id: 3, name: "keyboard player" },
    { id: 4, name: "computer keyboard" },
  ];
  it("prefers an exact match (ignoring a plural) then names that start with the topic", () => {
    expect(chooseKeywordIds("Keyboards", results)).toEqual([2, 3]);
  });
  it("treats a bracketed suffix as part of the same name", () => {
    expect(chooseKeywordIds("artificial intelligence", [{ id: 9, name: "artificial intelligence (a.i.)" }])).toEqual([9]);
  });
});

describe("ranking", () => {
  it("trusts many votes over a perfect score from a few", () => {
    expect(qualityScore(title(1, 7.6, 2000))).toBeGreaterThan(qualityScore(title(2, 10, 3)));
  });
  it("drops weak and duplicate titles and keeps the best first", () => {
    const ranked = rankTitles(
      [title(1, 7.2, 500), title(2, 5, 900), title(1, 7.2, 500), title(3, 8.1, 1500), title(3, 8.1, 1500, "tv")],
      { limit: 10 },
    );
    expect(ranked.map((entry) => `${entry.media}:${entry.id}`)).toEqual(["movie:3", "tv:3", "movie:1"]);
  });
});

describe("the junk filter", () => {
  it("catches speculation dressed as history or science", () => {
    for (const title of [
      { title: "Ancient Aliens", overview: "Did extraterrestrials visit Earth?" },
      { title: "The Pyramid Code", overview: "Were the pyramids built by aliens helped by a lost race?" },
      { title: "Ghost Adventures" },
      { title: "Finding Bigfoot", overview: "The hunt for the Sasquatch." },
      { title: "Flat-Earth Rising" },
      { title: "Atlantis Found" },
    ]) {
      expect(looksLikeJunk(title), title.title).toBe(true);
    }
  });
  it("leaves real history and science alone", () => {
    for (const title of [
      { title: "Apollo 11", overview: "Footage of the first Moon landing." },
      { title: "Secrets of the Great Pyramid", overview: "Archaeologists find the workers' village at Giza." },
      { title: "My Octopus Teacher" },
      { title: "Helvetica", overview: "A film about typography and graphic design." },
    ]) {
      expect(looksLikeJunk(title), title.title).toBe(false);
    }
  });
  it("is applied when ranking", () => {
    const junk = { ...title(9, 8.5, 5000), title: "Ancient Aliens" };
    expect(rankTitles([junk, title(1, 7.4, 400)], { limit: 5 }).map((entry) => entry.id)).toEqual([1]);
  });
});

describe("exploration", () => {
  const ids = new Map(LEARN_SUBJECTS.map((subject, index) => [subject.id, [index + 1000]]));
  it("never picks a subject that shares a keyword or a name with the person's topics", () => {
    const science = ids.get("science")![0]!;
    for (let seed = 0; seed < 50; seed += 1) {
      const pick = pickExploration(LEARN_SUBJECTS, ids, new Set([science]), ["baseball", "cooking"], seed);
      expect(pick && ["science", "sport", "food"].includes(pick.id)).toBe(false);
    }
  });
  it("changes from day to day for the same person", () => {
    const picks = new Set(
      Array.from({ length: 14 }, (_, day) =>
        pickExploration(LEARN_SUBJECTS, ids, new Set(), [], dailySeed("u1", new Date(Date.UTC(2026, 0, day + 1))))?.id,
      ),
    );
    expect(picks.size).toBeGreaterThan(3);
  });
});

describe("mentionsTopic", () => {
  it("matches whole words and phrases only", () => {
    expect(mentionsTopic("A history of the computer keyboard.", "keyboards")).toBe(true);
    expect(mentionsTopic("Painting with light", "AI")).toBe(false);
  });
});
