# Claude Shared Memory

A Cowork plugin that turns a GitHub repository into a shared team knowledge base. Every team member's Claude session gains access to shared context — terminology, decisions, processes, contacts — so Claude understands your team like a colleague, not a new intern in each conversation.

## How It Works

The plugin connects Claude to a GitHub repo where your team stores knowledge as Markdown files. When someone asks Claude about a past decision, a technical term, or a process — Claude searches shared memory and answers with full context. When someone makes a new decision worth sharing — they tell Claude to "remember this for the team," and it's saved for everyone.

No git knowledge required from team members. Claude handles all reading and writing through the GitHub API.

## Architecture

Three layers, each with a clear responsibility:

**MCP Server** — the data layer. A Node.js process that talks to GitHub via Octokit. Handles all API calls, atomic commits, SHA conflict resolution, caching, and rate limiting. Exposes tools like `read_entry`, `write_entry`, `search_tags` to Claude via the MCP protocol.

**Skill** — the brain. A SKILL.md file that teaches Claude *when* and *how* to use the MCP tools. Contains matching algorithms, UX patterns, deduplication logic, and rules for separating shared memory from local memory. All LLM reasoning lives here.

**Commands** — quick access. Slash commands (`/memory`, `/remember`, `/project`) that give users direct shortcuts to common operations.

## Repository Structure

Knowledge is organized by project. Team-wide knowledge lives in `_shared/`.

```
your-memory-repo/
├── _meta.md                  # Config: templates, archived projects
├── _shared/
│   ├── root.md               # Index: team glossary, processes, contacts
│   ├── deploy-process.md
│   └── glossary.md
├── mobile-app/
│   ├── root.md               # Index: all entries for this project
│   ├── auth-architecture.md
│   └── rive-vs-lottie.md
└── backend-api/
    ├── root.md
    └── ...
```

Each folder has a `root.md` — a lightweight table of contents with titles, descriptions, and tags. The plugin reads only this index, then loads full entries selectively by relevance. This keeps context usage minimal even with hundreds of entries.

## Key Features

**Smart search** — Claude extracts keywords from your question, matches them against tags (exact) and descriptions (substring) in `root.md`. Person names go through author search. Vague queries fall back to GitHub full-text search.

**Deduplication** — before creating a new entry, the plugin checks for existing entries with overlapping tags or similar descriptions. If a match is found, you can update the existing entry instead.

**Atomic commits** — every write operation (new entry, update, project creation) uses the Git Trees API to commit all changes in a single atomic operation. No partial writes, no corruption.

**Concurrent edit detection** — if someone else updated an entry while you were reading it, the plugin detects the SHA mismatch and gives you options: overwrite, cancel, or let Claude merge the changes.

**Auto-related links** — when you save an entry, the plugin finds other entries with common tags and automatically links them in a Related section.

**Bilingual UX** — all user-facing messages work in both Russian and English.

## Requirements

- Node.js ≥ 20
- GitHub Personal Access Token with `repo` scope
- A GitHub repository (private recommended)
- Claude desktop app with Cowork mode

## Installation

1. Create a GitHub repository for your team's shared memory (private, empty).
2. Generate a Personal Access Token with `repo` scope.
3. Install the Shared Memory plugin in Cowork.
4. In plugin settings, enter your token and repository (`owner/repo-name`).
5. On first launch, Claude will offer to initialize the repo structure.
6. Create your first project: `/project mobile-app`
7. Start saving knowledge: "Remember for the team that we chose JWT for auth."

For team setup: grant repo access to each member's GitHub account, then share the plugin installation link.

## Usage

### Searching

Just ask Claude naturally:

- "What did we decide about authentication?"
- "Who worked on the animation system?"
- "What's our deploy process?"

Or use the command: `/memory auth architecture`

### Saving

Tell Claude what to remember:

- "Remember for the team: we chose Rive over Lottie because of state machines and WASM runtime."
- "Save this decision to shared memory."

Or use the command: `/remember We chose PostgreSQL over MongoDB for ACID compliance`

### Switching projects

- `/project mobile-app` — switch to a project
- `/project` — show project list

## Tech Stack

| Dependency | Version | Purpose |
|---|---|---|
| @modelcontextprotocol/sdk | ^1.27.0 | MCP server framework |
| @octokit/rest | ^22.0.0 | GitHub API client |
| @octokit/plugin-retry | ^8.0.0 | Auto-retry for 5xx/timeouts |
| @octokit/plugin-throttling | ^11.0.0 | Rate limit handling (429) |
| p-limit | ^7.0.0 | Concurrency control |
| zod | ^3.24.0 | Input schema validation |
| transliteration | ^2.6.0 | Slug generation from any language |

## MCP Tools

| Tool | Description |
|---|---|
| `connect_repo` | Validate token, initialize repo if empty |
| `read_root` | Read project's root.md index |
| `read_entry` | Load full entry content by slug |
| `write_entry` | Create new entry (atomic commit) |
| `update_entry` | Update existing entry (with SHA conflict detection) |
| `delete_entry` | Remove entry from root.md and delete file |
| `search_tags` | Search across root.md tables by tags/description |
| `search_author` | Find entries by author name |
| `search_deep` | Full-text search via GitHub Search API |
| `check_duplicate` | Check for similar entries before writing |
| `switch_project` | Change active project context |
| `list_projects` | List all projects in the repo |

## Error Handling

The plugin handles all errors gracefully with user-friendly messages and recovery paths:

- **auth_failed** — guides user to check token in settings
- **network_error** — auto-retries 3 times, then suggests checking connection
- **rate_limit_rest** — waits and retries (5,000 requests/hour limit)
- **rate_limit_search** — suggests tag-based search as alternative (10 requests/minute limit)
- **sha_conflict** — auto-retries atomic commit with fresh SHA
- **concurrent_edit** — shows diff, offers overwrite/cancel/merge
- **parse_error** — flags corruption, directs admin to fix in GitHub

## Customer Journey Diagrams

See the `diagrams/` folder for detailed Mermaid flowcharts:

1. **Admin First-Time Setup** (`01-admin-setup-journey.mermaid`) — from repo creation to team onboarding
2. **Team Member Daily Usage** (`02-team-member-daily-journey.mermaid`) — search, save, and update workflows
3. **Search Decision Tree** (`03-search-decision-tree.mermaid`) — how the plugin routes different query types
4. **Write Entry Flow** (`04-write-entry-flow.mermaid`) — full write pipeline with deduplication and conflict handling
5. **Error Handling & Recovery** (`05-error-handling-recovery.mermaid`) — all error types with recovery paths

## Documentation

- [Functional Requirements](shared-memory-plugin-requirements.md) — what the plugin does (F1–F9), constraints, open questions
- [Implementation Guide](shared-memory-implementation-guide.md) — how to build it: architecture, API contracts, code patterns, UX flows

## Development Status

Version 1.3 — documentation complete, passed 3 review iterations (tech architect + product PM + UX designer). Ready for development.

## License

Internal use only.
