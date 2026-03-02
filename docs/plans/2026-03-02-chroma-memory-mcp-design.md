# Design: Chroma Memory MCP Server

**Date:** 2026-03-02
**Status:** Approved
**Replaces:** GitHub-based shared-memory-mcp (kept as legacy)

---

## Problem

The GitHub-based shared memory plugin has fundamental limitations:
- No semantic search (GitHub Search API: 10 req/min, 30-60s indexing delay)
- Linear scaling issues (author search reads ALL files)
- root.md as single point of failure
- 200-800ms per API call latency

## Solution

New MCP server backed by ChromaDB — a vector database providing native semantic search, fast queries, and team-wide shared access.

## Architecture

```
Team Server (Docker)                    Each Team Member
┌─────────────────────────────┐        ┌────────────────┐
│  docker-compose             │        │  Claude Desktop │
│  ┌─────────┐ ┌────────────┐│  HTTP  │  (Connectors)  │
│  │ChromaDB │ │ MCP Server ││◄───────│                │
│  │ :8000   │ │ :3000      ││        └────────────────┘
│  │ /data   │ │ Streamable ││
│  │         │ │ HTTP       ││
│  └─────────┘ └────────────┘│
└─────────────────────────────┘
         │              │
         │              ├── Google OAuth2 (JWT validation)
         │              └── Google Gemini (embeddings)
         └── Persistent volume
```

**Key decisions:**
- ChromaDB replaces GitHub as storage (text + embeddings + metadata)
- MCP server runs in Docker alongside ChromaDB (one docker-compose for the team)
- Streamable HTTP transport (SSE deprecated in MCP spec)
- Google OAuth2 for user authentication (email = author identity)
- Google Gemini text-embedding-004 for multilingual embeddings (RU + EN)
- No root.md, no atomic commits, no GitHub API — ChromaDB handles everything

## Data Model

**ChromaDB Collection: `memories`**

| Field | Type | Example |
|-------|------|---------|
| id | string | `"backend:postgres-optimization"` |
| document | string | Full entry text (markdown) |
| embedding | float[] | Auto-generated from document |
| metadata.project | string | `"backend"` |
| metadata.title | string | `"PostgreSQL Query Optimization"` |
| metadata.author | string | `"sergei@gmail.com"` (from OAuth JWT) |
| metadata.tags | string | `"postgres,performance,sql"` |
| metadata.created_at | string | `"2026-03-02T10:00:00Z"` |
| metadata.updated_at | string | `"2026-03-02T10:00:00Z"` |
| metadata.type | string | `"decision"` / `"note"` / `"guide"` |

## MCP Tools (7)

| # | Tool | Description |
|---|------|-------------|
| 1 | `write_entry` | Create entry (auto-embed, dedup check via ID) |
| 2 | `read_entry` | Read entry by project + slug |
| 3 | `update_entry` | Update entry (re-embed on change) |
| 4 | `delete_entry` | Delete entry by ID |
| 5 | `search` | Semantic search (query → embedding → cosine similarity) + metadata filters |
| 6 | `list_entries` | List entries in project (metadata filter: author, tags, type) |
| 7 | `list_projects` | List all projects (distinct metadata.project values) |

**Removed vs GitHub version:**
- `connect_repo` — not needed (ChromaDB connection via env vars)
- `search_tags` — covered by `search` with `where: { tags: { $contains: "..." } }`
- `search_author` — covered by `list_entries` with `where: { author: "..." }`
- `search_deep` — replaced by `search` (semantic)
- `set_author` — removed, author determined from OAuth JWT

## Authentication

**OAuth2 via Google:**

1. MCP server = Resource Server (validates Google JWTs)
2. Claude Desktop opens browser → Google Sign-In
3. User authenticates → JWT issued
4. MCP server extracts `email` from JWT → author identity
5. No need for external auth server container (Keycloak/Auth0)

**MCP spec compliance:**
- OAuth 2.1 with PKCE (as per MCP spec 2025-11-25)
- Protected Resource Metadata at `/.well-known/oauth-protected-resource`
- Bearer token validation via `google-auth-library`

## Configuration

**docker-compose.yml:**

```yaml
services:
  chromadb:
    image: chromadb/chroma:1.5.2
    volumes:
      - chroma-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v2/heartbeat"]
      interval: 30s
      timeout: 10s
      retries: 3

  mcp-server:
    image: sfrangulov/chroma-memory-mcp:latest
    ports:
      - "3000:3000"
    environment:
      - CHROMA_URL=http://chromadb:8000
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
      - EMBEDDING_PROVIDER=google
    depends_on:
      chromadb:
        condition: service_healthy

volumes:
  chroma-data:
```

**Claude Desktop config (each team member):**

```json
{
  "mcpServers": {
    "shared-memory": {
      "url": "http://team-server:3000/mcp"
    }
  }
}
```

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | >= 20 |
| MCP SDK | @modelcontextprotocol/sdk | latest |
| HTTP framework | Express | latest |
| ChromaDB client | chromadb | ^3.3 |
| Embeddings | @chroma-core/google-gemini | latest |
| OAuth validation | google-auth-library | latest |
| Schema validation | zod | ^3.24 |
| Testing | vitest | ^3 |
| Container | Docker | chromadb/chroma:1.5.2 |

## npm Package

- **Name:** `@sfrangulov/chroma-memory-mcp`
- **bin:** `chroma-memory-mcp`
- **Includes:** Dockerfile, docker-compose.yml template
- **Supports:** Docker deployment (primary) + local stdio (development)

## Error Handling

| Scenario | Behavior |
|----------|----------|
| ChromaDB unavailable | Graceful error, `retry_possible: true` |
| Google API unavailable | Fallback to keyword search (without embeddings) |
| Duplicate entry | Check by `project:slug` ID, warn user |
| OAuth token invalid | 401 Unauthorized |
| OAuth token expired | 401 with refresh hint |

## Testing Strategy

- **Unit tests:** Mock ChromaDB client, test tool logic
- **Integration tests:** Real ChromaDB in Docker (testcontainers)
- **E2E tests:** Full cycle write → search → read → delete
- **Auth tests:** JWT validation, user identity extraction

## Migration from GitHub Version

Not planned. New project, clean start. GitHub version remains as legacy/portfolio piece.
