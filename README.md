# Chroma Memory MCP

An MCP server that gives Claude (and any MCP client) a shared team knowledge base with semantic search. Backed by ChromaDB and Google Gemini embeddings — works across languages (RU + EN).

## How It Works

The server stores team knowledge as entries in ChromaDB. Each entry has a project, slug, title, content (Markdown), tags, type, and author. When someone asks a question, Claude runs a semantic search and answers with full context. When someone makes a decision worth sharing, they tell Claude to save it — and it's available to every team member.

```text
Claude ──MCP──▶ chroma-memory-mcp ──▶ ChromaDB
                      │
                      ▼
              Gemini Embeddings
              (multilingual RU+EN)
```

## Quick Start

### 1. Start the server

```bash
cd chroma-server
export GOOGLE_API_KEY=your-gemini-api-key
docker compose up -d
```

The server is now available at `http://localhost:3000/mcp`.

### 2. Connect Claude Code

Add `.mcp.json` to your project root:

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

### 3. Connect Claude Desktop

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

| Tool            | Description                    | Key params                                          |
| --------------- | ------------------------------ | --------------------------------------------------- |
| `write_entry`   | Create a new memory entry      | `project`, `slug`, `title`, `content`, `tags?`, `type?` |
| `read_entry`    | Read entry by project + slug   | `project`, `slug`                                   |
| `update_entry`  | Update an existing entry       | `project`, `slug`, + fields to change               |
| `delete_entry`  | Delete an entry                | `project`, `slug`                                   |
| `search`        | Semantic search across entries | `query`, `project?`, `author?`, `n_results?`        |
| `list_entries`  | List entries with filters      | `project?`, `author?`, `type?`                      |
| `list_projects` | List all project names         | —                                                   |

### Entry types

- `note` (default) — general knowledge
- `decision` — architectural or process decisions
- `snippet` — reusable code fragments
- `doc` — documentation and reference material
- `log` — event logs and session records

### Entry ID format

`{project}:{slug}` — for example `mobile-app:auth-decision`.

## Configuration

| Variable               | Required | Default              | Description                         |
| ---------------------- | -------- | -------------------- | ----------------------------------- |
| `GOOGLE_API_KEY`       | Yes      | —                    | Gemini API key for embeddings       |
| `CHROMA_URL`           | No       | `http://localhost:8000` | ChromaDB connection URL          |
| `CHROMA_COLLECTION`    | No       | `memories`           | ChromaDB collection name            |
| `MCP_PORT`             | No       | `3000`               | Server port                         |
| `MCP_HOST`             | No       | `0.0.0.0`            | Server bind address                 |
| `MCP_BASE_URL`         | No*      | —                    | Public HTTPS URL (required for OAuth) |
| `GOOGLE_CLIENT_ID`     | No*      | —                    | Google OAuth client ID              |
| `GOOGLE_CLIENT_SECRET` | No*      | —                    | Google OAuth client secret          |

*OAuth is optional. Without it, the server runs in dev mode (no auth).
Without `GOOGLE_API_KEY`, semantic search is disabled (CRUD still works).

## Deployment

### Local (Docker Compose)

```bash
cd chroma-server
export GOOGLE_API_KEY=your-gemini-api-key
docker compose up -d
```

This starts ChromaDB + MCP server. Data persists in a Docker volume `chroma-data`.

### Production (Docker Compose + OAuth)

```bash
cd chroma-server
export GOOGLE_API_KEY=your-gemini-api-key
export GOOGLE_CLIENT_ID=your-client-id
export GOOGLE_CLIENT_SECRET=your-client-secret
export MCP_BASE_URL=https://memory.example.com
docker compose up -d
```

With OAuth enabled, each user authenticates via Google — their email becomes the `author` field on entries.

### Kubernetes (Helm)

A Helm chart is included in `chroma-server/helm/chroma-memory-mcp/`. It deploys:
- MCP server (Node.js) — Deployment + Service
- ChromaDB — Deployment + PVC + Service
- Ingress with TLS (cert-manager + Let's Encrypt)
- Secrets for API keys

#### Prerequisites

- Kubernetes cluster with nginx ingress controller
- cert-manager with a ClusterIssuer (for TLS)
- DNS record pointing your domain to the cluster

#### Install

```bash
helm install chroma-memory ./chroma-server/helm/chroma-memory-mcp \
  --set secrets.googleApiKey=YOUR_GEMINI_API_KEY \
  --set secrets.googleClientId=YOUR_GOOGLE_CLIENT_ID \
  --set secrets.googleClientSecret=YOUR_GOOGLE_CLIENT_SECRET \
  --set ingress.host=memory.example.com
```

#### Key Helm values

```yaml
# Namespace for all resources
namespace: chroma-memory

# MCP server
mcp:
  image:
    repository: sfrangulov/chroma-memory-mcp
    tag: "0.1.2"
  replicas: 1
  port: 3000

# ChromaDB
chromadb:
  image:
    repository: chromadb/chroma
    tag: "1.5.2"
  persistence:
    size: 5Gi
    storageClass: microk8s-hostpath

# Ingress
ingress:
  enabled: true
  className: public
  host: memory.example.com
  tls:
    enabled: true
    clusterIssuer: lets-encrypt
```

#### Upgrade

```bash
# Build new Docker image
cd chroma-server
docker build --platform linux/amd64 -t sfrangulov/chroma-memory-mcp:0.x.x .
docker push sfrangulov/chroma-memory-mcp:0.x.x

# Update Helm release
helm upgrade chroma-memory ./chroma-server/helm/chroma-memory-mcp \
  --set mcp.image.tag=0.x.x \
  --reuse-values
```

#### Nginx ingress notes

The Helm chart configures nginx annotations for MCP streaming:
- `proxy-buffering: off` — required for Streamable HTTP transport
- `proxy-read-timeout: 3600` — long-lived connections
- `proxy-body-size: 16m` — large entries

### Building the Docker image

```bash
cd chroma-server

# For local use
docker build -t chroma-memory-mcp .

# For Kubernetes (must be linux/amd64)
docker build --platform linux/amd64 -t sfrangulov/chroma-memory-mcp:0.x.x .
docker push sfrangulov/chroma-memory-mcp:0.x.x
```

## Authentication

For production deployments, enable Google OAuth2:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add authorized redirect URI: `https://your-domain.com/oauth/google/callback`
4. Enable the **Generative Language API** (for Gemini embeddings)
5. Create an **API Key** (restrict to Generative Language API)
6. Set `MCP_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_API_KEY`

The server automatically exposes OAuth discovery endpoints:
- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`

Without OAuth (dev mode), the server accepts all requests and sets author to `anonymous`.

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

## Tech Stack

| Dependency                    | Purpose                                      |
| ----------------------------- | -------------------------------------------- |
| `@modelcontextprotocol/sdk`   | MCP server framework (Streamable HTTP)       |
| `chromadb` v3                 | Vector database client                       |
| `@chroma-core/google-gemini`  | Gemini embedding function                    |
| `express` v5                  | HTTP server                                  |
| `google-auth-library`         | OAuth2 authentication                        |
| `zod`                         | Input schema validation                      |

## Project Structure

```text
chroma-server/
├── server.js                 # MCP server + Express app
├── lib/
│   ├── memory-store.js       # ChromaDB wrapper (CRUD + search)
│   ├── auth.js               # Email extraction from auth info
│   └── oauth-provider.js     # Google OAuth2 provider
├── test/                     # Unit + integration tests (Vitest)
├── Dockerfile                # Production image (node:20-slim)
├── docker-compose.yml        # Local development
├── docker-compose.test.yml   # Integration test environment
└── helm/                     # Kubernetes Helm chart
    └── chroma-memory-mcp/
        ├── Chart.yaml
        ├── values.yaml
        └── templates/
skills/
└── chroma-memory/
    └── SKILL.md              # Claude skill for using the MCP tools
docs/
└── plans/                    # Design and implementation docs
```

## Development

```bash
cd chroma-server
npm install

# Run unit tests
npm test

# Run integration tests (requires Docker)
docker compose -f docker-compose.test.yml up -d --wait
npm run test:integration
docker compose -f docker-compose.test.yml down
```

## License

MIT
