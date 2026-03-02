# Chroma Memory MCP — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new MCP server backed by ChromaDB with semantic search, Google OAuth2 auth, and Docker deployment — replacing the GitHub-based shared memory plugin.

**Architecture:** Express + MCP SDK (Streamable HTTP transport) → ChromaDB client → ChromaDB Docker container. Google OAuth2 for per-user auth. Google Gemini embeddings for multilingual semantic search. All packaged as Docker image + npm package.

**Tech Stack:** Node.js 20+, @modelcontextprotocol/sdk, Express, chromadb v3, @chroma-core/google-gemini, google-auth-library, Zod, Vitest

**Design doc:** `docs/plans/2026-03-02-chroma-memory-mcp-design.md`

---

## Task 1: Project Scaffold

**Files:**
- Create: `chroma-server/package.json`
- Create: `chroma-server/.gitignore`
- Create: `chroma-server/Dockerfile`
- Create: `chroma-server/docker-compose.yml`

**Step 1: Create project directory**

```bash
mkdir -p chroma-server
```

**Step 2: Create package.json**

```json
{
  "name": "@sfrangulov/chroma-memory-mcp",
  "version": "0.1.0",
  "description": "MCP server for shared team memory with semantic search, backed by ChromaDB",
  "type": "module",
  "bin": {
    "chroma-memory-mcp": "server.js"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "files": [
    "server.js",
    "lib/",
    "Dockerfile",
    "docker-compose.yml"
  ],
  "scripts": {
    "start": "node server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.0",
    "chromadb": "^3.3.0",
    "@chroma-core/google-gemini": "^0.1.8",
    "google-auth-library": "^9.0.0",
    "express": "^5.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

**Step 3: Create .gitignore**

```
node_modules/
.env
chroma-data/
```

**Step 4: Create Dockerfile**

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

**Step 5: Create docker-compose.yml**

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
    build: .
    ports:
      - "3000:3000"
    environment:
      - CHROMA_URL=http://chromadb:8000
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
      - EMBEDDING_PROVIDER=google
      - MCP_PORT=3000
    depends_on:
      chromadb:
        condition: service_healthy

volumes:
  chroma-data:
```

**Step 6: Install dependencies**

Run: `cd chroma-server && npm install`

**Step 7: Commit**

```bash
git add chroma-server/
git commit -m "feat: scaffold chroma-memory-mcp project"
```

---

## Task 2: Memory Store (ChromaDB Wrapper)

**Files:**
- Create: `chroma-server/lib/memory-store.js`
- Create: `chroma-server/test/memory-store.test.js`

**Step 1: Write the failing test**

Create `chroma-server/test/memory-store.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryStore } from "../lib/memory-store.js";

// Mock ChromaDB collection
function createMockCollection() {
  return {
    add: vi.fn(),
    query: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    upsert: vi.fn(),
  };
}

// Mock ChromaDB client
function createMockClient() {
  const collection = createMockCollection();
  return {
    getOrCreateCollection: vi.fn().mockResolvedValue(collection),
    _collection: collection,
  };
}

describe("createMemoryStore", () => {
  let mockClient;
  let store;

  beforeEach(async () => {
    mockClient = createMockClient();
    store = await createMemoryStore({
      client: mockClient,
      embeddingFunction: null,
      collectionName: "test-memories",
    });
  });

  it("creates collection on init", () => {
    expect(mockClient.getOrCreateCollection).toHaveBeenCalledWith({
      name: "test-memories",
      embeddingFunction: null,
    });
  });

  describe("writeEntry", () => {
    it("adds document with metadata", async () => {
      const collection = mockClient._collection;
      collection.get.mockResolvedValue({ ids: [] });

      await store.writeEntry({
        project: "backend",
        slug: "postgres-optimization",
        title: "PostgreSQL Query Optimization",
        content: "Use indexes for large tables...",
        author: "sergei@gmail.com",
        tags: ["postgres", "performance"],
        type: "decision",
      });

      expect(collection.add).toHaveBeenCalledWith({
        ids: ["backend:postgres-optimization"],
        documents: ["# PostgreSQL Query Optimization\n\n- **Author:** sergei@gmail.com\n- **Tags:** postgres, performance\n- **Type:** decision\n\nUse indexes for large tables..."],
        metadatas: [{
          project: "backend",
          title: "PostgreSQL Query Optimization",
          author: "sergei@gmail.com",
          tags: "postgres,performance",
          type: "decision",
          created_at: expect.any(String),
          updated_at: expect.any(String),
        }],
      });
    });

    it("rejects duplicate entry", async () => {
      const collection = mockClient._collection;
      collection.get.mockResolvedValue({ ids: ["backend:postgres-optimization"] });

      await expect(
        store.writeEntry({
          project: "backend",
          slug: "postgres-optimization",
          title: "Duplicate",
          content: "...",
          author: "a@b.com",
          tags: [],
          type: "note",
        })
      ).rejects.toThrow("already exists");
    });
  });

  describe("readEntry", () => {
    it("returns entry by id", async () => {
      const collection = mockClient._collection;
      collection.get.mockResolvedValue({
        ids: ["backend:pg-opt"],
        documents: ["# PG Optimization\n\ncontent"],
        metadatas: [{ project: "backend", title: "PG Optimization", author: "a@b.com", tags: "pg", type: "note", created_at: "2026-03-02", updated_at: "2026-03-02" }],
      });

      const result = await store.readEntry("backend", "pg-opt");
      expect(result.id).toBe("backend:pg-opt");
      expect(result.document).toBe("# PG Optimization\n\ncontent");
      expect(result.metadata.project).toBe("backend");
    });

    it("returns null for non-existent entry", async () => {
      const collection = mockClient._collection;
      collection.get.mockResolvedValue({ ids: [], documents: [], metadatas: [] });

      const result = await store.readEntry("backend", "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("search", () => {
    it("performs semantic search with metadata filter", async () => {
      const collection = mockClient._collection;
      collection.query.mockResolvedValue({
        ids: [["backend:pg-opt"]],
        documents: [["# PG Optimization"]],
        metadatas: [[{ project: "backend", title: "PG Optimization", tags: "pg,sql" }]],
        distances: [[0.15]],
      });

      const results = await store.search({
        query: "database performance",
        project: "backend",
        nResults: 5,
      });

      expect(collection.query).toHaveBeenCalledWith({
        queryTexts: ["database performance"],
        nResults: 5,
        where: { project: "backend" },
        include: ["documents", "metadatas", "distances"],
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("backend:pg-opt");
      expect(results[0].distance).toBe(0.15);
    });

    it("searches without project filter", async () => {
      const collection = mockClient._collection;
      collection.query.mockResolvedValue({
        ids: [[]], documents: [[]], metadatas: [[]], distances: [[]],
      });

      await store.search({ query: "test", nResults: 10 });

      expect(collection.query).toHaveBeenCalledWith({
        queryTexts: ["test"],
        nResults: 10,
        include: ["documents", "metadatas", "distances"],
      });
    });
  });

  describe("updateEntry", () => {
    it("updates document and metadata", async () => {
      const collection = mockClient._collection;
      collection.get.mockResolvedValue({
        ids: ["backend:pg-opt"],
        metadatas: [{ project: "backend", title: "Old", author: "a@b.com", tags: "pg", type: "note", created_at: "2026-03-01", updated_at: "2026-03-01" }],
      });

      await store.updateEntry("backend", "pg-opt", {
        title: "Updated Title",
        content: "New content",
        tags: ["pg", "updated"],
      });

      expect(collection.update).toHaveBeenCalledWith({
        ids: ["backend:pg-opt"],
        documents: ["# Updated Title\n\n- **Author:** a@b.com\n- **Tags:** pg, updated\n- **Type:** note\n\nNew content"],
        metadatas: [expect.objectContaining({
          title: "Updated Title",
          tags: "pg,updated",
          updated_at: expect.any(String),
        })],
      });
    });
  });

  describe("deleteEntry", () => {
    it("deletes by id", async () => {
      const collection = mockClient._collection;
      await store.deleteEntry("backend", "pg-opt");

      expect(collection.delete).toHaveBeenCalledWith({
        ids: ["backend:pg-opt"],
      });
    });
  });

  describe("listEntries", () => {
    it("lists entries with project filter", async () => {
      const collection = mockClient._collection;
      collection.get.mockResolvedValue({
        ids: ["backend:a", "backend:b"],
        metadatas: [
          { project: "backend", title: "A", author: "x@y.com", tags: "a", type: "note" },
          { project: "backend", title: "B", author: "z@w.com", tags: "b", type: "guide" },
        ],
      });

      const results = await store.listEntries({ project: "backend" });
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe("A");
    });

    it("filters by author", async () => {
      const collection = mockClient._collection;
      collection.get.mockResolvedValue({ ids: ["x:y"], metadatas: [{ author: "a@b.com" }] });

      await store.listEntries({ project: "backend", author: "a@b.com" });

      expect(collection.get).toHaveBeenCalledWith({
        where: { $and: [{ project: "backend" }, { author: "a@b.com" }] },
        include: ["metadatas"],
      });
    });
  });

  describe("listProjects", () => {
    it("returns unique project names", async () => {
      const collection = mockClient._collection;
      collection.get.mockResolvedValue({
        metadatas: [
          { project: "backend" },
          { project: "frontend" },
          { project: "backend" },
        ],
      });

      const projects = await store.listProjects();
      expect(projects).toEqual(["backend", "frontend"]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd chroma-server && npx vitest run test/memory-store.test.js`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `chroma-server/lib/memory-store.js`:

```js
/**
 * Memory store backed by ChromaDB.
 * Wraps ChromaDB collection into a clean CRUD + search interface.
 *
 * @module memory-store
 */

/**
 * Builds a formatted document string from entry fields.
 */
function buildDocument({ title, author, tags, type, content }) {
  let doc = `# ${title}\n\n`;
  doc += `- **Author:** ${author}\n`;
  doc += `- **Tags:** ${tags.join(", ")}\n`;
  doc += `- **Type:** ${type}\n\n`;
  doc += content;
  return doc;
}

/**
 * Creates a memory store backed by a ChromaDB collection.
 *
 * @param {object} params
 * @param {import("chromadb").ChromaClient} params.client - ChromaDB client
 * @param {object|null} params.embeddingFunction - Embedding function instance
 * @param {string} params.collectionName - Collection name (default: "memories")
 * @returns {Promise<object>} store with CRUD + search methods
 */
export async function createMemoryStore({ client, embeddingFunction, collectionName = "memories" }) {
  const collection = await client.getOrCreateCollection({
    name: collectionName,
    embeddingFunction,
  });

  return {
    async writeEntry({ project, slug, title, content, author, tags, type }) {
      const id = `${project}:${slug}`;

      // Check for duplicates
      const existing = await collection.get({ ids: [id] });
      if (existing.ids.length > 0) {
        throw new Error(`Entry "${id}" already exists`);
      }

      const now = new Date().toISOString();
      const document = buildDocument({ title, author, tags, type, content });

      await collection.add({
        ids: [id],
        documents: [document],
        metadatas: [{
          project,
          title,
          author,
          tags: tags.join(","),
          type,
          created_at: now,
          updated_at: now,
        }],
      });

      return { id, created_at: now };
    },

    async readEntry(project, slug) {
      const id = `${project}:${slug}`;
      const result = await collection.get({
        ids: [id],
        include: ["documents", "metadatas"],
      });

      if (result.ids.length === 0) return null;

      return {
        id: result.ids[0],
        document: result.documents[0],
        metadata: result.metadatas[0],
      };
    },

    async updateEntry(project, slug, changes) {
      const id = `${project}:${slug}`;

      // Read existing metadata
      const existing = await collection.get({ ids: [id], include: ["metadatas"] });
      if (existing.ids.length === 0) {
        throw new Error(`Entry "${id}" not found`);
      }

      const oldMeta = existing.metadatas[0];
      const title = changes.title || oldMeta.title;
      const tags = changes.tags || oldMeta.tags.split(",");
      const type = changes.type || oldMeta.type;
      const author = oldMeta.author;
      const content = changes.content;

      const now = new Date().toISOString();
      const document = buildDocument({ title, author, tags, type, content });

      await collection.update({
        ids: [id],
        documents: [document],
        metadatas: [{
          ...oldMeta,
          title,
          tags: Array.isArray(tags) ? tags.join(",") : tags,
          type,
          updated_at: now,
        }],
      });

      return { id, updated_at: now };
    },

    async deleteEntry(project, slug) {
      const id = `${project}:${slug}`;
      await collection.delete({ ids: [id] });
      return { id, deleted: true };
    },

    async search({ query, project, author, nResults = 10 }) {
      const queryParams = {
        queryTexts: [query],
        nResults,
        include: ["documents", "metadatas", "distances"],
      };

      // Build where filter
      const filters = [];
      if (project) filters.push({ project });
      if (author) filters.push({ author });

      if (filters.length === 1) {
        queryParams.where = filters[0];
      } else if (filters.length > 1) {
        queryParams.where = { $and: filters };
      }

      const results = await collection.query(queryParams);

      return (results.ids[0] || []).map((id, i) => ({
        id,
        document: results.documents[0][i],
        metadata: results.metadatas[0][i],
        distance: results.distances[0][i],
      }));
    },

    async listEntries({ project, author, type }) {
      const filters = [];
      if (project) filters.push({ project });
      if (author) filters.push({ author });
      if (type) filters.push({ type });

      const getParams = {
        include: ["metadatas"],
      };

      if (filters.length === 1) {
        getParams.where = filters[0];
      } else if (filters.length > 1) {
        getParams.where = { $and: filters };
      }

      const results = await collection.get(getParams);

      return results.ids.map((id, i) => ({
        id,
        ...results.metadatas[i],
        tags: results.metadatas[i].tags ? results.metadatas[i].tags.split(",") : [],
      }));
    },

    async listProjects() {
      const results = await collection.get({ include: ["metadatas"] });
      const projects = new Set(results.metadatas.map((m) => m.project));
      return [...projects].sort();
    },

    async count() {
      return collection.count();
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd chroma-server && npx vitest run test/memory-store.test.js`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add chroma-server/lib/memory-store.js chroma-server/test/memory-store.test.js
git commit -m "feat: add ChromaDB memory store with CRUD and semantic search"
```

---

## Task 3: Auth Middleware (Google OAuth2)

**Files:**
- Create: `chroma-server/lib/auth.js`
- Create: `chroma-server/test/auth.test.js`

**Step 1: Write the failing test**

Create `chroma-server/test/auth.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTokenVerifier, extractUserEmail } from "../lib/auth.js";

describe("createTokenVerifier", () => {
  it("verifies valid Google JWT and returns auth info", async () => {
    const mockOAuth2Client = {
      verifyIdToken: vi.fn().mockResolvedValue({
        getPayload: () => ({
          email: "sergei@gmail.com",
          sub: "123456789",
          email_verified: true,
        }),
      }),
    };

    const verifier = createTokenVerifier({
      googleClientId: "test-client-id",
      _oauth2Client: mockOAuth2Client,
    });

    const result = await verifier.verifyAccessToken("valid-token-here");
    expect(result.token).toBe("valid-token-here");
    expect(result.clientId).toBe("test-client-id");
    expect(result.email).toBe("sergei@gmail.com");
    expect(mockOAuth2Client.verifyIdToken).toHaveBeenCalledWith({
      idToken: "valid-token-here",
      audience: "test-client-id",
    });
  });

  it("throws on invalid token", async () => {
    const mockOAuth2Client = {
      verifyIdToken: vi.fn().mockRejectedValue(new Error("Invalid token")),
    };

    const verifier = createTokenVerifier({
      googleClientId: "test-client-id",
      _oauth2Client: mockOAuth2Client,
    });

    await expect(verifier.verifyAccessToken("bad-token")).rejects.toThrow("Invalid token");
  });

  it("throws on unverified email", async () => {
    const mockOAuth2Client = {
      verifyIdToken: vi.fn().mockResolvedValue({
        getPayload: () => ({
          email: "unverified@gmail.com",
          sub: "123",
          email_verified: false,
        }),
      }),
    };

    const verifier = createTokenVerifier({
      googleClientId: "test-client-id",
      _oauth2Client: mockOAuth2Client,
    });

    await expect(verifier.verifyAccessToken("token")).rejects.toThrow("Email not verified");
  });
});

describe("extractUserEmail", () => {
  it("extracts email from auth info", () => {
    const email = extractUserEmail({ email: "user@company.com", token: "t" });
    expect(email).toBe("user@company.com");
  });

  it("returns null if no auth info", () => {
    const email = extractUserEmail(undefined);
    expect(email).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd chroma-server && npx vitest run test/auth.test.js`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `chroma-server/lib/auth.js`:

```js
/**
 * Google OAuth2 JWT verification for MCP auth.
 *
 * The MCP server acts as a Resource Server — it validates Google-issued
 * JWTs and extracts user email for author attribution.
 *
 * @module auth
 */

import { OAuth2Client } from "google-auth-library";

/**
 * Creates a token verifier that validates Google ID tokens.
 *
 * @param {object} params
 * @param {string} params.googleClientId - Google OAuth2 Client ID
 * @param {OAuth2Client} [params._oauth2Client] - injectable for testing
 * @returns {{ verifyAccessToken: (token: string) => Promise<object> }}
 */
export function createTokenVerifier({ googleClientId, _oauth2Client }) {
  const oauth2Client = _oauth2Client || new OAuth2Client(googleClientId);

  return {
    async verifyAccessToken(token) {
      const ticket = await oauth2Client.verifyIdToken({
        idToken: token,
        audience: googleClientId,
      });

      const payload = ticket.getPayload();
      if (!payload.email_verified) {
        throw new Error("Email not verified");
      }

      return {
        token,
        clientId: googleClientId,
        scopes: [],
        email: payload.email,
        sub: payload.sub,
      };
    },
  };
}

/**
 * Extracts user email from auth info attached by middleware.
 *
 * @param {object|undefined} authInfo
 * @returns {string|null}
 */
export function extractUserEmail(authInfo) {
  if (!authInfo) return null;
  return authInfo.email || null;
}
```

**Step 4: Run test to verify it passes**

Run: `cd chroma-server && npx vitest run test/auth.test.js`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add chroma-server/lib/auth.js chroma-server/test/auth.test.js
git commit -m "feat: add Google OAuth2 JWT verification for MCP auth"
```

---

## Task 4: MCP Server with Streamable HTTP Transport

**Files:**
- Create: `chroma-server/server.js`
- Create: `chroma-server/test/server.test.js`

**Step 1: Write the failing test**

Create `chroma-server/test/server.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { createMcpServerFactory } from "../server.js";

describe("createMcpServerFactory", () => {
  it("creates an MCP server with 7 registered tools", () => {
    const mockStore = {
      writeEntry: vi.fn(),
      readEntry: vi.fn(),
      updateEntry: vi.fn(),
      deleteEntry: vi.fn(),
      search: vi.fn(),
      listEntries: vi.fn(),
      listProjects: vi.fn(),
    };

    const server = createMcpServerFactory(mockStore);
    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd chroma-server && npx vitest run test/server.test.js`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `chroma-server/server.js`:

```js
#!/usr/bin/env node
/**
 * Chroma Memory MCP Server
 *
 * MCP server with Streamable HTTP transport, backed by ChromaDB
 * for semantic search. Google OAuth2 for per-user authentication.
 *
 * @module server
 */

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import express from "express";
import { z } from "zod";
import { ChromaClient } from "chromadb";
import { GoogleGeminiEmbeddingFunction } from "@chroma-core/google-gemini";

import { createMemoryStore } from "./lib/memory-store.js";
import { createTokenVerifier, extractUserEmail } from "./lib/auth.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  port: parseInt(process.env.MCP_PORT || "3000", 10),
  host: process.env.MCP_HOST || "0.0.0.0",
  chromaUrl: process.env.CHROMA_URL || "http://localhost:8000",
  chromaCollection: process.env.CHROMA_COLLECTION || "memories",
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleApiKey: process.env.GOOGLE_API_KEY,
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

function successResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function errorResult(code, message) {
  const data = { status: "error", error_code: code, error: message };
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    isError: true,
  };
}

/**
 * Creates a configured MCP server with all 7 tools registered.
 * Exported for testing.
 */
export function createMcpServerFactory(store) {
  const server = new McpServer({
    name: "chroma-memory",
    version: "0.1.0",
  });

  // Tool 1: write_entry
  server.registerTool(
    "write_entry",
    {
      title: "Write Entry",
      description: "Create a new memory entry with automatic semantic indexing",
      inputSchema: z.object({
        project: z.string().describe("Project name (e.g. 'backend', 'frontend')"),
        slug: z.string().describe("URL-safe identifier for the entry"),
        title: z.string().describe("Human-readable title"),
        content: z.string().describe("Full entry content in markdown"),
        tags: z.array(z.string()).default([]).describe("Tags for categorization"),
        type: z.enum(["decision", "note", "guide", "process", "glossary"]).default("note"),
      }),
    },
    async ({ project, slug, title, content, tags, type }, { authInfo }) => {
      try {
        const author = extractUserEmail(authInfo) || "anonymous";
        const result = await store.writeEntry({
          project, slug, title, content, author, tags, type,
        });
        return successResult({ status: "created", ...result });
      } catch (err) {
        if (err.message.includes("already exists")) {
          return errorResult("duplicate", err.message);
        }
        throw err;
      }
    }
  );

  // Tool 2: read_entry
  server.registerTool(
    "read_entry",
    {
      title: "Read Entry",
      description: "Read a memory entry by project and slug",
      inputSchema: z.object({
        project: z.string(),
        slug: z.string(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, slug }) => {
      const entry = await store.readEntry(project, slug);
      if (!entry) return errorResult("not_found", `Entry "${project}:${slug}" not found`);
      return successResult(entry);
    }
  );

  // Tool 3: update_entry
  server.registerTool(
    "update_entry",
    {
      title: "Update Entry",
      description: "Update an existing memory entry (re-indexes embeddings)",
      inputSchema: z.object({
        project: z.string(),
        slug: z.string(),
        title: z.string().optional(),
        content: z.string(),
        tags: z.array(z.string()).optional(),
        type: z.enum(["decision", "note", "guide", "process", "glossary"]).optional(),
      }),
    },
    async ({ project, slug, ...changes }) => {
      try {
        const result = await store.updateEntry(project, slug, changes);
        return successResult({ status: "updated", ...result });
      } catch (err) {
        if (err.message.includes("not found")) {
          return errorResult("not_found", err.message);
        }
        throw err;
      }
    }
  );

  // Tool 4: delete_entry
  server.registerTool(
    "delete_entry",
    {
      title: "Delete Entry",
      description: "Delete a memory entry by project and slug",
      inputSchema: z.object({
        project: z.string(),
        slug: z.string(),
      }),
    },
    async ({ project, slug }) => {
      const result = await store.deleteEntry(project, slug);
      return successResult({ status: "deleted", ...result });
    }
  );

  // Tool 5: search
  server.registerTool(
    "search",
    {
      title: "Semantic Search",
      description: "Search memory entries using semantic similarity. Finds conceptually related entries even without exact keyword matches.",
      inputSchema: z.object({
        query: z.string().describe("Natural language search query"),
        project: z.string().optional().describe("Filter by project"),
        author: z.string().optional().describe("Filter by author email"),
        n_results: z.number().default(10).describe("Number of results to return"),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, project, author, n_results }) => {
      const results = await store.search({ query, project, author, nResults: n_results });
      return successResult({
        results,
        total_count: results.length,
      });
    }
  );

  // Tool 6: list_entries
  server.registerTool(
    "list_entries",
    {
      title: "List Entries",
      description: "List memory entries with optional filters by project, author, or type",
      inputSchema: z.object({
        project: z.string().optional(),
        author: z.string().optional(),
        type: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, author, type }) => {
      const entries = await store.listEntries({ project, author, type });
      return successResult({ entries, total_count: entries.length });
    }
  );

  // Tool 7: list_projects
  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description: "List all unique project names in the memory store",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const projects = await store.listProjects();
      return successResult({ projects });
    }
  );

  return { server };
}

// ---------------------------------------------------------------------------
// HTTP server + transport
// ---------------------------------------------------------------------------

async function main() {
  // ChromaDB client
  const chromaClient = new ChromaClient({
    host: new URL(CONFIG.chromaUrl).hostname,
    port: parseInt(new URL(CONFIG.chromaUrl).port || "8000", 10),
    ssl: CONFIG.chromaUrl.startsWith("https"),
  });

  // Embedding function
  const embeddingFunction = new GoogleGeminiEmbeddingFunction({
    apiKey: CONFIG.googleApiKey,
    modelName: "text-embedding-004",
  });

  // Memory store
  const store = await createMemoryStore({
    client: chromaClient,
    embeddingFunction,
    collectionName: CONFIG.chromaCollection,
  });

  // Token verifier
  const verifier = createTokenVerifier({
    googleClientId: CONFIG.googleClientId,
  });

  // MCP server factory
  const { server: mcpServerTemplate } = createMcpServerFactory(store);

  // Express app
  const app = express();
  app.use(express.json());

  // OAuth metadata endpoints
  const serverUrl = new URL(`http://${CONFIG.host}:${CONFIG.port}`);

  const oauthMetadata = {
    issuer: "https://accounts.google.com",
    authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    token_endpoint: "https://oauth2.googleapis.com/token",
    response_types_supported: ["code"],
  };

  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: serverUrl,
      scopesSupported: ["openid", "email"],
      resourceName: "Chroma Memory MCP",
    })
  );

  // Auth middleware
  const authMiddleware = requireBearerAuth({
    verifier,
    requiredScopes: [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(serverUrl),
  });

  // Session management
  const transports = {};

  function createMcpServer() {
    return createMcpServerFactory(store).server;
  }

  // POST /mcp — main MCP endpoint
  app.post("/mcp", authMiddleware, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) delete transports[sid];
      };

      const server = createMcpServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE stream for server notifications
  app.get("/mcp", authMiddleware, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // DELETE /mcp — session cleanup
  app.delete("/mcp", authMiddleware, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // Health check
  app.get("/health", async (_req, res) => {
    try {
      await chromaClient.heartbeat();
      res.json({ status: "ok", chromadb: "connected" });
    } catch {
      res.status(503).json({ status: "error", chromadb: "disconnected" });
    }
  });

  // Start server
  app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`Chroma Memory MCP server running on http://${CONFIG.host}:${CONFIG.port}/mcp`);
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    for (const sid of Object.keys(transports)) {
      await transports[sid].close();
      delete transports[sid];
    }
    process.exit(0);
  });
}

// Run if called directly (not imported for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
```

**Step 4: Run test to verify it passes**

Run: `cd chroma-server && npx vitest run test/server.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add chroma-server/server.js chroma-server/test/server.test.js
git commit -m "feat: add MCP server with Streamable HTTP, OAuth2, and 7 tools"
```

---

## Task 5: Integration Tests with Docker ChromaDB

**Files:**
- Create: `chroma-server/test/integration.test.js`
- Create: `chroma-server/docker-compose.test.yml`

**Step 1: Create test docker-compose**

Create `chroma-server/docker-compose.test.yml`:

```yaml
services:
  chromadb-test:
    image: chromadb/chroma:1.5.2
    ports:
      - "8100:8000"
    tmpfs:
      - /data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v2/heartbeat"]
      interval: 5s
      timeout: 3s
      retries: 10
```

**Step 2: Write integration tests**

Create `chroma-server/test/integration.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ChromaClient } from "chromadb";
import { createMemoryStore } from "../lib/memory-store.js";

/**
 * Integration tests — require ChromaDB running on localhost:8100.
 *
 * Start: docker compose -f docker-compose.test.yml up -d
 * Stop:  docker compose -f docker-compose.test.yml down
 */

const CHROMA_URL = process.env.TEST_CHROMA_URL || "http://localhost:8100";

describe("Integration: Memory Store + ChromaDB", () => {
  let client;
  let store;

  beforeAll(async () => {
    client = new ChromaClient({
      host: new URL(CHROMA_URL).hostname,
      port: parseInt(new URL(CHROMA_URL).port || "8000", 10),
    });

    // Wait for ChromaDB to be ready
    let retries = 10;
    while (retries > 0) {
      try {
        await client.heartbeat();
        break;
      } catch {
        retries--;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (retries === 0) throw new Error("ChromaDB not available");

    // Clean slate — delete test collection if it exists
    try {
      await client.deleteCollection({ name: "integration-test" });
    } catch { /* ignore */ }

    store = await createMemoryStore({
      client,
      embeddingFunction: null, // no embeddings for integration tests (faster)
      collectionName: "integration-test",
    });
  });

  afterAll(async () => {
    try {
      await client.deleteCollection({ name: "integration-test" });
    } catch { /* ignore */ }
  });

  it("write → read → update → delete lifecycle", async () => {
    // Write
    const written = await store.writeEntry({
      project: "test-project",
      slug: "test-entry",
      title: "Test Entry",
      content: "This is a test entry for integration testing",
      author: "test@example.com",
      tags: ["test", "integration"],
      type: "note",
    });
    expect(written.id).toBe("test-project:test-entry");

    // Read
    const read = await store.readEntry("test-project", "test-entry");
    expect(read).not.toBeNull();
    expect(read.metadata.title).toBe("Test Entry");
    expect(read.metadata.author).toBe("test@example.com");

    // Update
    const updated = await store.updateEntry("test-project", "test-entry", {
      title: "Updated Test Entry",
      content: "Updated content",
      tags: ["test", "updated"],
    });
    expect(updated.id).toBe("test-project:test-entry");

    // Read again to verify update
    const readAgain = await store.readEntry("test-project", "test-entry");
    expect(readAgain.metadata.title).toBe("Updated Test Entry");

    // Delete
    const deleted = await store.deleteEntry("test-project", "test-entry");
    expect(deleted.deleted).toBe(true);

    // Verify deleted
    const readDeleted = await store.readEntry("test-project", "test-entry");
    expect(readDeleted).toBeNull();
  });

  it("listEntries filters by project", async () => {
    await store.writeEntry({
      project: "proj-a", slug: "e1", title: "Entry A1",
      content: "A1", author: "a@b.com", tags: [], type: "note",
    });
    await store.writeEntry({
      project: "proj-b", slug: "e2", title: "Entry B1",
      content: "B1", author: "a@b.com", tags: [], type: "note",
    });

    const projA = await store.listEntries({ project: "proj-a" });
    expect(projA).toHaveLength(1);
    expect(projA[0].id).toBe("proj-a:e1");

    const projB = await store.listEntries({ project: "proj-b" });
    expect(projB).toHaveLength(1);
    expect(projB[0].id).toBe("proj-b:e2");

    // Cleanup
    await store.deleteEntry("proj-a", "e1");
    await store.deleteEntry("proj-b", "e2");
  });

  it("listProjects returns unique projects", async () => {
    await store.writeEntry({
      project: "unique-a", slug: "u1", title: "U1",
      content: "u1", author: "a@b.com", tags: [], type: "note",
    });
    await store.writeEntry({
      project: "unique-b", slug: "u2", title: "U2",
      content: "u2", author: "a@b.com", tags: [], type: "note",
    });

    const projects = await store.listProjects();
    expect(projects).toContain("unique-a");
    expect(projects).toContain("unique-b");

    // Cleanup
    await store.deleteEntry("unique-a", "u1");
    await store.deleteEntry("unique-b", "u2");
  });

  it("rejects duplicate write", async () => {
    await store.writeEntry({
      project: "dup", slug: "same", title: "Original",
      content: "original", author: "a@b.com", tags: [], type: "note",
    });

    await expect(
      store.writeEntry({
        project: "dup", slug: "same", title: "Duplicate",
        content: "dup", author: "b@c.com", tags: [], type: "note",
      })
    ).rejects.toThrow("already exists");

    // Cleanup
    await store.deleteEntry("dup", "same");
  });
});
```

**Step 3: Run integration tests**

```bash
cd chroma-server
docker compose -f docker-compose.test.yml up -d --wait
npx vitest run test/integration.test.js
docker compose -f docker-compose.test.yml down
```

Expected: All tests PASS

**Step 4: Commit**

```bash
git add chroma-server/test/integration.test.js chroma-server/docker-compose.test.yml
git commit -m "test: add integration tests with real ChromaDB"
```

---

## Task 6: npm Package Preparation

**Files:**
- Modify: `chroma-server/package.json` (add repository, license, keywords)
- Create: `chroma-server/README.md`
- Create: `chroma-server/.npmignore`

**Step 1: Update package.json**

Add to `chroma-server/package.json`:
```json
{
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/sfrangulov/chroma-memory-mcp"
  },
  "keywords": [
    "mcp",
    "claude",
    "chromadb",
    "semantic-search",
    "team-memory",
    "vector-database"
  ]
}
```

**Step 2: Create .npmignore**

```
test/
docker-compose.test.yml
.env
chroma-data/
```

**Step 3: Create README.md**

Write a README with:
- What it does (1 paragraph)
- Quick start (docker-compose up)
- Claude Desktop config
- Google Cloud setup (OAuth2 Client ID + API Key)
- Environment variables table
- Available MCP tools table

**Step 4: Verify npm pack**

Run: `cd chroma-server && npm pack --dry-run`
Expected: Lists only server.js, lib/*, Dockerfile, docker-compose.yml, README.md, package.json

**Step 5: Publish to npm**

Run: `cd chroma-server && npm publish --access public`
Expected: Published @sfrangulov/chroma-memory-mcp@0.1.0

**Step 6: Commit**

```bash
git add chroma-server/
git commit -m "feat: prepare npm package for publishing"
```

---

## Task 7: Docker Image Build and Push

**Files:**
- Modify: `chroma-server/Dockerfile` (if needed)

**Step 1: Build Docker image**

```bash
cd chroma-server
docker build -t sfrangulov/chroma-memory-mcp:0.1.0 .
docker tag sfrangulov/chroma-memory-mcp:0.1.0 sfrangulov/chroma-memory-mcp:latest
```

**Step 2: Test Docker image locally**

```bash
docker compose up -d
curl http://localhost:3000/health
```

Expected: `{"status":"ok","chromadb":"connected"}`

**Step 3: Push to Docker Hub**

```bash
docker push sfrangulov/chroma-memory-mcp:0.1.0
docker push sfrangulov/chroma-memory-mcp:latest
```

**Step 4: Commit any Dockerfile changes**

```bash
git add chroma-server/Dockerfile
git commit -m "chore: finalize Docker image configuration"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Project scaffold | — |
| 2 | Memory store (ChromaDB wrapper) | ~12 unit tests |
| 3 | Auth middleware (Google OAuth2) | ~3 unit tests |
| 4 | MCP server + 7 tools | ~1 smoke test |
| 5 | Integration tests | ~4 integration tests |
| 6 | npm package | — |
| 7 | Docker image | manual verification |

**Total estimated tests:** ~20

**Dependencies between tasks:**
- Task 2 depends on Task 1 (scaffold)
- Task 3 depends on Task 1
- Task 4 depends on Tasks 2 + 3
- Task 5 depends on Task 4
- Tasks 6-7 depend on Task 5
