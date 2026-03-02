# MVP Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical bugs (retry data loss, hardcoded branch, path traversal), then refactor the monolith into clean modules with storage abstraction.

**Architecture:** Bottom-up approach — fix bugs in existing code first (Tasks 1-3, parallelizable), then extract storage layer and split monolith (Tasks 4-5, sequential), then add concurrency tests and update docs (Tasks 6-7).

**Tech Stack:** Node.js 20+, ES modules, Vitest, Zod, Octokit v22

---

## Task 1: Fix retry data loss in `atomicCommitWithRetry`

**Files:**
- Modify: `servers/lib/atomic-commit.js` (entire file, 127 lines)
- Modify: `servers/github-memory-server.js:649-655` (write_entry), `servers/github-memory-server.js:805-808` (update_entry)
- Modify: `servers/test/atomic-commit.test.js` (update + add tests)

**Step 1: Write the failing test for buildFiles callback**

Add to `servers/test/atomic-commit.test.js` inside the `atomicCommitWithRetry` describe block:

```js
it("calls buildFiles on each retry to get fresh content", async () => {
  const error422 = new Error("Reference update failed");
  error422.status = 422;

  let callCount = 0;
  const client = makeMockClient({
    updateRef: vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw error422;
      // second call succeeds
    }),
  });

  let buildFilesCallCount = 0;
  const buildFiles = vi.fn().mockImplementation(async () => {
    buildFilesCallCount++;
    return [
      { path: "project/entry.md", content: `version-${buildFilesCallCount}` },
      { path: "project/root.md", content: `root-version-${buildFilesCallCount}` },
    ];
  });

  const promise = atomicCommitWithRetry(client, {
    buildFiles,
    message: "retry with fresh files",
  });

  await vi.advanceTimersByTimeAsync(1000);
  const result = await promise;

  expect(result).toEqual({ commitSHA: "commitsha555", success: true });
  // buildFiles called twice: once for initial attempt, once for retry
  expect(buildFiles).toHaveBeenCalledTimes(2);
  // Second call should have version-2 content
  expect(client.createBlob).toHaveBeenCalledWith("version-2");
});

it("still accepts static files array for backward compatibility", async () => {
  const client = makeMockClient();
  const files = [{ path: "project/entry.md", content: "static content" }];

  const result = await atomicCommitWithRetry(client, {
    files,
    message: "static files",
  });

  expect(result).toEqual({ commitSHA: "commitsha555", success: true });
  expect(client.createBlob).toHaveBeenCalledWith("static content");
});
```

**Step 2: Run test to verify it fails**

Run: `cd servers && npx vitest run test/atomic-commit.test.js`
Expected: FAIL — `buildFiles` not recognized, tests fail

**Step 3: Implement the fix in `atomic-commit.js`**

Replace lines 82-126 of `servers/lib/atomic-commit.js`:

```js
/**
 * Performs an atomic commit with automatic retry on SHA conflicts.
 *
 * On ConflictError: retries with fresh HEAD SHA and fresh files (via buildFiles).
 * Backoff: 1s, 3s, 9s (exponential x 3).
 * After all retries exhausted: returns { success: false, error: 'conflict' }.
 * On non-ConflictError: rethrows immediately.
 *
 * @param {object} client - GitHub client (from createGitHubClient)
 * @param {object} params
 * @param {Function} [params.buildFiles] - async () => files array, called on each attempt
 * @param {Array} [params.files] - static files (backward compat, ignored if buildFiles set)
 * @param {string} params.message - commit message
 * @param {number} [params.maxRetries=3] - maximum number of retries
 * @returns {Promise<{commitSHA: string, success: true} | {success: false, error: 'conflict'}>}
 */
export async function atomicCommitWithRetry(
  client,
  { buildFiles, files, message, maxRetries = 3 }
) {
  const resolveFiles = buildFiles || (async () => files);
  const backoffs = [1000, 3000, 9000];

  // First attempt
  try {
    const currentFiles = await resolveFiles();
    return await atomicCommit(client, { files: currentFiles, message });
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    // Fall through to retry loop
  }

  // Retry loop
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const delay = backoffs[attempt] ?? backoffs[backoffs.length - 1];
    await sleep(delay);

    try {
      const currentFiles = await resolveFiles();
      return await atomicCommit(client, { files: currentFiles, message });
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      // Continue to next retry
    }
  }

  return { success: false, error: "conflict" };
}
```

**Step 4: Run tests to verify all pass (existing + new)**

Run: `cd servers && npx vitest run test/atomic-commit.test.js`
Expected: ALL PASS (existing tests work via backward-compatible `files` param)

**Step 5: Update `write_entry` to use `buildFiles` callback**

In `servers/github-memory-server.js`, replace lines 648-655:

```js
      // 6. Atomic commit with buildFiles for fresh root.md on retry
      const commitResult = await atomicCommitWithRetry(client, {
        buildFiles: async () => {
          const freshRoot = await client.getFileContent(`${project}/root.md`);
          const { updated_markdown: freshMarkdown } = addEntryToRoot(
            freshRoot.content,
            { file: fileName, name: title, description, tags }
          );
          return [
            { path: `${project}/${fileName}`, content: entryContent },
            { path: `${project}/root.md`, content: freshMarkdown },
          ];
        },
        message: `[shared-memory] create-entry: ${title}`,
      });
```

**Step 6: Update `update_entry` to use `buildFiles` callback**

In `servers/github-memory-server.js`, replace lines 804-808:

```js
      // 5. Atomic commit with buildFiles for fresh root.md on retry
      const commitResult = await atomicCommitWithRetry(client, {
        buildFiles: async () => {
          const currentFiles = [
            { path: `${project}/${file}`, content: updatedContent },
          ];
          if (new_tags || new_description) {
            const freshRoot = await client.getFileContent(`${project}/root.md`);
            if (freshRoot) {
              const changes = {};
              if (new_tags) changes.tags = new_tags;
              if (new_description) changes.description = new_description;
              const updatedRoot = updateEntryInRoot(
                freshRoot.content,
                file,
                changes
              );
              currentFiles.push({
                path: `${project}/root.md`,
                content: updatedRoot,
              });
            }
          }
          return currentFiles;
        },
        message: `[shared-memory] update-entry: ${currentMeta.title}`,
      });
```

**Step 7: Run full test suite**

Run: `cd servers && npx vitest run`
Expected: ALL PASS

**Step 8: Commit**

Message: `fix: re-read root.md on retry to prevent data loss`

Body: `atomicCommitWithRetry now accepts buildFiles callback that is called on each attempt, ensuring fresh root.md content on SHA conflict retry. Static files array still supported for backward compatibility.`

---

## Task 2: Fix hardcoded `heads/main`

**Files:**
- Modify: `servers/lib/github-client.js:43,110-118,175-184`
- Modify: `servers/github-memory-server.js:35`
- Modify: `servers/test/github-client.test.js`

**Step 1: Write the failing test**

Add to `servers/test/github-client.test.js`:

```js
describe("custom branch", () => {
  it("uses provided branch for getHeadSHA", async () => {
    const octokit = makeMockOctokit();
    const client = createGitHubClient({
      octokit,
      repo: "owner/repo",
      branch: "master",
    });
    await client.getHeadSHA();
    expect(octokit.rest.git.getRef).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      ref: "heads/master",
    });
  });

  it("uses provided branch for updateRef", async () => {
    const octokit = makeMockOctokit();
    const client = createGitHubClient({
      octokit,
      repo: "owner/repo",
      branch: "develop",
    });
    await client.updateRef("newsha");
    expect(octokit.rest.git.updateRef).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      ref: "heads/develop",
      sha: "newsha",
      force: false,
    });
  });

  it("defaults to main when branch not specified", async () => {
    const octokit = makeMockOctokit();
    const client = createGitHubClient({ octokit, repo: "owner/repo" });
    await client.getHeadSHA();
    expect(octokit.rest.git.getRef).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      ref: "heads/main",
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd servers && npx vitest run test/github-client.test.js`
Expected: FAIL — `branch` parameter not recognized

**Step 3: Update `createGitHubClient` signature**

In `servers/lib/github-client.js`, change line 43 from:

```js
export function createGitHubClient({ octokit, repo }) {
```

To:

```js
export function createGitHubClient({ octokit, repo, branch = "main" }) {
```

**Step 4: Replace hardcoded refs**

In `servers/lib/github-client.js`:

Line 115 — change `ref: "heads/main"` to:

```js
          ref: `heads/${branch}`,
```

Line 180 — change `ref: "heads/main"` to:

```js
          ref: `heads/${branch}`,
```

**Step 5: Run test to verify it passes**

Run: `cd servers && npx vitest run test/github-client.test.js`
Expected: ALL PASS

**Step 6: Auto-detect default branch in server initialization**

In `servers/github-memory-server.js`, update the initialization block. Change lines 34-36 from:

```js
const octokit = createOctokit(token);
const client = createGitHubClient({ octokit, repo: repoString });
const [repoOwner, repoName] = (repoString || "").split("/");
```

To:

```js
const octokit = createOctokit(token);
const [repoOwner, repoName] = (repoString || "").split("/");

// Start with default branch; connect_repo will re-create with actual default_branch
let client = createGitHubClient({ octokit, repo: repoString });
```

Then in the `connect_repo` handler, add branch detection after getting user info (after line 337):

```js
      // 1.5 Detect default branch and re-create client
      try {
        const { data: repoData } = await octokit.rest.repos.get({
          owner: repoOwner,
          repo: repoName,
        });
        if (repoData.default_branch !== "main") {
          client = createGitHubClient({
            octokit,
            repo: repoString,
            branch: repoData.default_branch,
          });
        }
      } catch {
        // Fallback: keep using 'main' (e.g., empty repo returns 404)
      }
```

**Step 7: Run full test suite**

Run: `cd servers && npx vitest run`
Expected: ALL PASS

**Step 8: Commit**

Message: `fix: auto-detect default branch instead of hardcoding main`

Body: `createGitHubClient now accepts branch parameter (default: 'main'). connect_repo detects the repo's default_branch via GitHub API.`

---

## Task 3: Add path traversal validation

**Files:**
- Create: `servers/lib/validators.js`
- Create: `servers/test/validators.test.js`
- Modify: `servers/github-memory-server.js` (8 tools with `project` param)

**Step 1: Write the failing tests**

Create `servers/test/validators.test.js`:

```js
import { describe, it, expect } from "vitest";
import { validateProjectName, validateFileName } from "../lib/validators.js";

describe("validateProjectName", () => {
  it("accepts valid project names", () => {
    expect(() => validateProjectName("mobile-app")).not.toThrow();
    expect(() => validateProjectName("backend-api")).not.toThrow();
    expect(() => validateProjectName("_shared")).not.toThrow();
  });

  it("rejects path traversal attempts", () => {
    expect(() => validateProjectName("../etc")).toThrow("Invalid project name");
    expect(() => validateProjectName("../../secrets")).toThrow("Invalid project name");
    expect(() => validateProjectName("foo/../bar")).toThrow("Invalid project name");
  });

  it("rejects names with slashes", () => {
    expect(() => validateProjectName("foo/bar")).toThrow("Invalid project name");
    expect(() => validateProjectName("a/b/c")).toThrow("Invalid project name");
  });

  it("rejects names starting with dot", () => {
    expect(() => validateProjectName(".hidden")).toThrow("Invalid project name");
    expect(() => validateProjectName(".git")).toThrow("Invalid project name");
  });

  it("rejects empty strings", () => {
    expect(() => validateProjectName("")).toThrow("Invalid project name");
  });
});

describe("validateFileName", () => {
  it("accepts valid filenames", () => {
    expect(() => validateFileName("auth-architecture.md")).not.toThrow();
    expect(() => validateFileName("rive-vs-lottie.md")).not.toThrow();
  });

  it("rejects path traversal", () => {
    expect(() => validateFileName("../secret.md")).toThrow("Invalid file name");
    expect(() => validateFileName("foo/../../etc")).toThrow("Invalid file name");
  });

  it("rejects names with slashes", () => {
    expect(() => validateFileName("sub/file.md")).toThrow("Invalid file name");
  });

  it("rejects empty strings", () => {
    expect(() => validateFileName("")).toThrow("Invalid file name");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd servers && npx vitest run test/validators.test.js`
Expected: FAIL — module not found

**Step 3: Implement validators**

Create `servers/lib/validators.js`:

```js
/**
 * Input validation utilities for path safety.
 *
 * @module validators
 */

/**
 * Validates a project name is safe (no path traversal, no slashes).
 * Allows underscore-prefixed system folders like "_shared".
 *
 * @param {string} name - Project folder name
 * @throws {Error} if name is invalid
 */
export function validateProjectName(name) {
  if (
    !name ||
    name.includes("..") ||
    name.includes("/") ||
    name.startsWith(".")
  ) {
    throw new Error(
      `Invalid project name: "${name}". Must not contain "..", "/", or start with "."`
    );
  }
}

/**
 * Validates an entry filename is safe (no path traversal, no slashes).
 *
 * @param {string} name - Entry filename
 * @throws {Error} if name is invalid
 */
export function validateFileName(name) {
  if (
    !name ||
    name.includes("..") ||
    name.includes("/")
  ) {
    throw new Error(
      `Invalid file name: "${name}". Must not contain ".." or "/".`
    );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd servers && npx vitest run test/validators.test.js`
Expected: ALL PASS

**Step 5: Add validation to server tool handlers**

In `servers/github-memory-server.js`, add import after line 23:

```js
import { validateProjectName, validateFileName } from "./lib/validators.js";
```

Then add validation as first line inside `withErrorHandling` for each tool:

- `read_root` (line 453): add `validateProjectName(project);`
- `read_entry` (line 506): add `validateProjectName(project); validateFileName(file);`
- `write_entry` (line 570): add `validateProjectName(project);`
- `update_entry` (line 709): add `validateProjectName(project); validateFileName(file);`
- `search_author` (line 969, project is optional): add `if (project) validateProjectName(project);`
- `switch_project` (line 1173, after slugify): add `validateProjectName(projectSlug);`
- `check_duplicate` (line 1289): add `validateProjectName(project);`

**Step 6: Run full test suite**

Run: `cd servers && npx vitest run`
Expected: ALL PASS

**Step 7: Commit**

Message: `fix: add path traversal validation on project and file params`

Body: `New validators.js module rejects '..', '/' and dot-prefixed names. Applied to all tools that accept project/file parameters.`

---

## Task 4: Extract `MemoryStore` abstraction

**Files:**
- Create: `servers/lib/memory-store.js`
- Create: `servers/test/memory-store.test.js`
- Modify: `servers/github-memory-server.js` (refactor all 12 handlers)

**Step 1: Write failing tests for MemoryStore**

Create `servers/test/memory-store.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { createMemoryStore } from "../lib/memory-store.js";

function makeMockClient(overrides = {}) {
  return {
    getFileContent: vi.fn().mockResolvedValue({
      content: `# Test Project\n\nDescription.\n\n| Entry | Description | Tags |\n|---|---|---|\n| [Auth](auth.md) | Auth architecture | auth, security |\n`,
      sha: "abc123",
    }),
    getDirectoryListing: vi.fn().mockResolvedValue(["root.md", "auth.md"]),
    getRootDirectoryListing: vi.fn().mockResolvedValue([
      { name: "_shared", type: "dir" },
      { name: "mobile-app", type: "dir" },
      { name: "_meta.md", type: "file" },
    ]),
    searchCode: vi.fn().mockResolvedValue([]),
    getUserInfo: vi.fn().mockResolvedValue({ name: "Test", login: "test" }),
    getHeadSHA: vi.fn().mockResolvedValue("headsha"),
    getTreeSHA: vi.fn().mockResolvedValue("treesha"),
    createBlob: vi.fn().mockResolvedValue("blobsha"),
    createTree: vi.fn().mockResolvedValue("newtreesha"),
    createCommit: vi.fn().mockResolvedValue("commitsha"),
    updateRef: vi.fn().mockResolvedValue(undefined),
    getLastCommitForFile: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("createMemoryStore", () => {
  it("returns an object with expected methods", () => {
    const client = makeMockClient();
    const store = createMemoryStore(client);
    expect(typeof store.readIndex).toBe("function");
    expect(typeof store.readEntry).toBe("function");
    expect(typeof store.listProjects).toBe("function");
  });
});

describe("readIndex", () => {
  it("reads and parses root.md for a project", async () => {
    const client = makeMockClient();
    const store = createMemoryStore(client);
    const result = await store.readIndex("mobile-app");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].file).toBe("auth.md");
    expect(client.getFileContent).toHaveBeenCalledWith("mobile-app/root.md");
  });

  it("returns null if root.md not found", async () => {
    const client = makeMockClient({
      getFileContent: vi.fn().mockResolvedValue(null),
    });
    const store = createMemoryStore(client);
    const result = await store.readIndex("nonexistent");
    expect(result).toBeNull();
  });
});

describe("listProjects", () => {
  it("returns project dirs excluding _shared and dot-prefixed", async () => {
    const client = makeMockClient();
    const store = createMemoryStore(client);
    const projects = await store.listProjects();
    expect(projects).toEqual(["mobile-app"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd servers && npx vitest run test/memory-store.test.js`
Expected: FAIL — module not found

**Step 3: Implement `createMemoryStore`**

Create `servers/lib/memory-store.js`:

```js
/**
 * Storage abstraction layer for shared memory operations.
 *
 * Wraps GitHub client + root-parser into a clean interface.
 * All GitHub-specific read/write logic lives here.
 *
 * @module memory-store
 */

import { parseRootMd, addEntryToRoot, updateEntryInRoot } from "./root-parser.js";
import { atomicCommitWithRetry } from "./atomic-commit.js";

/**
 * Creates a memory store backed by a GitHub repository.
 *
 * @param {object} client - GitHub client (from createGitHubClient)
 * @returns {object} store with read/write/search methods
 */
export function createMemoryStore(client) {
  return {
    async readIndex(project) {
      const file = await client.getFileContent(`${project}/root.md`);
      if (!file) return null;
      const parsed = parseRootMd(file.content);
      return {
        description: parsed.description,
        entries: parsed.entries,
        corrupted: parsed.corrupted || false,
        raw: file.content,
      };
    },

    async readEntry(project, fileName) {
      return client.getFileContent(`${project}/${fileName}`);
    },

    async listFiles(project) {
      return client.getDirectoryListing(project);
    },

    async writeEntry(project, fileName, entryContent, rootEntry) {
      return atomicCommitWithRetry(client, {
        buildFiles: async () => {
          const freshRoot = await client.getFileContent(`${project}/root.md`);
          const { updated_markdown } = addEntryToRoot(freshRoot.content, rootEntry);
          return [
            { path: `${project}/${fileName}`, content: entryContent },
            { path: `${project}/root.md`, content: updated_markdown },
          ];
        },
        message: `[shared-memory] create-entry: ${rootEntry.name}`,
      });
    },

    async updateEntry(project, fileName, updatedContent, rootChanges, commitTitle) {
      return atomicCommitWithRetry(client, {
        buildFiles: async () => {
          const result = [
            { path: `${project}/${fileName}`, content: updatedContent },
          ];
          if (rootChanges && (rootChanges.tags || rootChanges.description)) {
            const freshRoot = await client.getFileContent(`${project}/root.md`);
            if (freshRoot) {
              const changes = {};
              if (rootChanges.tags) changes.tags = rootChanges.tags;
              if (rootChanges.description) changes.description = rootChanges.description;
              const updatedRoot = updateEntryInRoot(freshRoot.content, fileName, changes);
              result.push({ path: `${project}/root.md`, content: updatedRoot });
            }
          }
          return result;
        },
        message: `[shared-memory] update-entry: ${commitTitle}`,
      });
    },

    async getRelatedEntries(project, tags, excludeFile, findRelatedFn) {
      const rootFile = await client.getFileContent(`${project}/root.md`);
      if (!rootFile) return [];
      const projectParsed = parseRootMd(rootFile.content);
      let allEntries = projectParsed.entries.map((e) => ({
        ...e, file: e.file, project,
      }));
      if (project !== "_shared") {
        const sharedRoot = await client.getFileContent("_shared/root.md");
        if (sharedRoot) {
          const sharedParsed = parseRootMd(sharedRoot.content);
          const sharedEntries = sharedParsed.entries.map((e) => ({
            ...e, file: `../_shared/${e.file}`, project: "_shared",
          }));
          allEntries = allEntries.concat(sharedEntries);
        }
      }
      return findRelatedFn(allEntries, tags, excludeFile);
    },

    async listProjects() {
      const rootItems = await client.getRootDirectoryListing();
      return rootItems
        .filter((item) => item.type === "dir" && item.name !== "_shared" && !item.name.startsWith("."))
        .map((item) => item.name);
    },

    async listAllDirs() {
      const rootItems = await client.getRootDirectoryListing();
      const dirs = rootItems
        .filter((item) => item.type === "dir" && !item.name.startsWith("."))
        .map((item) => item.name);
      if (!dirs.includes("_shared")) dirs.push("_shared");
      return dirs;
    },

    async searchDeep(query) {
      return client.searchCode(query);
    },

    async getLastCommit(path) {
      return client.getLastCommitForFile(path);
    },

    async getRootListing() {
      return client.getRootDirectoryListing();
    },

    get client() { return client; },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd servers && npx vitest run test/memory-store.test.js`
Expected: ALL PASS

**Step 5: Refactor `github-memory-server.js` to use store**

Add import and create store instance:

```js
import { createMemoryStore } from "./lib/memory-store.js";
```

After `client` creation:

```js
let store = createMemoryStore(client);
```

In `connect_repo`, after re-creating client with detected branch, also re-create store:

```js
store = createMemoryStore(client);
```

Then refactor each tool handler to use `store` methods. Do tool by tool, running tests after each:

1. `read_root` — replace `client.getFileContent` + `parseRootMd` with `store.readIndex(project)`, keep corruption fallback using `store.listFiles(project)`
2. `read_entry` — replace `client.getFileContent` with `store.readEntry(project, file)`
3. `write_entry` — replace inline atomic commit with `store.writeEntry(...)`, replace related-entries gathering with `store.getRelatedEntries(..., findRelated)`
4. `update_entry` — replace inline atomic commit with `store.updateEntry(...)`, replace related-entries gathering with `store.getRelatedEntries(..., findRelated)`
5. `search_tags` — replace project listing with `store.listAllDirs()`, use `store.readIndex(...)` per project
6. `search_author` — use `store.readEntry(...)` for file reads, `store.readIndex(...)` for root
7. `search_deep` — replace `client.searchCode(...)` with `store.searchDeep(...)`
8. `list_projects` — replace with `store.listProjects()` + `store.readIndex(...)`
9. `switch_project` — use `store.readIndex(...)` + `store.getLastCommit(...)`
10. `check_duplicate` — use `store.readIndex(...)`
11. `connect_repo` — use `store.getRootListing()`, keep direct octokit for init
12. `get_state` — no GitHub calls, unchanged

**Step 6: Run full test suite after each tool refactored**

Run: `cd servers && npx vitest run`
Expected: ALL PASS after each change

**Step 7: Commit**

Message: `refactor: extract MemoryStore abstraction from tool handlers`

Body: `All GitHub-specific logic now lives in memory-store.js. Tool handlers are thin: validate -> store.method() -> format response. Eliminates duplicated related-entries loading in write/update.`

---

## Task 5: Split monolith — extract helpers

**Files:**
- Create: `servers/lib/helpers.js`
- Modify: `servers/github-memory-server.js` (extract helpers, constants)

**Step 1: Create `servers/lib/helpers.js`**

Extract from `github-memory-server.js`:
- `buildEntryContent` (lines 105-118)
- `parseEntryMetadata` (lines 120-175)
- `findRelated` (lines 177-190)
- `extractKeywords` (lines 314-319)
- `STOPWORDS` (lines 218-312)

```js
/**
 * Shared helper functions for entry content building and metadata parsing.
 *
 * @module helpers
 */

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "of", "in", "to",
  "for", "with", "on", "at", "from", "by", "about", "as", "into",
  "through", "during", "before", "after", "above", "below", "and", "but",
  "or", "nor", "not", "so", "yet", "both", "either", "neither", "each",
  "every", "all", "any", "few", "more", "most", "other", "some", "such",
  "no", "only", "own", "same", "than", "too", "very", "just", "because",
  "if", "when", "how", "what", "which", "who", "whom", "this", "that",
  "these", "those", "it", "its", "we", "our", "they", "their", "he",
  "she", "his", "her",
]);

export function extractKeywords(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function buildEntryContent({ title, date, author, tags, content, related }) {
  let md = `# ${title}\n\n`;
  md += `- **Date:** ${date}\n`;
  md += `- **Author:** ${author}\n`;
  md += `- **Tags:** ${tags.join(", ")}\n\n`;
  md += content;
  if (related && related.length > 0) {
    md += `\n\n## Related\n\n`;
    for (const r of related) {
      md += `- [${r}](${r})\n`;
    }
  }
  return md;
}

export function parseEntryMetadata(content) {
  const lines = content.split("\n");
  const result = { title: "", date: "", author: "", tags: [], content: "", related: [] };

  for (const line of lines) {
    if (line.startsWith("# ")) { result.title = line.slice(2).trim(); break; }
  }

  for (const line of lines) {
    const dateMatch = line.match(/^\s*-\s*\*\*Date:\*\*\s*(.+)/);
    if (dateMatch) result.date = dateMatch[1].trim();
    const authorMatch = line.match(/^\s*-\s*\*\*Author:\*\*\s*(.+)/);
    if (authorMatch) result.author = authorMatch[1].trim();
    const tagsMatch = line.match(/^\s*-\s*\*\*Tags:\*\*\s*(.+)/);
    if (tagsMatch) result.tags = tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean);
  }

  const relatedIdx = content.indexOf("## Related");
  if (relatedIdx !== -1) {
    const relatedSection = content.slice(relatedIdx);
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRe.exec(relatedSection)) !== null) {
      result.related.push(match[2]);
    }
  }

  const tagsIdx = content.indexOf("**Tags:**");
  const contentStart = tagsIdx !== -1 ? content.indexOf("\n\n", tagsIdx) : -1;
  const contentEnd = relatedIdx !== -1 ? relatedIdx : content.length;
  if (contentStart !== -1) {
    result.content = content.slice(contentStart, contentEnd).trim();
  }

  return result;
}

export function findRelated(entries, tags, excludeFile) {
  return entries
    .filter((e) => e.file !== excludeFile)
    .map((e) => {
      const commonTags = e.tags.filter((t) => tags.includes(t));
      return { file: e.file, common_tags: commonTags, match_count: commonTags.length };
    })
    .filter((r) => r.match_count >= 1)
    .sort((a, b) => b.match_count - a.match_count);
}
```

**Step 2: Update imports in `github-memory-server.js`**

Add:

```js
import {
  buildEntryContent,
  parseEntryMetadata,
  findRelated,
  extractKeywords,
} from "./lib/helpers.js";
```

Remove the extracted functions and STOPWORDS constant from the server file.

**Step 3: Run full test suite**

Run: `cd servers && npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

Message: `refactor: extract helpers, metadata parser, and findRelated to lib/helpers.js`

Body: `Server file reduced by ~250 lines. No behavior changes.`

---

## Task 6: Add concurrency tests

**Files:**
- Modify: `servers/test/atomic-commit.test.js`

**Step 1: Add concurrent write scenarios**

Add to `servers/test/atomic-commit.test.js` in a new describe block:

```js
describe("concurrent scenarios", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buildFiles is called with fresh data on each retry", async () => {
    const error422 = new Error("Reference update failed");
    error422.status = 422;

    let updateRefCalls = 0;
    const client = makeMockClient({
      updateRef: vi.fn().mockImplementation(async () => {
        updateRefCalls++;
        if (updateRefCalls <= 2) throw error422;
      }),
    });

    const versions = [];
    const buildFiles = vi.fn().mockImplementation(async () => {
      const version = buildFiles.mock.calls.length;
      versions.push(version);
      return [{ path: "p/root.md", content: `v${version}` }];
    });

    const promise = atomicCommitWithRetry(client, {
      buildFiles,
      message: "concurrent test",
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(buildFiles).toHaveBeenCalledTimes(3);
    expect(versions).toEqual([1, 2, 3]);
  });

  it("returns failure after all retries exhausted with buildFiles", async () => {
    const error422 = new Error("Reference update failed");
    error422.status = 422;

    const client = makeMockClient({
      updateRef: vi.fn().mockRejectedValue(error422),
    });

    const buildFiles = vi.fn().mockResolvedValue([
      { path: "p/entry.md", content: "content" },
    ]);

    const promise = atomicCommitWithRetry(client, {
      buildFiles,
      message: "always fail",
      maxRetries: 3,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(9000);

    const result = await promise;

    expect(result).toEqual({ success: false, error: "conflict" });
    expect(buildFiles).toHaveBeenCalledTimes(4);
  });
});
```

**Step 2: Run tests**

Run: `cd servers && npx vitest run test/atomic-commit.test.js`
Expected: ALL PASS

**Step 3: Commit**

Message: `test: add concurrency tests for buildFiles retry behavior`

Body: `Verifies buildFiles is called fresh on each retry attempt. Verifies graceful failure after retry exhaustion with buildFiles.`

---

## Task 7: Update docs for open-source readiness

**Files:**
- Modify: `README.md`
- Modify: `docs/reports/2026-02-28-multi-agent-challenge.md`

**Step 1: Update README Requirements section**

Add minimum token scope and branch auto-detection note to the Requirements section:

```markdown
## Requirements

- Node.js >= 20
- GitHub Personal Access Token with `repo` scope (or fine-grained token with `Contents: Read and write`)
- A GitHub repository (private recommended)
- Claude desktop app with Cowork mode

**Note:** The plugin auto-detects your repository's default branch (main, master, etc.).
```

**Step 2: Add Resolved Issues section to challenge report**

Append to `docs/reports/2026-02-28-multi-agent-challenge.md`:

```markdown

---

## Resolved Issues (2026-03-02)

Issues addressed from the MVP Hardening pass:

| # | Issue | Resolution | Task |
|---|-------|------------|------|
| 1 | Retry data loss (stale root.md) | buildFiles callback re-reads on each attempt | Task 1 |
| 2 | Hardcoded heads/main | Auto-detect via repos.get, configurable branch param | Task 2 |
| 3 | Path traversal on project param | validators.js with checks on all tools | Task 3 |
| 4 | No storage abstraction | memory-store.js wraps all GitHub calls | Task 4 |
| 5 | Monolithic server (1361 lines) | Extracted helpers.js, reduced server size | Task 5 |
| 6 | Duplicated related-entries logic | Consolidated in store.getRelatedEntries() | Task 4 |
| 7 | No concurrency tests | Added buildFiles retry tests | Task 6 |

**Still deferred:**
- Semantic search
- Access control
- Author search scaling
- root.md format migration (JSON)
```

**Step 3: Commit**

Message: `docs: update README and challenge report with resolved issues`

Body: `Add minimum token scope, auto-branch detection note. Document all 7 resolved issues from MVP hardening.`

---

## Execution Order Summary

```
Phase 1 (parallel):
  Task 1: Fix retry data loss
  Task 2: Fix hardcoded main
  Task 3: Path traversal
                |
Phase 2 (sequential):
  Task 4: Extract MemoryStore --> Task 5: Split monolith
                |
Phase 3 (parallel):
  Task 6: Concurrency tests
  Task 7: Update docs
```

Total: 7 tasks, ~35 steps, 7 commits.
