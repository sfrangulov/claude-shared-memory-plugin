# MVP Hardening Design

**Date:** 2026-03-02
**Origin:** Multi-agent challenge report (`docs/reports/2026-02-28-multi-agent-challenge.md`)
**Goal:** Fix critical bugs, reduce technical debt, prepare for open-source release
**Approach:** Bottom-up — bugs first, then refactoring, then tests and docs

---

## Phase 1: Critical Bugs

### 1.1 Fix retry data loss in `atomicCommitWithRetry`

**Problem:** `write_entry` and `update_entry` prepare `files[]` with already-updated root.md BEFORE calling retry. On SHA conflict, retry commits stale root.md content, overwriting concurrent entries from other users. This is data loss.

**Location:** `atomic-commit.js` lines 97-126, called from `github-memory-server.js` lines 649-655

**Solution:** Change `atomicCommitWithRetry` signature — accept `buildFiles` callback instead of static `files` array. The callback re-reads root.md and rebuilds the file list on each retry attempt.

```js
// Before:
atomicCommitWithRetry(client, { files, message, maxRetries })

// After:
atomicCommitWithRetry(client, { buildFiles, message, maxRetries })
// buildFiles: async () => [{ path, content }, ...]
```

**Files to modify:**
- `servers/lib/atomic-commit.js` — change retry loop to call `buildFiles()` on each attempt
- `servers/github-memory-server.js` — wrap file preparation logic in callbacks for write_entry, update_entry, connect_repo, delete_entry
- `servers/test/atomic-commit.test.js` — update existing tests + add concurrent write test

**Risk:** Medium — changes contract of key function, but all callers are in one file.

---

### 1.2 Fix hardcoded `heads/main`

**Problem:** `getHeadSHA()` and `updateRef()` hardcode `"heads/main"`. Repos with `master` or other default branches don't work.

**Location:** `github-client.js` lines 115 and 180

**Solution:** Add `branch` parameter to `createGitHubClient`. Detect default branch during `connect_repo` via `repos.get` API call (`response.data.default_branch`).

```js
const createGitHubClient = ({ octokit, repo, branch = 'main' }) => ({
  getHeadSHA: () => octokit.rest.git.getRef({ ...repo, ref: `heads/${branch}` }),
  updateRef: (sha) => octokit.rest.git.updateRef({ ...repo, ref: `heads/${branch}`, sha }),
})
```

**Files to modify:**
- `servers/lib/github-client.js` — parameterize branch
- `servers/github-memory-server.js` — detect default branch in `connect_repo`
- `servers/test/github-client.test.js` — tests for non-main branches

**Risk:** Low — isolated change.

---

### 1.3 Add path traversal validation

**Problem:** `project` parameter not validated for `../`, `../../`. GitHub API returns 404 but the attempt is made — security concern.

**Solution:** Add validation utility and apply to all tools accepting `project` (8 tools) and `file` parameters.

```js
function validateProjectName(name) {
  if (name.includes('..') || name.includes('/') || name.startsWith('.') || name.startsWith('_')) {
    throw new Error('Invalid project name');
  }
}
```

Apply via Zod `.refine()` in tool schemas or as guard at handler entry.

**Files to modify:**
- `servers/github-memory-server.js` — add validation to all tools with `project`/`file` params
- Tests — add negative test cases for path traversal attempts

**Risk:** Low.

---

## Phase 2: Refactoring

### 2.1 Extract storage abstraction (`MemoryStore`)

**Problem:** GitHub API calls scattered across all 12 handlers. No unified interface — impossible to swap backends.

**Solution:** Create `servers/lib/memory-store.js` with clean interface:

```js
export function createMemoryStore(client) {
  return {
    // Index operations
    readIndex(project),
    addToIndex(project, entry),
    updateInIndex(project, file, changes),
    removeFromIndex(project, file),

    // Entry operations
    readEntry(project, file),
    writeEntry(project, file, content, rootUpdate),  // atomic: file + root.md
    deleteEntry(project, file),                       // atomic: remove + update root.md

    // Search
    searchByTags(projects, keywords),
    searchByAuthor(project, authorQuery),
    searchDeep(query),

    // Projects
    listProjects(),
    getRelatedEntries(project, tags, excludeFile),
  }
}
```

Each MCP handler becomes thin: validation → store.method() → format response.

This also resolves the duplicated related-entries loading logic (currently copy-pasted in write_entry and update_entry).

**Files:**
- New: `servers/lib/memory-store.js`
- Modify: `servers/github-memory-server.js` — refactor all 12 handlers
- New: `servers/test/memory-store.test.js`

**Risk:** High — touches entire server. Must be done tool-by-tool with test runs after each.

---

### 2.2 Split monolith into modules

**Problem:** 1361 lines in one file. Hard to navigate, review, test.

**Solution:** After storage extraction, the server becomes thin handler registrations. Target structure:

```
servers/
├── github-memory-server.js    # MCP server setup + tool registration (~300 lines)
├── lib/
│   ├── memory-store.js        # Storage abstraction (new)
│   ├── github-client.js       # GitHub API (existing)
│   ├── atomic-commit.js       # Atomic commits (existing)
│   ├── root-parser.js         # Index parser (existing)
│   ├── state-manager.js       # Session state (existing)
│   ├── slugify.js             # Slug generation (existing)
│   ├── validators.js          # Path traversal, input validation (new, from 1.3)
│   └── helpers.js             # buildEntryContent, parseEntryMetadata, findRelated (extracted)
```

**Dependency:** After 2.1.

**Risk:** Medium — mechanical refactoring with careful control.

---

## Phase 3: Tests and Open-Source Readiness

### 3.1 Concurrency tests

**New test cases to add:**

1. Two simultaneous `write_entry` to same project — both read root.md, both modify, one gets ConflictError → retry with `buildFiles()` re-reads → both entries preserved
2. `write_entry` + `update_entry` simultaneously — update must not lose new entry from write
3. Retry exhaustion — 4+ concurrent writes, all 3 retries fail → graceful error returned
4. Path traversal rejection — `project: "../../etc"` → validation error

**Files:**
- `servers/test/atomic-commit.test.js` — concurrency retry tests
- `servers/test/memory-store.test.js` — integration tests for store
- `servers/test/integration.test.js` — e2e concurrent scenarios

---

### 3.2 Documentation update

**Update existing files:**
- `README.md` — add Contributing section, document minimum token scope (`repo` or fine-grained `contents: write`), note branch auto-detection
- `CHANGELOG.md` — describe all fixes from phases 1-2
- `docs/reports/2026-02-28-multi-agent-challenge.md` — add "Resolved Issues" section

---

## Task Summary

| # | Task | Phase | Risk | Dependencies | Parallelizable |
|---|------|-------|------|--------------|----------------|
| 1 | Fix retry data loss (buildFiles callback) | 1 | Medium | — | Yes (with 2, 3) |
| 2 | Fix hardcoded `heads/main` | 1 | Low | — | Yes (with 1, 3) |
| 3 | Add path traversal validation | 1 | Low | — | Yes (with 1, 2) |
| 4 | Extract `MemoryStore` abstraction | 2 | High | 1, 2, 3 | No |
| 5 | Split monolith into modules | 2 | Medium | 4 | No |
| 6 | Add concurrency tests | 3 | Low | 1, 4 | Yes (with 7) |
| 7 | Update docs for open-source | 3 | Low | 5, 6 | Yes (with 6) |

**Issues from challenge report NOT addressed (intentionally deferred):**
- Semantic search — requires architectural decision on embeddings provider
- Access control — needs own backend, out of scope for MVP
- Author search scaling — mitigated by MemoryStore abstraction enabling future optimization
- root.md format (JSON vs Markdown) — too disruptive for hardening pass, revisit post-release
