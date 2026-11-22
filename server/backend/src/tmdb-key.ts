import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const FILENAME = "tmdb.json";
const VERSION = 1;

/**
 * The optional TMDB key an administrator adds in Settings. It is the one
 * credential churn keeps itself: nothing else on the box holds one, and it only
 * unlocks extras (full filmographies), never something churn needs to work.
 * Stored 0600 in the state directory and never sent to the browser.
 */
export interface TmdbKeyRecord {
  apiKey: string;
  addedAt: string;
  addedBy: string;
}

export interface TmdbKeyStore {
  get(): TmdbKeyRecord | null;
  set(apiKey: string, addedBy: string): Promise<void>;
  clear(): Promise<void>;
}

export function createTmdbKeyStore(options: {
  stateDir: string;
  now?: () => Date;
  onWarning?: (message: string) => void;
}): TmdbKeyStore {
  const filePath = path.join(options.stateDir, FILENAME);
  const now = options.now ?? (() => new Date());
  let record = load(filePath, options.onWarning ?? (() => {}));

  return {
    get() {
      return record ? { ...record } : null;
    },
    async set(apiKey, addedBy) {
      const next: TmdbKeyRecord = { apiKey, addedAt: now().toISOString(), addedBy };
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: VERSION, ...next }), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, filePath);
      record = next;
    },
    async clear() {
      await rm(filePath, { force: true });
      record = null;
    },
  };
}

function load(filePath: string, onWarning: (message: string) => void): TmdbKeyRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<TmdbKeyRecord> & {
      version?: number;
    };
    if (parsed.version !== VERSION || typeof parsed.apiKey !== "string" || !parsed.apiKey) {
      return null;
    }
    return {
      apiKey: parsed.apiKey,
      addedAt: typeof parsed.addedAt === "string" ? parsed.addedAt : "",
      addedBy: typeof parsed.addedBy === "string" ? parsed.addedBy : "",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      onWarning(`Could not read the TMDB key: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}
