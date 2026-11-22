import type { TmdbTitle } from "./upstream/tmdb.js";

/**
 * A subject to browse on the Learn page. Keywords are TMDB keyword *names*,
 * resolved to ids at run time by exact match, so a wrong guess costs a missed
 * keyword rather than a wrong shelf. The list doubles as the pool "Outside
 * your usual" picks from.
 */
export interface LearnSubject {
  id: string;
  label: string;
  keywords: string[];
}

export const LEARN_SUBJECTS: LearnSubject[] = [
  { id: "science", label: "Science", keywords: ["science", "physics", "biology", "chemistry"] },
  { id: "space", label: "Space", keywords: ["space", "astronomy", "outer space", "space exploration"] },
  { id: "nature", label: "Nature & wildlife", keywords: ["nature", "wildlife", "animal", "ocean"] },
  { id: "history", label: "History", keywords: ["history", "world war ii", "ancient history", "cold war"] },
  { id: "technology", label: "Technology", keywords: ["technology", "computer", "internet", "artificial intelligence (a.i.)"] },
  { id: "design", label: "Art & design", keywords: ["art", "design", "architecture", "painting"] },
  { id: "music", label: "Music", keywords: ["music", "musician", "rock music", "jazz"] },
  { id: "food", label: "Food", keywords: ["food", "cooking", "chef", "restaurant"] },
  { id: "sport", label: "Sport", keywords: ["sport", "athlete", "baseball", "football (soccer)"] },
  { id: "society", label: "Society & politics", keywords: ["society", "politics", "social issues", "democracy"] },
  { id: "money", label: "Money & business", keywords: ["economics", "money", "business", "entrepreneur"] },
  { id: "health", label: "Health & mind", keywords: ["medicine", "health", "mental health", "psychology"] },
  { id: "crime", label: "Crime & justice", keywords: ["true crime", "justice", "investigation", "prison"] },
  { id: "travel", label: "Places & cultures", keywords: ["travel", "culture", "city", "indigenous"] },
];

/**
 * TMDB keywords whose documentaries are mostly speculation dressed as fact:
 * ancient astronauts, ghosts, cryptids, conspiracy theories. Titles tagged
 * with any of them are left out of the Learn page. Names, resolved at run time
 * like the subjects' keywords.
 */
export const JUNK_KEYWORDS = [
  "ancient aliens",
  "ancient astronauts",
  "pseudoscience",
  "pseudohistory",
  "conspiracy theory",
  "paranormal",
  "paranormal investigation",
  "ghost hunting",
  "ghost",
  "haunted house",
  "ufo",
  "alien abduction",
  "bigfoot",
  "cryptozoology",
  "psychic",
  "supernatural",
  "atlantis",
  "flat earth",
];

/**
 * The same idea for titles TMDB has not tagged: words in the title or
 * overview that almost always mean speculation rather than evidence. Strict
 * on purpose; the cost of a miss is one good film, the cost of a hit is the
 * page's credibility.
 */
const JUNK_TEXT =
  /\b(ancient (aliens?|astronauts?)|extraterrestrials? (built|helped|visited)|aliens? (built|helped)|pseudoscience|paranormal|haunt(ed|ings?)|ghosts?|poltergeists?|ufos?|uaps?|bigfoot|sasquatch|cryptids?|yeti|psychics?|flat[- ]earth|atlantis|nephilim|illuminati|reptilians?|chemtrails?|forbidden (history|archaeology))\b/i;

export function looksLikeJunk(text: { title: string; overview?: string }): boolean {
  return JUNK_TEXT.test(`${text.title} ${text.overview ?? ""}`);
}

/**
 * The keyword ids for one topic, from TMDB's search results: an exact name
 * match (ignoring case and a trailing "s") first, then names that start with
 * the topic. At most three, so a broad topic does not swamp a shelf.
 */
export function chooseKeywordIds(topic: string, results: Array<{ id: number; name: string }>): number[] {
  const wanted = normalize(topic);
  const exact = results.filter((entry) => normalize(entry.name) === wanted);
  const prefix = results.filter(
    (entry) => !exact.includes(entry) && normalize(entry.name).startsWith(`${wanted} `),
  );
  return [...exact, ...prefix].slice(0, 3).map((entry) => entry.id);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/s$/, "");
}

/**
 * A rating that trusts many votes over few: TMDB's average pulled towards a
 * typical documentary score until enough people have voted.
 */
export function qualityScore(title: Pick<TmdbTitle, "voteAverage" | "voteCount">): number {
  const typical = 6.8;
  const weight = 40;
  const votes = Math.max(0, title.voteCount);
  return (votes / (votes + weight)) * title.voteAverage + (weight / (votes + weight)) * typical;
}

/** Best first, one entry per title, nothing below the floor. */
export function rankTitles(titles: TmdbTitle[], options: { limit: number; floor?: number }): TmdbTitle[] {
  const floor = options.floor ?? 6.8;
  const seen = new Set<string>();
  return titles
    .filter((title) => {
      const key = `${title.media}:${title.id}`;
      if (seen.has(key) || title.voteCount < 3 || qualityScore(title) < floor || looksLikeJunk(title)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => qualityScore(b) - qualityScore(a) || b.voteCount - a.voteCount)
    .slice(0, options.limit);
}

/**
 * A subject the person has not said they are into, different each day. A
 * subject counts as theirs when it shares a keyword with their topics or its
 * name appears in them.
 */
export function pickExploration(
  subjects: LearnSubject[],
  subjectKeywordIds: Map<string, number[]>,
  topicKeywordIds: Set<number>,
  topics: string[],
  seed: number,
): LearnSubject | undefined {
  const topicText = topics.map(normalize).join(" | ");
  const fresh = subjects.filter((subject) => {
    const ids = subjectKeywordIds.get(subject.id) ?? [];
    if (ids.some((id) => topicKeywordIds.has(id))) return false;
    return !subject.keywords.some((keyword) => topicText.includes(normalize(keyword)));
  });
  const pool = fresh.length > 0 ? fresh : subjects;
  return pool[Math.abs(seed) % pool.length];
}

/** A stable number for today and this person, so the pick changes daily. */
export function dailySeed(userId: string, now: Date): number {
  let hash = Math.floor(now.getTime() / 86_400_000);
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return hash;
}

/** True when the topic appears as a word or phrase in the text. */
export function mentionsTopic(text: string, topic: string): boolean {
  const wanted = normalize(topic);
  return wanted.length > 1 && ` ${normalize(text)} `.includes(` ${wanted}`);
}
