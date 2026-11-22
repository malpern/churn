import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FILENAME = "learning-interests.json";
const VERSION = 1;
/** A few paragraphs is plenty; this keeps one paste from filling the disk. */
export const MAX_INTERESTS_LENGTH = 8_000;
const MAX_TOPICS = 30;

/**
 * What a person says they are into and want to learn about, in their own
 * words. Personal, so it lives per person in churn's state directory (0600)
 * and is never sent anywhere; only the short topics parsed from it are used
 * as TMDB keyword searches.
 */
export interface LearningInterests {
  text: string;
  updatedAt: string;
}

export interface LearningInterestStore {
  get(userId: string): LearningInterests | null;
  set(userId: string, text: string): Promise<LearningInterests | null>;
}

export function createLearningInterestStore(options: {
  stateDir: string;
  now?: () => Date;
  onWarning?: (message: string) => void;
}): LearningInterestStore {
  const filePath = path.join(options.stateDir, FILENAME);
  const now = options.now ?? (() => new Date());
  const onWarning = options.onWarning ?? (() => {});
  const users = load(filePath, onWarning);
  let writeChain: Promise<void> = Promise.resolve();

  function persist(): Promise<void> {
    const snapshot = Object.fromEntries(users);
    writeChain = writeChain
      .catch(() => {})
      .then(() => writeJson(filePath, { version: VERSION, users: snapshot }));
    return writeChain;
  }

  return {
    get(userId) {
      const entry = users.get(userId);
      return entry ? { ...entry } : null;
    },
    async set(userId, text) {
      const trimmed = text.trim();
      if (!trimmed) {
        users.delete(userId);
        await persist();
        return null;
      }
      const entry = { text: trimmed.slice(0, MAX_INTERESTS_LENGTH), updatedAt: now().toISOString() };
      users.set(userId, entry);
      await persist();
      return { ...entry };
    },
  };
}

/**
 * The topics in a person's interests text. A "Topics:" line (which the
 * suggested AI prompt asks for) wins and may wrap onto following lines until a
 * blank line. Without one, the lead-in of each bullet ("Keyboards: ...") is
 * used, so a hand-written list still works.
 */
export function parseTopics(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*(?:\*\*)?topics?(?:\*\*)?\s*:/i.test(line));
  let raw: string[] = [];
  if (start >= 0) {
    const collected = [lines[start]!.replace(/^\s*(?:\*\*)?topics?(?:\*\*)?\s*:/i, "")];
    for (const line of lines.slice(start + 1)) {
      if (!line.trim() || /^\s*[-*#]/.test(line) || /^\s*\w[\w ]*:\s/.test(line)) break;
      collected.push(line);
    }
    raw = collected.join(",").split(/[,;]/);
  } else {
    for (const line of lines) {
      const bullet = /^\s*[-*•]\s+([^:.\n]{2,40}?)\s*[:—–-]\s/.exec(line);
      if (bullet?.[1]) raw.push(bullet[1]);
    }
  }
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const entry of raw) {
    const topic = entry.replace(/[*_`"“”]/g, "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
    const key = topic.toLowerCase();
    if (topic.length < 2 || topic.length > 40 || seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
    if (topics.length >= MAX_TOPICS) break;
  }
  return topics;
}

function load(filePath: string, onWarning: (message: string) => void): Map<string, LearningInterests> {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      version?: number;
      users?: Record<string, LearningInterests>;
    };
    if (parsed.version !== VERSION || !parsed.users || typeof parsed.users !== "object") {
      return new Map();
    }
    return new Map(
      Object.entries(parsed.users).filter(
        (entry): entry is [string, LearningInterests] =>
          typeof entry[1]?.text === "string" && typeof entry[1]?.updatedAt === "string",
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      onWarning(`Could not read learning interests: ${error instanceof Error ? error.message : String(error)}`);
    }
    return new Map();
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}
