# Chroma Memory MCP

An MCP server that gives Claude (and any MCP client) a shared team knowledge base with semantic search. Backed by ChromaDB and Google Gemini embeddings — works across languages (RU + EN).

## How It Works

The server stores team knowledge as entries in ChromaDB. Each entry has a project, slug, title, content (Markdown), tags, type, and author. When someone asks a question, Claude runs a semantic search and answers with full context. When someone makes a decision worth sharing, they tell Claude to save it — and it's available to every team member.

```
Claude ──MCP──▶ chroma-memory-mcp ──▶ ChromaDB
                      │
                      ▼
              Gemini Embeddings
              (multilingual RU+EN)
```

## Quick Start

### Docker Compose (recommended)

```bash
cd chroma-server

# Set environment variables
export GOOGLE_API_KEY=your-gemini-api-key

# Start ChromaDB + MCP server
docker compose up -d
```

The server is now available at `http://localhost:3000/mcp`.

### Connect Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "chroma-memory": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Connect Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chroma-memory": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## MCP Tools

| Tool | Description | Key params |
|------|-------------|------------|
| `write_entry` | Create a new memory entry | `project`, `slug`, `title`, `content`, `tags?`, `type?` |
| `read_entry` | Read entry by project + slug | `project`, `slug` |
| `update_entry` | Update an existing entry | `project`, `slug`, + fields to change |
| `delete_entry` | Delete an entry | `project`, `slug` |
| `search` | Semantic search across entries | `query`, `project?`, `author?`, `n_results?` |
| `list_entries` | List entries with filters | `project?`, `author?`, `type?` |
| `list_projects` | List all project names | — |

### Entry types

- `note` (default) — general knowledge
- `decision` — architectural or process decisions
- `snippet` — reusable code fragments
- `doc` — documentation and reference material
- `log` — event logs and session records

### Entry ID format

`{project}:{slug}` — for example `mobile-app:auth-decision`.

## Usage Examples

### Save a decision

> "Remember for the team: we chose PostgreSQL over MongoDB for ACID compliance."

Claude calls `write_entry` with project, slug, title, content, and tags.

### Search memory

> "What did we decide about authentication?"

Claude calls `search` with the query, reviews results, and answers with context.

### Browse a project

> "What's in our project memory?"

Claude calls `list_projects`, then `list_entries` for the relevant project.

## Configuration

Environment variables for the MCP server:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CHROMA_URL` | No | `http://localhost:8000` | ChromaDB connection URL |
| `CHROMA_COLLECTION` | No | `memories` | ChromaDB collection name |
| `GOOGLE_API_KEY` | Yes | — | Gemini API key for embeddings |
| `MCP_PORT` | No | `3000` | Server port |
| `MCP_HOST` | No | `0.0.0.0` | Server bind address |
| `MCP_BASE_URL` | No* | — | Public HTTPS URL (required for OAuth) |
| `GOOGLE_CLIENT_ID` | No* | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No* | — | Google OAuth client secret |

*OAuth is optional. Without it, the server runs in dev mode (no auth).

## Authentication

For production deployments, enable Google OAuth2:

1. Create OAuth credentials in Google Cloud Console
2. Set `MCP_BASE_URL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`
3. The server adds OAuth endpoints automatically (`/.well-known/oauth-authorization-server`, etc.)
4. Each user authenticates with their Google account — their email becomes the `author` field

Without OAuth (dev mode), the server accepts all requests and sets author to `anonymous`.

## Deployment

### Docker Compose

```yaml
services:
  chromadb:
    image: chromadb/chroma:1.5.2
    volumes:
      - chroma-data:/data

  mcp-server:
    build: ./chroma-server
    ports:
      - "3000:3000"
    environment:
      - CHROMA_URL=http://chromadb:8000
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
    depends_on:
      - chromadb
    restart: on-failure

volumes:
  chroma-data:
```

### Kubernetes (Helm)

A Helm chart is included in `chroma-server/helm/chroma-memory-mcp/`.

```bash
helm install chroma-memory ./chroma-server/helm/chroma-memory-mcp \
  --set googleApiKey=YOUR_KEY \
  --set googleClientId=YOUR_CLIENT_ID \
  --set googleClientSecret=YOUR_SECRET
```

## Tech Stack

| Dependency | Purpose |
|------------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework (Streamable HTTP transport) |
| `chromadb` v3 | Vector database client |
| `@chroma-core/google-gemini` | Gemini embedding function |
| `express` v5 | HTTP server |
| `google-auth-library` | OAuth2 authentication |
| `zod` | Input schema validation |

## Project Structure

```
chroma-server/
├── server.js                 # MCP server + Express app
├── lib/
│   ├── memory-store.js       # ChromaDB wrapper (CRUD + search)
│   ├── auth.js               # Email extraction from auth info
│   └── oauth-provider.js     # Google OAuth2 provider
├── test/                     # Unit + integration tests (Vitest)
├── docker-compose.yml        # Local development
├── docker-compose.test.yml   # Integration test environment
├── Dockerfile                # Production image (node:20-slim)
└── helm/                     # Kubernetes Helm chart
skills/
└── chroma-memory/
    └── SKILL.md              # Claude skill for using the MCP tools
```

## Development

```bash
cd chroma-server
npm install

# Run unit tests
npm test

# Run integration tests (requires Docker)
docker compose -f docker-compose.test.yml up -d
npm run test:integration
docker compose -f docker-compose.test.yml down
```

## License

MIT
