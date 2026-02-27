# Claude Shared Memory — Functional Requirements

## Concept

A plugin for Claude (Cowork) that uses a GitHub repository as the team's shared knowledge base. Any team member in their Claude session gains access to shared context: terminology, solutions, processes, contacts. Claude understands the team as a colleague, not as a new intern in each conversation.

---

## Roles

**Administrator** — one person who maintains the repository. Sets up the structure, resolves conflicts via git, manages access. Responsible for initial setup (creating the repository, `_meta.md`, inviting participants).

**Participant** — any team member. Interacts with memory only through Claude: reads context, adds new entries. No need to know git.

---

## Repository Structure

The repository is project-oriented: the basic unit is a project. Team-wide knowledge (not tied to a specific project) is stored in the `_shared/` root folder.

### Principle: root.md as table of contents, entries as separate files

Each folder (project or `_shared/`) contains a `root.md` file — this is the **table of contents**: a list of entries with title and brief description. The entries themselves are stored in separate `.md` files nearby.

When loading, the plugin reads **only `root.md`** — a lightweight index. Full entry content is loaded selectively: the plugin selects relevant entries by keyword matching in the table of contents, or the user requests a specific entry.

### Structure

```
shared-memory/
├── _shared/
│   ├── root.md
│   ├── team.md
│   ├── deploy-process.md
│   └── glossary.md
│
├── project-alpha/
│   ├── root.md
│   ├── overview.md
│   ├── rive-vs-lottie.md
│   ├── auth-architecture.md
│   └── stack.md
│
├── project-beta/
│   ├── root.md
│   └── ...
│
└── _meta.md
```

### Format of root.md

```markdown
# Project Alpha

Short project description (1-2 sentences).

## Table of Contents

| Entry | Description | Tags |
|-------|-------------|------|
| [overview](overview.md) | Project goals, current status, key metrics | goals, status |
| [stack](stack.md) | Rive, React, Node.js, PostgreSQL | tech, stack |
| [rive-vs-lottie](rive-vs-lottie.md) | Decision: chose Rive for interactive animations (2026-02-27) | animation, decision, rive |
| [auth-architecture](auth-architecture.md) | Decision: JWT + refresh tokens (2026-02-20) | auth, decision, jwt |
```

The `Tags` column — keywords for quick relevance search without full-text file search. The format of `_shared/root.md` is analogous.

**Tag format:** lowercase Latin letters, numbers and hyphens (`a-z`, `0-9`, `-`). Tags separated by comma and space. Matching is case-insensitive. When creating an entry (F3), the plugin normalizes tags automatically (lowercase, trim). The plugin suggests tags from existing ones in root.md to prevent drift (for example, if `auth` exists — it won't suggest creating `authentication`).

### Entry Format

Each entry file has a fixed header structure:

```markdown
# <Title>

- **Date:** YYYY-MM-DD
- **Author:** <Name> (via Claude | manual)
- **Tags:** tag1, tag2, tag3

<Content — free form markdown>
```

The `Date`, `Author`, `Tags` fields are mandatory. Content is free-form markdown with no size restrictions.

### Format of _meta.md

`_meta.md` — the repository memory configuration. Defines templates and rules.

```yaml
# Shared Memory Configuration

version: 1

# Template for new project root.md
project_template: |
  # {project_name}

  Short project description.

  ## Table of Contents

  | Entry | Description | Tags |
  |-------|-------------|------|

# Template for new entry files
entry_template: |
  # {title}

  - **Date:** {date}
  - **Author:** {author} (via Claude)
  - **Tags:** {tags}

# Archived projects (hidden from project list in F6, but searchable via F4)
archived_projects: []
```

### Entry Connectivity

Entries can reference each other via markdown links:

- Within a project: `[see stack](stack.md)`
- Between projects: `[related to Beta](../project-beta/overview.md)`
- To shared memory: `[deploy process](../_shared/deploy-process.md)`

When creating an entry, the plugin checks the table of contents of the active project and `_shared/` for entries with ≥1 common tag. If it finds 1-3 related entries — it automatically adds links to the end of the new entry (section `## Related`). If >3 — it shows candidates (sorted by number of common tags) and asks the user to select the most relevant ones.

### Creating a New Project

The plugin creates a folder + `root.md` from the template in `_meta.md`. If the user enters a project name in F6 that doesn't exist — the plugin asks: "Create a new project?" Upon confirmation, it creates the folder and `root.md` in a single commit.

**Project name validation:** the project folder name must contain only lowercase Latin letters, numbers and hyphens (`a-z`, `0-9`, `-`). Cannot start with `_` (reserved for `_shared/` and `_meta.md`). Maximum length — 50 characters. If the user enters a name in another language or with spaces — the plugin suggests a slug version: "Create project "my-cool-project"?"

### Loading at Startup

At session startup, the plugin reads **`_shared/root.md`** — the table of contents of shared memory. If a session state file contains an active project — it reads that project's `root.md` as well. Entry content is loaded selectively — by relevance to the conversation or by request. The plugin does not cache data in context and rereads `root.md` on each memory access (see F8).

---

## Functional Requirements

### F1. Repository Connection

- The plugin accepts a GitHub repository URL and access token (Personal Access Token with read/write rights)
- Validates the connection on first run
- The token is stored locally with each user, not transmitted to shared memory
- **First run (cold start):** if the repository is empty, the plugin offers to initialize it — creates `_meta.md` with default templates and `_shared/root.md` with an empty table in a single commit (atomically via Git Trees API). If the repository is partially initialized (has `_meta.md` but no `_shared/root.md` or vice versa) — the plugin completes missing files. This is an idempotent operation

### F2. Reading Context

- **On session startup:** the plugin reads `_shared/root.md`. If the session state file (see F8) contains an active project — it reads that project's `root.md` as well
- **Brief summary when connecting to a project:** on first connection to a project in a session (F6) or when recovering after context loss (F8), the plugin shows a brief summary: the number of entries in the project (from the root.md table) and the date of the last entry (from the `Date` field in the last row of the root.md table). Format: "Project mobile-app: 36 entries, last entry — 2026-02-27". If the project is empty (0 entries in root.md) — format: "Project X: empty for now. Create the first entry to get started". This is not full activity history (GitHub Insights is for that), but a landmark for the user when entering context. No additional API request needed — data is taken from root.md, which is already loaded
- **Project — by command:** the user explicitly connects a project (see F6)
- **Loading entries by tags:** on memory access, the plugin reads `root.md` (each time fresh, not relying on context) and matches the user's request against the table of contents. Matching algorithm:
  1. Keywords are extracted from the user's request (Claude determines them by meaning, not mechanical split)
  2. Each keyword is compared against the `Tags` and `Description` columns — case-insensitive. For `Tags` — whole tag match (exact). For `Description` — by substring match (so "auth" finds "authentication")
  3. Entries are ranked by number of matching keywords (more matches = higher). With equal count — entries from the active project rank higher than from `_shared/`, which rank higher than from other projects
  4. Entries with ≥1 match are candidates. If there is one candidate — it is loaded automatically. If 2-5 — all are loaded. If >5 — the plugin shows the user a list and asks to select
  5. If no matches — the plugin reports: "Nothing found in table of contents" and offers deep search (F4)

### F3. Writing to Memory

- Any write to shared memory requires **explicit intent** from the user. The plugin does not write automatically. Explicit triggers: "remember for the team" ("запомни для команды"), "add to shared memory" ("добавь в общую память"), "save the decision" ("сохрани решение"). If the user just says "remember" without clarification — the plugin asks: "Save to shared team memory or to local memory?"
- The plugin determines: does the entry belong to the active project or to shared memory (`_shared/`)?
- **Deduplication check:** before creating an entry, the plugin checks the `root.md` table of contents — is there an entry with ≥2 matching tags or an entry whose Description contains ≥50% of keywords from the new user's title/description. If it finds a candidate — it asks the user: "A similar entry already exists: [title]. Create a new one or update the existing one?" If the user chooses update — go to F5. **Deduplication limitation:** the check works at the level of text tag matching and keyword matching. Semantic duplicates — entries with different words but similar content (e.g., "animation-guidelines" and "micro-interactions") — are not detected. This is a deliberate design decision — semantic deduplication would require embedding models and goes beyond MVP scope. The responsibility for preventing semantic duplicates lies with the team. **Recommendation:** before creating a new entry, the user should review the root.md of the current project and `_shared/root.md` with a quick tag search (F4). The plugin reminds the user of this when creating an entry: "Check if there's a similar entry: [search results by tags]"
- **Filename generation:** the plugin creates a slug from the entry title — only `a-z`, `0-9`, `-` (same rules as project names). Special characters are removed, spaces replaced with `-`. Maximum 60 characters. Reserved names (`root`, `_meta`) are forbidden. If a file with that name already exists — a numeric suffix is added (`-2`, `-3`). Example: title "Rive vs. Lottie!" → file `rive-vs-lottie.md`
- **Escaping in root.md table:** when adding a row to the table of contents, the `|` character in all columns (Entry, Description, Tags) is replaced with `\|`. This prevents markdown table corruption
- Creates a new entry file (e.g. `project-alpha/rive-vs-lottie.md`) from the template in `_meta.md`:
  ```
  # Rive over Lottie
  - **Date:** 2026-02-27
  - **Author:** Sergei (via Claude)
  - **Tags:** animation, decision, rive, lottie

  Chose Rive for interactive UI animations — state machines, WASM runtime, WebGL rendering.
  ```
- **Author identification:** the plugin gets the author name from GitHub API (`GET /user` by token → field `name` or `login` as fallback). If the API is unavailable — the plugin asks the user to enter the name manually. The name is determined once on connection (F1) and cached for the entire session
- Adds a row to the `root.md` table of the corresponding folder
- If no project is selected and the entry is not shared — the plugin asks the user which project to assign it to
- **Commit atomicity:** the plugin creates both files (entry + updated root.md) in a single commit via GitHub Git Trees API (create blobs → create tree → create commit → update ref). If any step in this chain fails — the commit is not created and changes are not applied (no partial state). Before creating a commit, the plugin gets the SHA of current HEAD and passes it as parent. If SHA changed (someone committed before) — the plugin repeats the entire operation (rereads root.md, rebuilds tree, commits) up to 3 times. On failure — tells the user, user data is not lost (the plugin offers to retry)

### F4. Memory Search

- User asks: "what did we decide about animations?"
- **Quick search (default):** the plugin reads `root.md` of all projects and `_shared/`, searches for matches by `Tags` and `Description` in the tables of contents (matching algorithm — see F2). Does not require reading all entry files. **Search priority:** first the active project, then `_shared/`, then other projects (alphabetically). With equal relevance, entries from priority source are shown higher
- **Filter by author (separate mode):** if the user's request contains author indication (e.g., "what did Vika do?", "entries from Boris"), the plugin switches to author search mode. This mode **differs from quick search** — it requires reading metadata (field `Author`) from entry files, not just from root.md. Algorithm: the plugin reads entry metadata (lines `- **Author:**`) in the active project and `_shared/`, compares with the name from request — case-insensitive, by substring match (so "Vika" finds "Viktoriya (via Claude)"). This is slower than quick search by root.md. The plugin warns: "Searching by author — this may take a few seconds" (at any number of entries, since this mode always requires reading files). The author index is cached for the session and updated when switching projects (F6), creating a new entry (F3), or updating an existing one (F5)
- **Deep search (if quick search gave no results or by user request):** the plugin uses GitHub Search API for full-text search across entry files in the repository. Specifics: GitHub indexing can lag up to 1 hour for new files, results may be incomplete. The plugin always warns when using deep search: "Deep search results may be incomplete — recently added entries are indexed with delays up to 1 hour". If search returned no results — additionally: "Try searching again later or use quick tag search"
- **Results presentation:** the plugin returns entries with source indication (project, entry filename), sorted by search priority (see above) and relevance. If ≤5 entries found — shows all with brief description from `root.md`. If 6-15 found — shows compact list (title + project). If >15 — shows first 15 (by priority) and reports: "Found N entries, showing first 15. Refine your query for more precise results"

### F5. Updating Existing Entries

- User says: "update — we switched from PostgreSQL to CockroachDB"
- The plugin searches for relevant entry via the active project's `root.md`, then via `_shared/root.md` (by tags and description)
- If multiple candidates found — shows a list, asks the user to select a specific entry. Updating always applies to **one entry at a time**. If the user wants to update multiple entries — each is updated separately with confirmation
- **Update with re-reading:** the plugin always rereads the entry file from the repository immediately before editing (even if content is already in context). Applies user changes to the current version. If the file was changed by another participant since the user last saw it — the plugin determines the author and date from the latest git commit for that file (via GitHub API) and reports: "This entry was updated by [commit-author] [commit-date]. Here's the current version: [brief content]. Still want to make changes?" User confirms or cancels. Update = file rewrite with new content (old version preserved in git history)
- If needed, updates description and tags in the `root.md` table (if entry content changed significantly — the plugin offers to update Description and Tags in root.md)
- **Atomicity:** same as F3 — entry and root.md are committed in a single commit via Git Trees API with SHA check
- Does not delete — updates. Deletion only via administrator manually

### F6. Connecting and Switching Project

- User says: "connect the project" or "working on the project"
- The plugin requests a list of folders in the repository root (excluding `_shared/`, `_meta.md` and projects from `archived_projects` in `_meta.md`)
- Shows the user a **list of available projects as a suggestion** — user selects from list or enters a name
- If user enters a name — the plugin first slugifies it (applies validation rules from "Creating a New Project"), then checks existence of slug. If a project with such slug exists — connects it. If not — offers to create a new one
- The plugin saves the selected project to the session state file (see F8) and reads the selected project's `root.md`
- `_shared/root.md` is always available — the plugin reads it on each memory access alongside the active project's `root.md`
- All new entries by default are written to the active project's folder
- The user can switch to another project within a single session — the plugin updates the state file and starts working with the new project's `root.md`

### F7. Metadata and Audit

- Each entry contains mandatory fields: Date, Author, Tags (see "Entry Format")
- The Author field indicates the addition method: `(via Claude)` or `(manual)` — for entries added manually by administrator
- Git history provides full audit: who, when, what changed
- Plugin commit messages follow a unified format: `[shared-memory] <action>: <short description>`. Allowed `<action>` values: `init` (F1), `create-entry` (F3), `update-entry` (F5), `create-project` (F6)

### F8. Resilience to Context Loss

When Claude compresses or clears context, it loses everything loaded from memory, including the active project. The plugin must recover automatically.

- **Do not rely on context.** The plugin rereads necessary `root.md` and entries from the repository on each memory access, rather than relying on them being in context
- **Session state file.** The plugin stores minimal state in a local session file (`.shared-memory-state` in the Cowork session working directory). Contents: `{"active_project": "project-alpha"}`. When switching projects (F6) — updates the file atomically (write to temp + rename). On any access — reads from file which project is active. State file is per-session — with multiple parallel sessions, each uses its own Cowork working directory, no conflicts arise
- **Fallback on state file loss.** If state file is unavailable or corrupted — the plugin works without active project (only `_shared/`). On next project memory access — offers to select project again
- **Automatic recovery.** After context loss, the plugin determines the active project from the state file, reads `_shared/root.md` + project `root.md`, and continues working as usual. User should do nothing manually

### F9. Differentiation from Claude's Built-in Memory

Claude has its own built-in memory system (memory-management: CLAUDE.md file + memory/ folder). It is local — tied to one user and one session. The Shared Memory plugin is a **different, separate system**. They should not be confused.

Differentiation rules:

- **Explicit intent for writing.** Writing to shared memory only by explicit trigger (see F3). The plugin never writes to shared memory automatically or by indirect signs
- **Different storage.** Built-in memory — local session files. Shared Memory — GitHub repository. The plugin never writes to Claude's local memory and vice versa
- **Priority on conflict.** If local memory and shared memory contain conflicting information, Claude should inform the user and clarify which source is current
- **Source transparency.** When Claude answers a question using data from shared memory, he explicitly states: "according to team shared memory, ...". When from local: "in my memory for you it's recorded that ..."
- **No automatic synchronization.** Local memory and shared memory are not synchronized with each other. These are two independent systems

---

## Constraints and Rules

- **Append-first**: when creating new knowledge, the plugin always creates a new entry file. Updating content of an existing entry (F5) — only on explicit user request "update"
- **No deletion**: the plugin does not delete entries and files. Cleanup of outdated data and project archiving — administrator's task
- **Conflicts (optimistic locking)**: before each commit, the plugin checks SHA of current HEAD. On conflict — retry up to 3 times with re-reading. On failure — tell the user
- **Context economy**: the plugin does not cache data in context. On each memory access, reads `root.md` fresh, full entries are loaded selectively — by tags or on user request
- **Response language**: Claude responds in the same language the question was asked in. At the same time, entry content (filenames, technical terms, field names, links) is not translated — they remain in the language they are written in memory. Only the response wrapper is translated, not the data from memory

---

## Error Handling

- **Network unavailable / GitHub API timeout**: the plugin tells the user "Shared memory is temporarily unavailable". Retry up to 3 times with exponential backoff (1s, 3s, 9s). Claude continues working without shared memory
- **Invalid token**: the plugin reports "Access token is invalid" and asks the user to update the token in plugin settings
- **Corrupted root.md**: if the table in root.md does not parse — the plugin falls back: shows a list of all .md files in the folder (except root.md) as a flat list. The plugin warns the current user: "root.md is corrupted in [folder], working in fallback mode. Tell the administrator to fix it". Administrator notification — user's responsibility (plugin has no separate communication channel with administrator)
- **Write conflict (SHA mismatch)**: retry up to 3 times (see F3/F5). On failure — reports: "Could not write, someone updated memory at the same time. Try again"
- **Non-existent project in state file**: if state file points to a deleted project — the plugin resets active project and offers to select again
- **Stale data in context (stale read)**: the plugin rereads `root.md` on each access (see F8), so data is always current. However, if an entry was already loaded in context and then changed in repository — the plugin won't know until next access. When updating an entry (F5), the plugin **must** reread the file from repository before editing, even if content is already in context. This ensures the update is applied to the current version
- **Rate limit GitHub API**: on HTTP 429 (rate limit exceeded), the plugin reports: "GitHub API request limit exceeded. Try again in N minutes" (N is taken from `Retry-After` or `X-RateLimit-Reset` header). Plugin does not retry on rate limit — waits for limit reset

---

## Usage Scenarios

**First run:** Administrator creates private GitHub repository → connects plugin → plugin sees empty repository and offers to initialize → creates `_meta.md` and `_shared/root.md` → administrator creates first project via Claude or manually.

**New team member:** Connects plugin → Claude reads `_shared/root.md` → sees shared memory table of contents. Says "working on Alpha" → plugin saves project to state file, reads project `root.md`. Claude pulls needed entries as conversation goes on. No need to explain who is who and why we do this.

**Making a decision:** Participant works in Project Alpha context → tells Claude "remember for the team: chose Rive" ("запомни для команды: выбрали Rive") → plugin creates `project-alpha/rive-vs-lottie.md` and adds row to `project-alpha/root.md` → a week later another participant connects Alpha, asks "what did we decide about animations?" → plugin sees `animation` tag in table of contents, loads entry and answers.

**Cross-project search:** Participant asks "which projects do we use PostgreSQL in?" → plugin reads `root.md` of all projects, searches by tags and descriptions → returns results with project and entry indication.

**Shared knowledge:** Participant says "add to shared memory: new designer — Masha, responsible for UI" ("добавь в общую память: новый дизайнер — Маша, отвечает за UI") → plugin updates `_shared/team.md` and description in `_shared/root.md`.

---

## Prerequisites

1. GitHub repository (private, created by administrator)
2. Personal Access Token for each participant (or one shared token with limited rights)
3. Installed plugin for each participant in Cowork

---

## Open Questions (medium priority)

Questions that need to be resolved during implementation, but do not block MVP development:

1. **Delays on memory access** — each GitHub API request = 200-800ms. Need a UX loading indicator?
2. **Outdated entries** — no mechanism to mark entries as outdated except manual archiving by administrator
3. **Archived projects in search** — archived projects are hidden from F6 but should be available in F4 (deep search). Define priority: after active projects
4. **Entry-level access control** — currently any participant can write anywhere. Need review/approval workflow?
5. **Multiple sessions of one user** — if two Cowork sessions are open, state file can be overwritten. Solution: add session_id to state file
6. **State file synchronization across devices** — state file is local, on another device the project won't auto-connect
7. **GitHub API rate limits** — with active team (5+ people), can approach 5000 requests/hour limit. GitHub Search API is stricter: 10 requests/min. Monitor and add local cache with TTL if needed
8. **State file versioning** — current format `{"active_project": "..."}` is minimal. When adding new fields, migration is needed. Add `version` field on implementation
9. **Performance with many projects** — with 50+ projects, reading all root.md for cross-project search can be slow. Consider lazy-loading or global index
10. **Manually created entries** — Author format for manual entries: `Name (manual)`. Plugin does not validate manual entries, only parses their format when reading
11. **Cross-reference lifecycle** — when an entry is deleted/archived, links to it from other entries become broken. Mechanism for detecting/cleaning broken links
12. **Entry size** — no file size restrictions on entry. Recommendation for users: one entry = one topic/decision. Large architectural decisions better split into several entries
13. **GitHub API response size limits** — GitHub Contents API does not return files >100MB, and base64 encoding increases payload. For practical purposes, limit is not critical (markdown entries usually <100KB)
14. **Tag autocomplete** — when creating an entry, plugin could suggest existing tags to prevent taxonomy drift. Priority: nice-to-have
15. **Retry configurability** — retry parameters (number of attempts, backoff) are hardcoded. Consider moving to `_meta.md` config
16. **Cyclic links in Related** — creating entry A→B then B→A creates cyclic links. Consider acceptable behavior (does not break functionality)
17. **Corrupted entry files** — if an entry file does not contain mandatory fields (Date/Author/Tags) — plugin shows content as-is without metadata parsing
18. **GitHub Search API rate limit** — limit of 10 requests/min is stricter than general. On exceeded — same as general rate limit: tell the user and don't retry
19. **Author filter performance** — author search requires reading metadata of entry files (not just root.md). With 100+ entries in a project this can take 3-10 seconds via GitHub API. Current solution: author index caching for session (see F4). Alternative for Phase 2: adding Author column to root.md (trade-off: index overhead vs. search speed)
20. **Detecting new participants (Phase 2)** — testing revealed problem: team-contacts becomes outdated when new participants start. Automatic detection of new authors via commits — technically possible (F4 already collects author index), but goes beyond core memory management. MVP solution: recommendation to administrator "Regularly check relevance of team records"
