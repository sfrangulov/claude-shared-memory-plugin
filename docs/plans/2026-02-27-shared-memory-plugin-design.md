# Shared Memory Plugin — Design Document

- **Date:** 2026-02-27
- **Status:** Approved
- **Related:** [Functional Requirements](../shared-memory-plugin-requirements.md), [Implementation Guide](../shared-memory-implementation-guide.md)

---

## Purpose

Build the Claude Shared Memory plugin — a Cowork plugin that turns a GitHub repository into a shared team knowledge base. The plugin provides 12 MCP tools for reading, writing, searching, and managing team knowledge, plus a skill (SKILL.md) that teaches Claude when and how to use those tools, and 3 slash commands for quick access.

## Target Platform

Claude Desktop (Cowork mode). Plugin packaged with `.claude-plugin/plugin.json`, `.mcp.json`, `servers/`, `skills/`, `commands/` directories.

## Test Environment

- Repository: `sfrangulov/shared-memory` (private GitHub repo)
- Node.js >= 20
- Personal Access Token with `repo` scope

## Architecture

Three layers, each with clear responsibility:

1. **MCP Server** (`servers/github-memory-server.js`) — data layer. Node.js process that talks to GitHub via Octokit. Handles API calls, atomic commits, SHA conflict resolution, caching, rate limiting. Exposes 12 MCP tools via stdio transport.

2. **Skill** (`skills/shared-memory/SKILL.md`) — brain. Teaches Claude when and how to use MCP tools. Contains matching algorithms, UX patterns, deduplication logic, separation from local memory. All LLM reasoning lives here.

3. **Commands** (`commands/*.md`) — quick access. `/memory`, `/remember`, `/project` as thin wrappers over MCP tools.

## Build Approach

Module-by-module, following the implementation guide's Phase 1 order. Each module is built, tested, then integrated.

### Phase 1: MCP Server Core

| Step | Module | Description | Tests |
|------|--------|-------------|-------|
| 1 | Project scaffold | Folder structure, package.json, .mcp.json, plugin.json | — |
| 2 | github-client.js | Octokit wrapper with retry/throttle plugins | Unit |
| 3 | root-parser.js | Markdown table parser (most fragile module) | >= 15 unit tests |
| 4 | slugify.js | Filename generation with transliteration | Unit |
| 5 | state-manager.js | Session state file (.shared-memory-state) | Unit |
| 6 | atomic-commit.js | Git Trees API: blob -> tree -> commit -> ref | Integration |
| 7 | github-memory-server.js | Main server, registers all 12 MCP tools | Integration |

### Phase 2: Skill + References

| Step | File | Description |
|------|------|-------------|
| 8 | SKILL.md | Core workflows: startup, reading, writing, updating, searching, projects |
| 9 | matching-algorithm.md | 5-step matching algorithm from spec F2 |
| 10 | ux-patterns.md | Bilingual response templates |
| 11 | error-handling.md | Error response templates for all error_codes |

### Phase 3: Commands

| Step | File | Description |
|------|------|-------------|
| 12 | memory.md | /memory <query> — search shared memory |
| 13 | remember.md | /remember <text> — save new entry |
| 14 | project.md | /project [name] — switch/create project |

### Phase 4: Integration Testing

End-to-end scenarios against `sfrangulov/shared-memory`:
- Cold start (empty repo initialization)
- New employee onboarding
- Save decision (write_entry + atomic commit)
- Search by tags, by author, deep search
- Update entry with concurrent edit detection
- Context loss recovery via state file
- Rate limit handling
- Corrupted root.md fallback
- Cross-project search

## Key Technical Decisions

- **Runtime:** Node.js >= 20, ES modules (`"type": "module"`)
- **MCP SDK:** v1.27+, Zod for input schemas
- **GitHub API:** Octokit v22 + plugin-retry v8 + plugin-throttling v11
- **Concurrency:** p-limit v7, max 5 parallel GitHub requests
- **Atomic writes:** Git Trees API with SHA conflict retry (3 attempts, exponential backoff)
- **State persistence:** `.shared-memory-state` JSON file, atomic write via temp+rename
- **UX language:** Bilingual (Russian + English), response language matches user's language
- **Context budget:** Max 5 entries loaded per operation
- **Filename generation:** transliteration library for non-Latin characters

## Out of Scope

Per spec:
- Delete entries (admin-only via GitHub UI)
- Bulk operations
- Semantic deduplication (only tag/keyword matching)
- Real-time synchronization between local and shared memory
