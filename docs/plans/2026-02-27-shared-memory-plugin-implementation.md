# Shared Memory Plugin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete Cowork plugin that turns a GitHub repository into a shared team knowledge base with 12 MCP tools, a skill file, and 3 slash commands.

**Architecture:** Three-layer plugin: MCP Server (Node.js, stdio transport, Octokit for GitHub API) providing data access tools; Skill (SKILL.md) teaching Claude when/how to use those tools; Commands (3 slash commands for quick access). All writes use Git Trees API for atomic commits with SHA conflict retry.

**Tech Stack:** Node.js >= 20, ES modules, MCP SDK v1.27+, Zod, Octokit v22, plugin-retry v8, plugin-throttling v11, p-limit v7, transliteration v2.6, Vitest for testing.

**Source docs:** `docs/shared-memory-plugin-requirements.md` (spec F1-F9), `docs/shared-memory-implementation-guide.md` (full API contracts)

**Test repo:** `sfrangulov/shared-memory` (private GitHub repo)

---

## Task 1: Project Scaffold

**Files:**
- Create: `servers/package.json`
- Create: `servers/.gitignore`
- Create: `.mcp.json`
- Create: `.claude-plugin/plugin.json`

**Step 1: Create plugin directory structure**

```bash
mkdir -p servers/lib servers/test skills/shared-memory/references commands .claude-plugin
```

**Step 2: Create `servers/package.json`**

```json
{
  "name": "shared-memory-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "start": "node github-memory-server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.0",
    "zod": "^3.24.0",
    "@octokit/rest": "^22.0.0",
    "@octokit/plugin-retry": "^8.0.0",
    "@octokit/plugin-throttling": "^11.0.0",
    "p-limit": "^7.0.0",
    "transliteration": "^2.6.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

**Step 3: Create `servers/.gitignore`**

```
node_modules/
```

**Step 4: Create `.mcp.json`**

```json
{
  "mcpServers": {
    "shared-memory": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/servers/github-memory-server.js"],
      "env": {
        "GITHUB_TOKEN": "{{GITHUB_TOKEN}}",
        "GITHUB_REPO": "{{GITHUB_REPO}}"
      }
    }
  }
}
```

**Step 5: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "shared-memory",
  "version": "1.0.0",
  "description": "Shared team knowledge base backed by a GitHub repository.",
  "author": { "name": "Sergei Frangulov" },
  "license": "MIT",
  "keywords": ["memory", "team", "knowledge-base", "github", "collaboration"]
}
```

**Step 6: Install dependencies**

```bash
cd servers && npm install
```

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold plugin structure with dependencies"
```

---

## Task 2: github-client.js — GitHub API Wrapper

**Files:**
- Create: `servers/lib/github-client.js`
- Create: `servers/test/github-client.test.js`

**Context:** Wraps Octokit with retry/throttle plugins. Exposes methods: `getUserInfo`, `getFileContent`, `getDirectoryListing`, `searchCode`, `getHeadSHA`, `getTreeSHA`, `createBlob`, `createTree`, `createCommit`, `updateRef`, `getLastCommitForFile`, `getRootDirectoryListing`. Uses p-limit(5) for concurrency. Accepts dependency injection of octokit and repo string for testability.

**Step 1: Write the failing test**

See implementation guide section 4.1 for full method signatures. Test with mock Octokit:
- `createGitHubClient` parses owner/repo, throws on invalid format
- `getUserInfo` returns `{ name, login }`, falls back to login when name is null
- `getFileContent` decodes base64 content, returns `{ content, sha }`, returns null on 404
- `getDirectoryListing` returns array of filenames (files only, not dirs), returns [] on 404
- `getHeadSHA` returns SHA from ref

**Step 2: Run test to verify it fails**

Run: `cd servers && npx vitest run test/github-client.test.js`

**Step 3: Implement**

See implementation guide section 4.1 for Octokit init code. Key points:
- `createOctokit(token)` — creates Octokit with retry + throttling plugins
- `createGitHubClient({ octokit, repo })` — parses `owner/repo`, returns object with all methods
- All API calls wrapped with `limit()` from p-limit(5)
- `getFileContent` decodes base64 from GitHub Contents API
- Errors: 404 -> return null/[], others rethrow

**Step 4: Run tests, verify pass**

Run: `cd servers && npx vitest run test/github-client.test.js`

**Step 5: Commit**

```bash
git add servers/lib/github-client.js servers/test/github-client.test.js
git commit -m "feat: add github-client.js with Octokit wrapper and unit tests"
```

---

## Task 3: root-parser.js — Markdown Table Parser

**Files:**
- Create: `servers/lib/root-parser.js`
- Create: `servers/test/root-parser.test.js`

**Context:** Most fragile module — requires >= 15 unit tests. Parses markdown tables from root.md. See implementation guide section 4.2 for full spec.

**Exported functions:**
- `splitTableRow(line)` — splits row respecting escaped `\|`
- `escapeTableCell(text)` / `unescapeTableCell(text)` — pipe escaping
- `parseRootMd(markdown)` — returns `{ description, entries[], corrupted? }`
- `addEntryToRoot(markdown, entry)` — idempotent add, returns `{ updated_markdown, was_added }`
- `updateEntryInRoot(markdown, filename, changes)` — update description/tags for a row

**Step 1: Write >= 15 failing tests**

Test cases (minimum):
1. `splitTableRow` — simple row
2. `splitTableRow` — escaped pipes
3. `splitTableRow` — no leading/trailing pipes
4. `splitTableRow` — whitespace trimming
5. `escapeTableCell` — escapes pipes
6. `unescapeTableCell` — unescapes pipes
7. `parseRootMd` — standard 3-entry table
8. `parseRootMd` — tags with hyphens (e2e-testing, react-query)
9. `parseRootMd` — empty table (only header + separator)
10. `parseRootMd` — escaped pipes in description
11. `parseRootMd` — flexible column order (Tags | Entry | Description)
12. `parseRootMd` — missing description line
13. `parseRootMd` — unicode in description
14. `parseRootMd` — corrupted (no table header) returns `corrupted: true`
15. `addEntryToRoot` — adds new row
16. `addEntryToRoot` — idempotent skip when file exists
17. `addEntryToRoot` — escapes pipes in description
18. `addEntryToRoot` — adds to empty table
19. `updateEntryInRoot` — updates description and tags
20. `updateEntryInRoot` — returns original if file not found
21. `updateEntryInRoot` — updates only description when tags not provided

**Step 2: Run tests, verify fail**

Run: `cd servers && npx vitest run test/root-parser.test.js`

**Step 3: Implement**

Critical requirements from implementation guide section 4.2:
1. Determine column order from header row
2. Handle escaped `\|` with character-by-character walk
3. Skip separator lines (regex: `^\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$`)
4. `addEntryToRoot` must be idempotent (check by filename)
5. Parse markdown links `[name](file.md)` in Entry column
6. Handle empty lines and trailing whitespace

**Step 4: Run tests, verify pass**

Run: `cd servers && npx vitest run test/root-parser.test.js`

**Step 5: Commit**

```bash
git add servers/lib/root-parser.js servers/test/root-parser.test.js
git commit -m "feat: add root-parser.js with markdown table parsing and 21 unit tests"
```

---

## Task 4: slugify.js — Filename Generator

**Files:**
- Create: `servers/lib/slugify.js`
- Create: `servers/test/slugify.test.js`

**Context:** See implementation guide section 4.3. Uses `transliteration` library.

**Exported functions:**
- `slugify(title)` — title to slug: transliterate -> lowercase -> replace non-alnum with hyphens -> collapse/trim hyphens -> max 60 chars -> reserved name check
- `ensureUnique(slug, existingFiles)` — if `slug.md` exists, return `slug-2`, `slug-3`, etc.

**Step 1: Write failing tests**

Test cases:
- Basic conversion: "Hello World" -> "hello-world"
- Cyrillic transliteration: "Привет мир" -> "privet-mir"
- Special characters: "Rive vs. Lottie!" -> "rive-vs-lottie"
- Hyphen collapsing: "hello---world" -> "hello-world"
- Leading/trailing hyphens removed
- Max 60 character truncation
- Reserved names (root, _meta, _shared, shared) get "-entry" suffix
- Mixed language: "Auth архитектура" -> "auth-arkhitektura"
- Numbers preserved: "Version 2.0" -> "version-2-0"
- `ensureUnique` — no conflict returns as-is
- `ensureUnique` — first conflict adds "-2"
- `ensureUnique` — multiple conflicts increment

**Step 2-4: Implement and verify**

**Step 5: Commit**

```bash
git add servers/lib/slugify.js servers/test/slugify.test.js
git commit -m "feat: add slugify.js with transliteration and uniqueness check"
```

---

## Task 5: state-manager.js — Session State

**Files:**
- Create: `servers/lib/state-manager.js`
- Create: `servers/test/state-manager.test.js`

**Context:** See implementation guide section 4.5. Manages `.shared-memory-state` JSON file. Uses atomic writes (write to temp file, then rename). Author cache is in-memory, per-project, session-only.

**Exported:** `createStateManager(workdir)` — returns object with methods.

**Methods:**
- `readState()` — returns `{ active_project, version }`. Defaults on missing/corrupted file.
- `writeState(state)` — atomic write via temp + rename
- `getAuthorCache(project)` / `setAuthorCache(project, cache)` / `invalidateAuthorCache(project?)`

**Step 1: Write failing tests**

Use `mkdtemp` for isolated temp directories. Test cases:
- readState defaults when file missing
- readState reads existing file
- writeState writes atomically (verify via readFile)
- Corrupted JSON resets to defaults
- Author cache: null for empty, store/retrieve, invalidate per-project, invalidate all

**Step 2-4: Implement and verify**

**Step 5: Commit**

```bash
git add servers/lib/state-manager.js servers/test/state-manager.test.js
git commit -m "feat: add state-manager.js with atomic writes and author cache"
```

---

## Task 6: atomic-commit.js — Git Trees API

**Files:**
- Create: `servers/lib/atomic-commit.js`
- Create: `servers/test/atomic-commit.test.js`

**Context:** See implementation guide section 4.4. Implements Git Trees API workflow: getHeadSHA -> getTreeSHA -> createBlob (per file) -> createTree (with base_tree!) -> createCommit -> updateRef. Throws `ConflictError` on 422. `atomicCommitWithRetry` wraps with retry loop (max 3, backoff 1s/3s/9s).

**Exported:**
- `ConflictError` class
- `atomicCommit(client, { files, message, parentSHA? })` — single attempt
- `atomicCommitWithRetry(client, { files, message, maxRetries? })` — with retry

**Step 1: Write failing tests with mock client**

- `atomicCommit` — happy path: creates blobs, tree, commit, updates ref
- `atomicCommit` — throws ConflictError on 422 from updateRef
- `atomicCommitWithRetry` — retries on ConflictError, succeeds on 3rd attempt

**Step 2-4: Implement and verify**

Critical: `createTree` must pass `base_tree` = treeSHA from parent commit (to preserve existing files). `path` must be full repo-relative path (e.g., "project-alpha/entry.md").

**Step 5: Commit**

```bash
git add servers/lib/atomic-commit.js servers/test/atomic-commit.test.js
git commit -m "feat: add atomic-commit.js with Git Trees API and SHA conflict retry"
```

---

## Task 7: MCP Server — All Tool Registrations

**Files:**
- Create: `servers/github-memory-server.js`

**Context:** Main entry point. Creates MCP server, initializes Octokit + github-client + state-manager, registers all 12 tools. See implementation guide sections 3.3-3.5 for all tool input/output contracts.

**Tools to register (12 total):**

| Tool | Spec | Input | Key logic |
|------|------|-------|-----------|
| `connect_repo` | F1 | `{}` | getUserInfo, check/init repo, list projects |
| `read_root` | F2 | `{ project }` | getFileContent, parseRootMd, fallback on corrupted |
| `read_entry` | F2 | `{ project, file }` | getFileContent, parseEntryMetadata, return sha |
| `write_entry` | F3 | `{ project, title, content, tags, description, auto_related?, related_override? }` | slugify, check_duplicate, findRelated, atomicCommitWithRetry |
| `update_entry` | F5 | `{ project, file, previous_sha, new_content, new_tags?, new_description? }` | Re-read, SHA compare, concurrent_edit detection, atomicCommit |
| `search_tags` | F4 | `{ keywords[], active_project? }` | Read all root.md in parallel, match tags/desc, rank, truncate at 15 |
| `search_author` | F4 | `{ author_query, project? }` | Read entry metadata, cache in stateManager, substring match |
| `search_deep` | F4 | `{ query }` | GitHub Search API, handle 403/422 rate limit |
| `list_projects` | F6 | `{}` | getRootDirectoryListing, filter dirs, count entries |
| `switch_project` | F6 | `{ project }` | slugify, check existence, create or switch, compute summary |
| `get_state` | F8 | `{}` | readState from state-manager |
| `check_duplicate` | F3 | `{ project, title, tags, description }` | Tag matching (>=2 common) or keyword overlap (>=50%) |

**Helpers needed:**
- `errorResult(error_code, error, retry_possible, retry_after_ms?)` — standard error format
- `successResult(data)` — standard success format
- `withErrorHandling(fn)` — catches common errors (401, 404, 429, ConflictError)
- `buildEntryContent({ title, date, author, tags, content, related })` — builds markdown
- `parseEntryMetadata(content)` — extracts title, date, author, tags, related from markdown
- `findRelated(entries, tags, excludeFile)` — finds entries with common tags
- `parseArchivedProjects(metaContent)` — parses archived_projects from _meta.md
- DEFAULT_META and DEFAULT_SHARED_ROOT constants for cold start

**Step 1: Implement the server**

Reference implementation guide sections 3.3-3.5 and 4.1-4.5 for exact contracts. The file will be ~600-700 lines.

**Step 2: Verify server starts without errors**

Set env vars and start, verify no syntax errors.

**Step 3: Run all existing unit tests**

Run: `cd servers && npx vitest run`
Expected: All prior tests still pass

**Step 4: Commit**

```bash
git add servers/github-memory-server.js
git commit -m "feat: add MCP server with all 12 tool registrations"
```

---

## Task 8: SKILL.md — Main Skill File

**Files:**
- Create: `skills/shared-memory/SKILL.md`

**Context:** Full content specified in implementation guide section 5.1 (lines 763-995). Contains:
- YAML frontmatter: name, description (with bilingual triggers), version
- Core Principles: never write auto, always re-read, explicit source attribution, separation from local memory
- Workflow: First-Time Onboarding (fires once when connect_repo returns "initialized")
- Workflow: Startup & Connection (get_state -> connect_repo -> handle errors -> read roots)
- Workflow: Reading Context (get_state -> read_root -> extract keywords -> match -> load entries, max 5)
- Workflow: Writing (check intent local/shared -> determine project -> check_duplicate -> prepare -> write_entry -> handle related_candidates)
- Workflow: Updating (find entry -> read_entry save SHA -> apply changes -> update_entry -> handle concurrent_edit)
- Workflow: Searching (decision tree: person name -> search_author; tags -> search_tags; fallback -> search_deep)
- Workflow: Project Management (list_projects -> switch_project -> show summary)
- Error Responses (reference to error-handling.md)
- Bilingual Glossary (translate narrative, never translate folder/file names)
- Commands Quick Reference

**Step 1: Write the skill file**

Copy from implementation guide section 5.1. Ensure all bilingual messages are included (RU/EN pairs).

**Step 2: Commit**

```bash
git add skills/shared-memory/SKILL.md
git commit -m "feat: add SKILL.md with all workflows and UX patterns"
```

---

## Task 9: Reference Files

**Files:**
- Create: `skills/shared-memory/references/matching-algorithm.md`
- Create: `skills/shared-memory/references/ux-patterns.md`
- Create: `skills/shared-memory/references/error-handling.md`

**Step 1: Write `matching-algorithm.md`**

5-step matching algorithm from spec F2:
1. Keywords extracted from user's request (Claude determines by meaning)
2. Each keyword compared: Tags = exact match, Description = substring match, case-insensitive
3. Ranking: match_count DESC, then priority (active > _shared > other active > archived)
4. Candidate handling: 1 -> auto-load, 2-5 -> load all, >5 -> show list (max 5 to load)
5. No matches -> offer deep search

**Step 2: Write `ux-patterns.md`**

Bilingual response templates (RU/EN) for:
- Entry creation confirmation
- Duplicate warning (with match_reason from check_duplicate)
- Search results: <=5 (full descriptions), 6-15 (compact), >15 (first 15 + "refine query")
- Project connection summary (entry count, last date)
- Deep search warning (indexing delay up to 1 hour)
- Context loss recovery message
- Tag suggestions (show 5 most-used, suggest existing over new)

**Step 3: Write `error-handling.md`**

Error templates for all error_codes from section 3.4:
- `auth_failed` — guide to check token in settings
- `repo_not_found` — check URL and token
- `network_error` — temporary unavailability, continue without memory
- `rate_limit_rest` — exceeded 5000/hour, try in N minutes
- `rate_limit_search` — exceeded 10/min, suggest tag-based search
- `sha_conflict` — someone updated at same time, data safe, retrying
- `concurrent_edit` — show diff_summary, ask to proceed or cancel
- `parse_error` — root.md corrupted, tell admin, fallback to file list
- `not_found` — entry/project not found

Each template: empathetic tone, clear next step, non-technical language.

**Step 4: Commit**

```bash
git add skills/shared-memory/references/
git commit -m "feat: add skill reference files (matching, UX patterns, errors)"
```

---

## Task 10: Slash Commands

**Files:**
- Create: `commands/memory.md`
- Create: `commands/remember.md`
- Create: `commands/project.md`

**Context:** Thin wrappers. See implementation guide section 6. Each has YAML frontmatter with `description`, `allowed-tools`, `argument-hint`, plus a brief instruction body referencing the relevant SKILL.md workflow.

**Step 1: Write `commands/memory.md`**

Frontmatter: description = "Search shared team memory", allowed-tools includes read_root, read_entry, search_tags, search_author, search_deep, get_state.
Body: "Search the team's shared memory for: $ARGUMENTS. Follow the shared-memory skill Workflow: Searching section."

**Step 2: Write `commands/remember.md`**

Frontmatter: description = "Save to shared team memory", allowed-tools includes write_entry, check_duplicate, read_root, get_state, switch_project.
Body: "The user wants to save this to shared team memory: $ARGUMENTS. Follow the shared-memory skill Workflow: Writing section."

**Step 3: Write `commands/project.md`**

Frontmatter: description = "Switch or create a project", allowed-tools includes list_projects, switch_project, get_state.
Body: "The user wants to switch projects. Target: $ARGUMENTS. Show list if no argument."

**Step 4: Commit**

```bash
git add commands/
git commit -m "feat: add slash commands (/memory, /remember, /project)"
```

---

## Task 11: Integration Testing

**Context:** Test end-to-end scenarios against `sfrangulov/shared-memory`. Requires `GITHUB_TOKEN` env var.

**Step 1: Verify Node.js version**

Run: `node --version`
Expected: v20.x.x or higher

**Step 2: Run full unit test suite**

Run: `cd servers && npx vitest run`
Expected: All tests PASS

**Step 3: Test connect_repo (cold start)**

Manually test the MCP server by sending JSON-RPC messages via stdio, or write a quick integration test script that imports modules directly and calls GitHub API.

Verify:
- `getUserInfo()` returns valid user
- `getHeadSHA()` returns valid SHA
- If repo is empty, `atomicCommitWithRetry` creates `_meta.md` + `_shared/root.md`
- If repo is initialized, reading `_shared/root.md` returns valid parsed entries

**Step 4: Test write_entry + read_entry cycle**

1. Read `_shared/root.md` via `getFileContent`
2. Create test entry via `slugify` + `addEntryToRoot` + `atomicCommitWithRetry`
3. Read back via `getFileContent` and `parseEntryMetadata`
4. Verify entry content matches what was written

**Step 5: Test search_tags**

1. Read all root.md files
2. Call matching logic with keywords
3. Verify results sorted correctly by match_count and priority

**Step 6: Commit any test fixes**

```bash
git add -A
git commit -m "test: verify integration with real GitHub repository"
```

---

## Summary

| Task | Module | Dependencies |
|------|--------|-------------|
| 1 | Scaffold | None |
| 2 | github-client.js | Octokit, p-limit |
| 3 | root-parser.js | None (pure logic) |
| 4 | slugify.js | transliteration |
| 5 | state-manager.js | Node.js fs |
| 6 | atomic-commit.js | github-client |
| 7 | github-memory-server.js | All modules above |
| 8 | SKILL.md | None (markdown) |
| 9 | Reference files | None (markdown) |
| 10 | Commands | None (markdown) |
| 11 | Integration testing | Real GitHub repo |

**Total:** ~1,800 lines of code + tests + skill/command markdown files.

**Build order is strict:** Tasks 1-6 can be tested independently. Task 7 wires them together. Tasks 8-10 are markdown and can run in parallel. Task 11 validates everything end-to-end.
