# Chroma Memory MCP

MCP server for shared team memory with semantic search, backed by ChromaDB. Uses Google Gemini embeddings for multilingual search (EN + RU) and Google OAuth2 for per-user authentication.

## Quick Start

### Docker Compose (recommended)

```bash
git clone https://github.com/sfrangulov/claude-shared-memory-plugin
cd claude-shared-memory-plugin/chroma-server

# Set required environment variables
export GOOGLE_CLIENT_ID="your-google-oauth2-client-id"
export GOOGLE_API_KEY="your-google-api-key"

docker compose up -d
```

### npx

```bash
# Requires a running ChromaDB instance
npx @sfrangulov/chroma-memory-mcp
```

## Claude Desktop Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "team-memory": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_GOOGLE_ID_TOKEN"
      }
    }
  }
}
```

## Google Cloud Setup

1. Create a project at [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Generative Language API** (for Gemini embeddings)
3. Create an **API Key** (restrict to Generative Language API)
4. Create an **OAuth 2.0 Client ID** (Web application type)
5. Set the Client ID and API Key as environment variables

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | For auth | — | Google OAuth2 Client ID for JWT verification |
| `GOOGLE_API_KEY` | For search | — | Google API Key for Gemini embeddings |
| `MCP_BASE_URL` | For auth | — | Public HTTPS URL (e.g. `https://memory.example.com`) |
| `CHROMA_URL` | No | `http://localhost:8000` | ChromaDB connection URL |
| `CHROMA_COLLECTION` | No | `memories` | ChromaDB collection name |
| `MCP_PORT` | No | `3000` | Server port |
| `MCP_HOST` | No | `0.0.0.0` | Server bind address |

Without `MCP_BASE_URL` and `GOOGLE_CLIENT_ID`, the server runs in dev mode (no auth).
Without `GOOGLE_API_KEY`, semantic search is disabled (CRUD still works).

## MCP Tools

| Tool | Description |
|------|-------------|
| `write_entry` | Create a new memory entry with project, slug, title, content, tags, and type |
| `read_entry` | Read a memory entry by project and slug |
| `update_entry` | Update an existing entry's content, title, tags, or type |
| `delete_entry` | Delete a memory entry |
| `search` | Semantic search across entries with optional project/author filters |
| `list_entries` | List entries with optional project, author, and type filters |
| `list_projects` | List all unique project names |

## Development

```bash
npm install
npm test                # Unit tests
npm run test:integration # Integration tests (requires ChromaDB on port 8100)
```

### Running integration tests

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm run test:integration
docker compose -f docker-compose.test.yml down
```

## License

MIT
