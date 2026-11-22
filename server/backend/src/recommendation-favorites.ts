import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FILENAME = "recommendation-favorites.json";
const VERSION = 1;
/** Enough to steer recommendations; more would only slow the seeding. */
export const MAX_FAVORITES = 50;

/**
 * A movie someone loves but does not need in the library. Radarr cannot hold
 * it without adding it to the library, and Jellyfin can only favourite what it
 * has, so this is the one recommendation input churn keeps itself, per person.
 */
export interface FavoriteMovie {
  tmdbId: number;
  title: string;
  year?: number;
  genres: string[];
  imageUrl?: string;
  addedAt: string;
}

export interface FavoriteStore {
  list(userId: string): FavoriteMovie[];
  add(userId: string, movie: Omit<FavoriteMovie, "addedAt">): Promise<FavoriteMovie[]>;
  remove(userId: string, tmdbId: number): Promise<FavoriteMovie[]>;
}

export function createFavoriteStore(options: {
  stateDir: string;
  now?: () => Date;
  onWarning?: (message: string) => void;
}): FavoriteStore {
  const filePath = path.join(options.stateDir, FILENAME);
  const now = options.now ?? (() => new Date());
  const onWarning = options.onWarning ?? (() => {});
  const users = load(filePath, onWarning);
  let writeChain: Promise<void> = Promise.resolve();

  function persist(): Promise<void> {
    const snapshot = Object.fromEntries(users);
    writeChain = writeChain
      .catch(() => {})
      .then(() => writeJson(filePath, { version: VERSION, users: snapshot }))
      .catch((error: unknown) => {
        onWarning(
          `Could not save favourites: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return writeChain;
  }

  return {
    list(userId) {
      return [...(users.get(userId) ?? [])];
    },
    async add(userId, movie) {
      const current = (users.get(userId) ?? []).filter((entry) => entry.tmdbId !== movie.tmdbId);
      const next = [{ ...movie, addedAt: now().toISOString() }, ...current].slice(0, MAX_FAVORITES);
      users.set(userId, next);
      await persist();
      return [...next];
    },
    async remove(userId, tmdbId) {
      const next = (users.get(userId) ?? []).filter((entry) => entry.tmdbId !== tmdbId);
      users.set(userId, next);
      await persist();
      return [...next];
    },
  };
}

function load(filePath: string, onWarning: (message: string) => void): Map<string, FavoriteMovie[]> {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      version?: number;
      users?: Record<string, FavoriteMovie[]>;
    };
    if (parsed.version !== VERSION || !parsed.users || typeof parsed.users !== "object") {
      return new Map();
    }
    return new Map(
      Object.entries(parsed.users).map(([user, movies]) => [
        user,
        Array.isArray(movies) ? movies.filter(isFavorite) : [],
      ]),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      onWarning(`Could not read favourites: ${error instanceof Error ? error.message : String(error)}`);
    }
    return new Map();
  }
}

function isFavorite(value: unknown): value is FavoriteMovie {
  const entry = value as FavoriteMovie;
  return (
    typeof entry === "object" &&
    entry !== null &&
    Number.isSafeInteger(entry.tmdbId) &&
    entry.tmdbId > 0 &&
    typeof entry.title === "string" &&
    Array.isArray(entry.genres)
  );
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}
