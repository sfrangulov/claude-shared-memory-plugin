import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

const STATE_FILENAME = ".shared-memory-state";
const TEMP_SUFFIX = ".tmp";

/**
 * Default state returned when no state file exists or file is corrupted.
 * @returns {{ active_project: null, version: 1 }}
 */
function defaultState() {
  return { active_project: null, version: 1 };
}

/**
 * Creates a session state manager for the given working directory.
 *
 * Manages the `.shared-memory-state` JSON file with atomic writes
 * (write to temp file, then rename). Author cache is in-memory,
 * per-project, session-only.
 *
 * @param {string} workdir - Absolute path to the working directory
 * @returns {{
 *   readState: () => Promise<{ active_project: string | null, version: number }>,
 *   writeState: (state: object) => Promise<void>,
 *   getAuthorCache: (project: string) => object | null,
 *   setAuthorCache: (project: string, cache: object) => void,
 *   invalidateAuthorCache: (project?: string) => void
 * }}
 */
export function createStateManager(workdir) {
  const statePath = join(workdir, STATE_FILENAME);
  const tempPath = join(workdir, STATE_FILENAME + TEMP_SUFFIX);

  /** @type {Map<string, object>} In-memory author cache, keyed by project */
  const authorCacheMap = new Map();

  /**
   * Reads the session state from the state file.
   *
   * - File missing -> returns defaults
   * - File corrupted (invalid JSON) -> logs warning, deletes, recreates with defaults
   * - Version field missing or non-numeric -> treats as version 1, rewrites
   *
   * @returns {Promise<{ active_project: string | null, version: number }>}
   */
  async function readState() {
    let raw;
    try {
      raw = await readFile(statePath, "utf-8");
    } catch (err) {
      if (err.code === "ENOENT") {
        return defaultState();
      }
      throw err;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupted JSON — log warning, delete and recreate with defaults
      console.warn(
        `[state-manager] Corrupted state file at ${statePath}, resetting to defaults`
      );
      const defaults = defaultState();
      await atomicWrite(defaults);
      return defaults;
    }

    // Validate version field
    let needsRewrite = false;
    if (typeof parsed.version !== "number") {
      parsed.version = 1;
      needsRewrite = true;
    }

    if (needsRewrite) {
      await atomicWrite(parsed);
    }

    return {
      active_project: parsed.active_project ?? null,
      version: parsed.version,
    };
  }

  /**
   * Writes state to the state file atomically.
   * Writes to a temp file first, then renames to the final path.
   *
   * @param {object} state - The state object to write
   * @returns {Promise<void>}
   */
  async function writeState(state) {
    await atomicWrite(state);
  }

  /**
   * Internal: atomic write via temp file + rename.
   *
   * @param {object} data - JSON-serializable data
   * @returns {Promise<void>}
   */
  async function atomicWrite(data) {
    const json = JSON.stringify(data, null, 2);
    await writeFile(tempPath, json, "utf-8");
    await rename(tempPath, statePath);
  }

  /**
   * Returns the author cache for a given project, or null if not cached.
   *
   * @param {string} project - Project identifier
   * @returns {object | null}
   */
  function getAuthorCache(project) {
    return authorCacheMap.get(project) ?? null;
  }

  /**
   * Stores the author cache for a given project (in-memory only).
   *
   * @param {string} project - Project identifier
   * @param {object} cache - Map-like object of filename -> author
   */
  function setAuthorCache(project, cache) {
    authorCacheMap.set(project, cache);
  }

  /**
   * Invalidates author cache.
   * If project is specified, clears only that project's cache.
   * If not specified, clears the entire cache.
   *
   * @param {string} [project] - Optional project identifier
   */
  function invalidateAuthorCache(project) {
    if (project !== undefined) {
      authorCacheMap.delete(project);
    } else {
      authorCacheMap.clear();
    }
  }

  return {
    readState,
    writeState,
    getAuthorCache,
    setAuthorCache,
    invalidateAuthorCache,
  };
}
