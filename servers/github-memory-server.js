#!/usr/bin/env node
/**
 * Claude Shared Memory — MCP Server
 *
 * Main entry point. Creates the MCP server, initializes Octokit + github-client
 * + state-manager, and registers all 12 tools.
 *
 * @module github-memory-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createOctokit, createGitHubClient } from "./lib/github-client.js";
import {
  parseRootMd,
  addEntryToRoot,
  updateEntryInRoot,
} from "./lib/root-parser.js";
import { slugify, ensureUnique } from "./lib/slugify.js";
import { atomicCommitWithRetry } from "./lib/atomic-commit.js";
import { createStateManager } from "./lib/state-manager.js";
import { validateProjectName, validateFileName } from "./lib/validators.js";

// ---------------------------------------------------------------------------
// Server initialization
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "shared-memory", version: "1.0.0" });

const token = process.env.GITHUB_TOKEN;
const repoString = process.env.GITHUB_REPO;

const octokit = createOctokit(token);
let client = createGitHubClient({ octokit, repo: repoString });
const [repoOwner, repoName] = (repoString || "").split("/");
const stateManager = createStateManager(process.cwd());

// Session state
let sessionAuthor = null;

// ---------------------------------------------------------------------------
// Helper functions — error / success wrappers
// ---------------------------------------------------------------------------

function errorResult(error_code, error, retry_possible, retry_after_ms) {
  const result = { status: "error", error_code, error, retry_possible };
  if (retry_after_ms !== undefined) result.retry_after_ms = retry_after_ms;
  return result;
}

function successResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function errorResponse(error_code, error, retry_possible, retry_after_ms) {
  const result = errorResult(error_code, error, retry_possible, retry_after_ms);
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
    isError: true,
  };
}

async function withErrorHandling(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 401)
      return errorResponse("auth_failed", "Invalid or expired token", false);
    if (err.status === 404)
      return errorResponse(
        "not_found",
        err.message || "Resource not found",
        false
      );
    if (err.status === 429) {
      const retryAfter = err.response?.headers?.["retry-after"];
      const ms = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
      return errorResponse("rate_limit_rest", "Rate limit exceeded", true, ms);
    }
    if (err.status === 403 && err.message?.includes("rate limit")) {
      return errorResponse(
        "rate_limit_search",
        "Search rate limit exceeded",
        true,
        60000
      );
    }
    return errorResponse(
      "network_error",
      err.message || "Unknown error",
      true
    );
  }
}

// ---------------------------------------------------------------------------
// Entry content helpers
// ---------------------------------------------------------------------------

function buildEntryContent({ title, date, author, tags, content, related }) {
  let md = `# ${title}\n\n`;
  md += `- **Date:** ${date}\n`;
  md += `- **Author:** ${author}\n`;
  md += `- **Tags:** ${tags.join(", ")}\n\n`;
  md += content;
  if (related && related.length > 0) {
    md += `\n\n## Related\n\n`;
    for (const r of related) {
      md += `- [${r}](${r})\n`;
    }
  }
  return md;
}

function parseEntryMetadata(content) {
  const lines = content.split("\n");
  const result = {
    title: "",
    date: "",
    author: "",
    tags: [],
    content: "",
    related: [],
  };

  // Title from first # heading
  for (const line of lines) {
    if (line.startsWith("# ")) {
      result.title = line.slice(2).trim();
      break;
    }
  }

  // Metadata fields
  for (const line of lines) {
    const dateMatch = line.match(/^\s*-\s*\*\*Date:\*\*\s*(.+)/);
    if (dateMatch) result.date = dateMatch[1].trim();

    const authorMatch = line.match(/^\s*-\s*\*\*Author:\*\*\s*(.+)/);
    if (authorMatch) result.author = authorMatch[1].trim();

    const tagsMatch = line.match(/^\s*-\s*\*\*Tags:\*\*\s*(.+)/);
    if (tagsMatch)
      result.tags = tagsMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
  }

  // Related section
  const relatedIdx = content.indexOf("## Related");
  if (relatedIdx !== -1) {
    const relatedSection = content.slice(relatedIdx);
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRe.exec(relatedSection)) !== null) {
      result.related.push(match[2]);
    }
  }

  // Content: everything between metadata and Related section (or end)
  const tagsIdx = content.indexOf("**Tags:**");
  const contentStart = tagsIdx !== -1 ? content.indexOf("\n\n", tagsIdx) : -1;
  const contentEnd = relatedIdx !== -1 ? relatedIdx : content.length;
  if (contentStart !== -1) {
    result.content = content.slice(contentStart, contentEnd).trim();
  }

  return result;
}

function findRelated(entries, tags, excludeFile) {
  return entries
    .filter((e) => e.file !== excludeFile)
    .map((e) => {
      const commonTags = e.tags.filter((t) => tags.includes(t));
      return {
        file: e.file,
        common_tags: commonTags,
        match_count: commonTags.length,
      };
    })
    .filter((r) => r.match_count >= 1)
    .sort((a, b) => b.match_count - a.match_count);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_META = `# Shared Memory Repository

This repository is managed by the Claude Shared Memory plugin.

## Configuration

- **Created:** ${new Date().toISOString().split("T")[0]}
- **Format version:** 1
`;

const DEFAULT_SHARED_ROOT = `# Shared Knowledge

Cross-project knowledge available to all team members.

| Entry | Description | Tags |
|---|---|---|
`;

// ---------------------------------------------------------------------------
// Stopwords for keyword overlap in check_duplicate
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "must",
  "can",
  "could",
  "of",
  "in",
  "to",
  "for",
  "with",
  "on",
  "at",
  "from",
  "by",
  "about",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "so",
  "yet",
  "both",
  "either",
  "neither",
  "each",
  "every",
  "all",
  "any",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "only",
  "own",
  "same",
  "than",
  "too",
  "very",
  "just",
  "because",
  "if",
  "when",
  "how",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "we",
  "our",
  "they",
  "their",
  "he",
  "she",
  "his",
  "her",
]);

function extractKeywords(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// ---------------------------------------------------------------------------
// Tool 1: connect_repo
// ---------------------------------------------------------------------------

server.registerTool(
  "connect_repo",
  {
    title: "Connect Repository",
    description: "Connect to the shared memory GitHub repository",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  async () => {
    return withErrorHandling(async () => {
      // 1. Get user info, cache sessionAuthor
      const userInfo = await client.getUserInfo();
      sessionAuthor = userInfo.name;

      // 1.5 Detect default branch and re-create client if needed
      try {
        const { data: repoData } = await octokit.rest.repos.get({
          owner: repoOwner,
          repo: repoName,
        });
        if (repoData.default_branch !== "main") {
          client = createGitHubClient({
            octokit,
            repo: repoString,
            branch: repoData.default_branch,
          });
        }
      } catch {
        // Fallback: keep using 'main' (e.g., empty repo returns 409)
      }

      // 2. Get root directory listing (may fail on empty repo)
      let rootItems;
      let isEmptyRepo = false;
      try {
        rootItems = await client.getRootDirectoryListing();
      } catch (err) {
        if (
          err.message?.toLowerCase().includes("empty") ||
          err.status === 409
        ) {
          isEmptyRepo = true;
          rootItems = [];
        } else {
          throw err;
        }
      }

      const rootNames = rootItems.map((item) => item.name);
      const hasMeta = rootNames.includes("_meta.md");
      const hasShared = rootNames.includes("_shared");

      // 3-4. Cold start or partial init
      if (!hasMeta || !hasShared) {
        if (isEmptyRepo) {
          // Empty repo — use Contents API (works without existing commits)
          if (!hasMeta) {
            await octokit.rest.repos.createOrUpdateFileContents({
              owner: repoOwner,
              repo: repoName,
              path: "_meta.md",
              message: "[shared-memory] init: create _meta.md",
              content: Buffer.from(DEFAULT_META).toString("base64"),
            });
          }
          if (!hasShared) {
            await octokit.rest.repos.createOrUpdateFileContents({
              owner: repoOwner,
              repo: repoName,
              path: "_shared/root.md",
              message: "[shared-memory] init: create _shared/root.md",
              content: Buffer.from(DEFAULT_SHARED_ROOT).toString("base64"),
            });
          }
        } else {
          // Repo has commits but missing structure — use atomicCommit
          const files = [];
          if (!hasMeta) {
            files.push({ path: "_meta.md", content: DEFAULT_META });
          }
          if (!hasShared) {
            files.push({
              path: "_shared/root.md",
              content: DEFAULT_SHARED_ROOT,
            });
          }
          await atomicCommitWithRetry(client, {
            files,
            message: "[shared-memory] init: initialize repository structure",
          });
        }

        return successResult({
          status: "initialized",
          user: userInfo,
          projects: [],
          shared_entries_count: 0,
        });
      }

      // 5. Read _shared/root.md, count entries
      const sharedRoot = await client.getFileContent("_shared/root.md");
      let sharedEntriesCount = 0;
      if (sharedRoot) {
        const parsed = parseRootMd(sharedRoot.content);
        sharedEntriesCount = parsed.entries.length;
      }

      // 6. List projects (dirs excluding _shared, _meta.md)
      const projects = rootItems
        .filter(
          (item) =>
            item.type === "dir" &&
            item.name !== "_shared" &&
            !item.name.startsWith(".")
        )
        .map((item) => item.name);

      return successResult({
        status: "connected",
        user: userInfo,
        projects,
        shared_entries_count: sharedEntriesCount,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 2: read_root
// ---------------------------------------------------------------------------

server.registerTool(
  "read_root",
  {
    title: "Read Root Index",
    description: "Read root.md index for a project",
    inputSchema: z.object({
      project: z
        .string()
        .describe("Project folder name: '_shared', 'mobile-app', etc."),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ project }) => {
    return withErrorHandling(async () => {
      validateProjectName(project);
      const file = await client.getFileContent(`${project}/root.md`);
      if (!file) {
        return errorResponse(
          "not_found",
          `root.md not found in project "${project}"`,
          false
        );
      }

      const parsed = parseRootMd(file.content);

      // If corrupted, fallback: list directory files
      if (parsed.corrupted) {
        const dirFiles = await client.getDirectoryListing(project);
        const entries = dirFiles
          .filter((f) => f !== "root.md")
          .map((f) => ({ file: f }));
        return successResult({
          project,
          description: "",
          entries,
          corrupted: true,
          raw_markdown: file.content,
        });
      }

      return successResult({
        project,
        description: parsed.description,
        entries: parsed.entries,
        raw_markdown: file.content,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 3: read_entry
// ---------------------------------------------------------------------------

server.registerTool(
  "read_entry",
  {
    title: "Read Entry",
    description: "Read a specific entry from shared memory",
    inputSchema: z.object({
      project: z.string().describe("Project folder name"),
      file: z.string().describe("Entry filename (e.g. 'rive-vs-lottie.md')"),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ project, file }) => {
    return withErrorHandling(async () => {
      validateProjectName(project);
      validateFileName(file);
      const result = await client.getFileContent(`${project}/${file}`);
      if (!result) {
        return errorResponse(
          "not_found",
          `Entry "${file}" not found in project "${project}"`,
          false
        );
      }

      const meta = parseEntryMetadata(result.content);
      return successResult({
        title: meta.title,
        date: meta.date,
        author: meta.author,
        tags: meta.tags,
        content: meta.content,
        sha: result.sha,
        related: meta.related,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 4: write_entry
// ---------------------------------------------------------------------------

server.registerTool(
  "write_entry",
  {
    title: "Write Entry",
    description: "Create a new entry in shared memory",
    inputSchema: z.object({
      project: z.string().describe("Project folder name"),
      title: z.string().describe("Entry title"),
      content: z.string().describe("Entry content (markdown)"),
      tags: z.array(z.string()).describe("Tags for the entry"),
      description: z
        .string()
        .max(80)
        .describe("Brief description for root.md (max 80 chars)"),
      auto_related: z
        .boolean()
        .optional()
        .default(true)
        .describe("Auto-discover Related links"),
      related_override: z
        .array(z.string())
        .optional()
        .describe("Manual override of Related list"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({
    project,
    title,
    content,
    tags,
    description,
    auto_related,
    related_override,
  }) => {
    return withErrorHandling(async () => {
      // 1. Read root.md
      const rootFile = await client.getFileContent(`${project}/root.md`);
      if (!rootFile) {
        return errorResponse(
          "not_found",
          `root.md not found in project "${project}"`,
          false
        );
      }

      // 2. Generate slug, ensure unique
      const existingFiles = await client.getDirectoryListing(project);
      const baseSlug = slugify(title);
      const uniqueSlug = ensureUnique(baseSlug, existingFiles);
      const fileName = `${uniqueSlug}.md`;

      // 3. Determine related links
      let relatedLinks = [];
      let relatedCandidates = [];

      if (related_override) {
        relatedLinks = related_override;
      } else if (auto_related) {
        // Gather entries from project + _shared
        const projectParsed = parseRootMd(rootFile.content);
        let allEntries = projectParsed.entries.map((e) => ({
          ...e,
          file: `${e.file}`,
          project,
        }));

        // Also read _shared entries
        if (project !== "_shared") {
          const sharedRoot = await client.getFileContent("_shared/root.md");
          if (sharedRoot) {
            const sharedParsed = parseRootMd(sharedRoot.content);
            const sharedEntries = sharedParsed.entries.map((e) => ({
              ...e,
              file: `../_shared/${e.file}`,
              project: "_shared",
            }));
            allEntries = allEntries.concat(sharedEntries);
          }
        }

        const related = findRelated(allEntries, tags, fileName);
        if (related.length <= 3) {
          relatedLinks = related.map((r) => r.file);
        } else {
          // Add top 3, return rest as candidates
          relatedLinks = related.slice(0, 3).map((r) => r.file);
          relatedCandidates = related.slice(3).map((r) => ({
            file: r.file,
            common_tags: r.common_tags,
          }));
        }
      }

      // 4. Build entry content
      const date = new Date().toISOString().split("T")[0];
      const author = sessionAuthor || "Unknown";
      const entryContent = buildEntryContent({
        title,
        date,
        author,
        tags,
        content,
        related: relatedLinks,
      });

      // 5. Update root.md
      const { updated_markdown } = addEntryToRoot(rootFile.content, {
        file: fileName,
        name: title,
        description,
        tags,
      });

      // 6. Atomic commit
      const commitResult = await atomicCommitWithRetry(client, {
        buildFiles: async () => {
          const freshRoot = await client.getFileContent(`${project}/root.md`);
          const { updated_markdown: freshMarkdown } = addEntryToRoot(
            freshRoot.content,
            { file: fileName, name: title, description, tags }
          );
          return [
            { path: `${project}/${fileName}`, content: entryContent },
            { path: `${project}/root.md`, content: freshMarkdown },
          ];
        },
        message: `[shared-memory] create-entry: ${title}`,
      });

      if (!commitResult.success) {
        return errorResponse(
          "sha_conflict",
          "Failed to commit after retries",
          true
        );
      }

      // 7. Invalidate author cache for this project
      stateManager.invalidateAuthorCache(project);

      const result = {
        status: "created",
        file: fileName,
        commit_sha: commitResult.commitSHA,
        related_added: relatedLinks,
      };
      if (relatedCandidates.length > 0) {
        result.related_candidates = relatedCandidates;
      }

      return successResult(result);
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 5: update_entry
// ---------------------------------------------------------------------------

server.registerTool(
  "update_entry",
  {
    title: "Update Entry",
    description: "Update an existing entry in shared memory",
    inputSchema: z.object({
      project: z.string().describe("Project folder name"),
      file: z.string().describe("Entry filename"),
      previous_sha: z
        .string()
        .describe("SHA from read_entry (for conflict detection)"),
      new_content: z.string().describe("Updated content"),
      new_tags: z.array(z.string()).optional().describe("Updated tags"),
      new_description: z
        .string()
        .optional()
        .describe("Updated description for root.md"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ project, file, previous_sha, new_content, new_tags, new_description }) => {
    return withErrorHandling(async () => {
      // 1. Re-read current file
      const current = await client.getFileContent(`${project}/${file}`);
      if (!current) {
        return errorResponse(
          "not_found",
          `Entry "${file}" not found in project "${project}"`,
          false
        );
      }

      // 2. Compare SHA
      if (current.sha !== previous_sha) {
        // Concurrent edit detected
        const currentMeta = parseEntryMetadata(current.content);
        const lastCommit = await client.getLastCommitForFile(
          `${project}/${file}`
        );
        return successResult({
          status: "concurrent_edit",
          current_sha: current.sha,
          previous_author: lastCommit?.author || "unknown",
          previous_date: lastCommit?.date || null,
          diff_summary: `Entry was modified since your last read. Current author: ${currentMeta.author}`,
        });
      }

      // 3. Parse current entry, rebuild with new content
      const currentMeta = parseEntryMetadata(current.content);
      const updatedTags = new_tags || currentMeta.tags;
      const author = currentMeta.author || sessionAuthor || "Unknown";
      const date = currentMeta.date || new Date().toISOString().split("T")[0];

      // Recalculate related if tags changed
      let relatedLinks = currentMeta.related;
      if (new_tags) {
        // Re-discover related with new tags
        const rootFile = await client.getFileContent(`${project}/root.md`);
        if (rootFile) {
          const projectParsed = parseRootMd(rootFile.content);
          let allEntries = projectParsed.entries.map((e) => ({
            ...e,
            file: `${e.file}`,
            project,
          }));

          if (project !== "_shared") {
            const sharedRoot = await client.getFileContent("_shared/root.md");
            if (sharedRoot) {
              const sharedParsed = parseRootMd(sharedRoot.content);
              const sharedEntries = sharedParsed.entries.map((e) => ({
                ...e,
                file: `../_shared/${e.file}`,
                project: "_shared",
              }));
              allEntries = allEntries.concat(sharedEntries);
            }
          }

          const related = findRelated(allEntries, new_tags, file);
          relatedLinks = related.slice(0, 3).map((r) => r.file);
        }
      }

      const updatedContent = buildEntryContent({
        title: currentMeta.title,
        date,
        author,
        tags: updatedTags,
        content: new_content,
        related: relatedLinks,
      });

      // 4. Atomic commit (re-reads root.md on each retry to prevent data loss)
      const commitResult = await atomicCommitWithRetry(client, {
        buildFiles: async () => {
          const currentFiles = [
            { path: `${project}/${file}`, content: updatedContent },
          ];
          if (new_tags || new_description) {
            const freshRoot = await client.getFileContent(`${project}/root.md`);
            if (freshRoot) {
              const changes = {};
              if (new_tags) changes.tags = new_tags;
              if (new_description) changes.description = new_description;
              const updatedRoot = updateEntryInRoot(
                freshRoot.content,
                file,
                changes
              );
              currentFiles.push({
                path: `${project}/root.md`,
                content: updatedRoot,
              });
            }
          }
          return currentFiles;
        },
        message: `[shared-memory] update-entry: ${currentMeta.title}`,
      });

      if (!commitResult.success) {
        return errorResponse(
          "sha_conflict",
          "Failed to commit after retries",
          true
        );
      }

      // 6. Invalidate author cache
      stateManager.invalidateAuthorCache(project);

      return successResult({
        status: "updated",
        commit_sha: commitResult.commitSHA,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 6: search_tags
// ---------------------------------------------------------------------------

server.registerTool(
  "search_tags",
  {
    title: "Search by Tags",
    description: "Search entries by tags and description keywords",
    inputSchema: z.object({
      keywords: z
        .array(z.string())
        .describe("Keywords to match against tags and descriptions"),
      active_project: z
        .string()
        .optional()
        .describe("Active project for prioritization"),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ keywords, active_project }) => {
    return withErrorHandling(async () => {
      // 1. Get all projects
      const rootItems = await client.getRootDirectoryListing();
      const projectDirs = rootItems
        .filter(
          (item) =>
            item.type === "dir" && !item.name.startsWith(".")
        )
        .map((item) => item.name);

      // Ensure _shared is included
      if (!projectDirs.includes("_shared")) {
        projectDirs.push("_shared");
      }

      // 2. Read all root.md files in parallel
      const rootContents = await Promise.all(
        projectDirs.map(async (proj) => {
          const file = await client.getFileContent(`${proj}/root.md`);
          if (!file) return { project: proj, entries: [] };
          const parsed = parseRootMd(file.content);
          return {
            project: proj,
            entries: parsed.entries,
          };
        })
      );

      // 3. Match keywords
      const lowerKeywords = keywords.map((k) => k.toLowerCase());
      const allResults = [];

      for (const { project: proj, entries } of rootContents) {
        for (const entry of entries) {
          const matchDetails = [];

          // Exact tag match
          for (const kw of lowerKeywords) {
            if (entry.tags.some((t) => t.toLowerCase() === kw)) {
              matchDetails.push(`tag:${kw}`);
            }
          }

          // Substring match in description
          const lowerDesc = entry.description.toLowerCase();
          for (const kw of lowerKeywords) {
            if (
              lowerDesc.includes(kw) &&
              !matchDetails.includes(`tag:${kw}`)
            ) {
              matchDetails.push(`desc:${kw}`);
            }
          }

          if (matchDetails.length > 0) {
            allResults.push({
              project: proj,
              file: entry.file,
              name: entry.name,
              description: entry.description,
              tags: entry.tags,
              match_count: matchDetails.length,
              match_details: matchDetails,
            });
          }
        }
      }

      // 4. Rank: match_count DESC, then priority
      allResults.sort((a, b) => {
        if (b.match_count !== a.match_count)
          return b.match_count - a.match_count;

        // Priority: active > _shared > other active > archived
        const priority = (proj) => {
          if (proj === active_project) return 0;
          if (proj === "_shared") return 1;
          return 2;
        };
        return priority(a.project) - priority(b.project);
      });

      // 5. Cap at 15
      const total_count = allResults.length;
      const was_truncated = total_count > 15;
      const results = allResults.slice(0, 15);

      return successResult({
        results,
        total_count,
        was_truncated,
        searched_projects: projectDirs,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 7: search_author
// ---------------------------------------------------------------------------

server.registerTool(
  "search_author",
  {
    title: "Search by Author",
    description: "Search entries by author name",
    inputSchema: z.object({
      author_query: z.string().describe("Author name to search for"),
      project: z
        .string()
        .optional()
        .describe("Search only in this project"),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ author_query, project }) => {
    return withErrorHandling(async () => {
      // Determine which projects to search
      let projectsToSearch;
      if (project) {
        projectsToSearch = [project];
      } else {
        const rootItems = await client.getRootDirectoryListing();
        projectsToSearch = rootItems
          .filter(
            (item) =>
              item.type === "dir" && !item.name.startsWith(".")
          )
          .map((item) => item.name);
      }

      const results = [];
      let usedCache = false;

      for (const proj of projectsToSearch) {
        // Check cache
        let authorIndex = stateManager.getAuthorCache(proj);

        if (!authorIndex) {
          // Cache miss — read all entry metadata
          authorIndex = {};
          const rootFile = await client.getFileContent(`${proj}/root.md`);
          if (!rootFile) continue;

          const parsed = parseRootMd(rootFile.content);

          // Read entry metadata in parallel
          const metaResults = await Promise.all(
            parsed.entries.map(async (entry) => {
              if (!entry.file) return null;
              const fileContent = await client.getFileContent(
                `${proj}/${entry.file}`
              );
              if (!fileContent) return null;
              const meta = parseEntryMetadata(fileContent.content);
              return {
                file: entry.file,
                title: meta.title,
                author: meta.author,
                date: meta.date,
              };
            })
          );

          for (const m of metaResults) {
            if (m) {
              authorIndex[m.file] = {
                title: m.title,
                author: m.author,
                date: m.date,
              };
            }
          }

          // Update cache
          stateManager.setAuthorCache(proj, authorIndex);
        } else {
          usedCache = true;
        }

        // Substring match on author
        const lowerQuery = author_query.toLowerCase();
        for (const [fileName, meta] of Object.entries(authorIndex)) {
          if (meta.author.toLowerCase().includes(lowerQuery)) {
            results.push({
              project: proj,
              file: fileName,
              title: meta.title,
              author: meta.author,
              date: meta.date,
            });
          }
        }
      }

      return successResult({
        results,
        total_count: results.length,
        cached: usedCache,
        warning:
          "Searching by author requires reading files and may take a few seconds",
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 8: search_deep
// ---------------------------------------------------------------------------

server.registerTool(
  "search_deep",
  {
    title: "Deep Search",
    description: "Full-text search across all entries using GitHub Search API",
    inputSchema: z.object({
      query: z.string().describe("Full-text search query"),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ query }) => {
    return withErrorHandling(async () => {
      const items = await client.searchCode(query);

      // Filter out root.md and _meta.md
      const filtered = items.filter((item) => {
        const name = item.name || "";
        return name !== "root.md" && name !== "_meta.md";
      });

      const results = filtered.map((item) => {
        // Parse project from path
        const pathParts = item.path.split("/");
        const projectName = pathParts.length > 1 ? pathParts[0] : "";
        const fileName =
          pathParts.length > 1 ? pathParts.slice(1).join("/") : item.path;

        return {
          project: projectName,
          file: fileName,
          match_fragment: item.text_matches
            ? item.text_matches.map((m) => m.fragment).join(" ... ")
            : "",
        };
      });

      return successResult({
        results,
        total_count: results.length,
        warning:
          "GitHub Search API has an indexing delay of 30-60 seconds. Very recent changes may not appear.",
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 9: list_projects
// ---------------------------------------------------------------------------

server.registerTool(
  "list_projects",
  {
    title: "List Projects",
    description: "List all projects in the shared memory repository",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => {
    return withErrorHandling(async () => {
      // 1. Get root directory listing
      const rootItems = await client.getRootDirectoryListing();
      const projectDirs = rootItems
        .filter(
          (item) =>
            item.type === "dir" &&
            item.name !== "_shared" &&
            !item.name.startsWith(".")
        )
        .map((item) => item.name);

      // 2. For each project, read root.md and count entries
      const projects = await Promise.all(
        projectDirs.map(async (name) => {
          const rootFile = await client.getFileContent(`${name}/root.md`);
          let entries_count = 0;
          if (rootFile) {
            const parsed = parseRootMd(rootFile.content);
            entries_count = parsed.entries.length;
          }
          return { name, entries_count };
        })
      );

      // 3. Get state for active_project
      const state = await stateManager.readState();

      return successResult({
        projects,
        archived: [],
        active_project: state.active_project,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 10: switch_project
// ---------------------------------------------------------------------------

server.registerTool(
  "switch_project",
  {
    title: "Switch Project",
    description: "Switch active project or create a new one",
    inputSchema: z.object({
      project: z.string().describe("Project name to switch to or create"),
    }),
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  async ({ project }) => {
    return withErrorHandling(async () => {
      // 1. Slugify project name
      const projectSlug = slugify(project);

      // 2. Check if folder exists
      const rootFile = await client.getFileContent(
        `${projectSlug}/root.md`
      );

      if (rootFile) {
        // 3. Exists — read root.md, compute summary, update state
        const parsed = parseRootMd(rootFile.content);
        const entries_count = parsed.entries.length;

        // Determine last entry date
        let last_entry_date = null;
        if (entries_count > 0) {
          const lastEntry = parsed.entries[entries_count - 1];
          // Try to find date in description
          const dateMatch = lastEntry.description.match(
            /(\d{4}-\d{2}-\d{2})/
          );
          if (dateMatch) {
            last_entry_date = dateMatch[1];
          } else if (lastEntry.file) {
            // Fall back to git commit date
            const commitInfo = await client.getLastCommitForFile(
              `${projectSlug}/${lastEntry.file}`
            );
            if (commitInfo?.date) {
              last_entry_date = commitInfo.date.split("T")[0];
            }
          }
        }

        // Build summary
        let summary;
        if (entries_count === 0) {
          summary = `Project ${projectSlug}: empty for now. Create the first entry to get started`;
        } else if (last_entry_date) {
          summary = `Project ${projectSlug}: ${entries_count} entries, last — ${last_entry_date}`;
        } else {
          summary = `Project ${projectSlug}: ${entries_count} entries`;
        }

        // Update state
        await stateManager.writeState({
          active_project: projectSlug,
          version: 1,
        });

        // Invalidate author cache (state change)
        stateManager.invalidateAuthorCache();

        return successResult({
          status: "switched",
          project: projectSlug,
          entries_count,
          last_entry_date,
          summary,
          root_content: {
            description: parsed.description,
            entries: parsed.entries,
          },
        });
      }

      // 4. Project does not exist — return not_found
      return successResult({
        status: "not_found",
        project: projectSlug,
        entries_count: 0,
        last_entry_date: null,
        summary: `Project "${projectSlug}" not found`,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 11: get_state
// ---------------------------------------------------------------------------

server.registerTool(
  "get_state",
  {
    title: "Get State",
    description: "Get current session state",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => {
    return withErrorHandling(async () => {
      const state = await stateManager.readState();
      return successResult(state);
    });
  }
);

// ---------------------------------------------------------------------------
// Tool 12: check_duplicate
// ---------------------------------------------------------------------------

server.registerTool(
  "check_duplicate",
  {
    title: "Check Duplicate",
    description: "Check if a similar entry already exists before creating",
    inputSchema: z.object({
      project: z.string().describe("Project folder name"),
      title: z.string().describe("Proposed entry title"),
      tags: z.array(z.string()).describe("Proposed tags"),
      description: z.string().describe("Proposed description"),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ project, title, tags, description }) => {
    return withErrorHandling(async () => {
      // 1. Read project root.md
      const rootFile = await client.getFileContent(`${project}/root.md`);
      if (!rootFile) {
        return errorResponse(
          "not_found",
          `root.md not found in project "${project}"`,
          false
        );
      }

      const parsed = parseRootMd(rootFile.content);
      const inputKeywords = extractKeywords(`${title} ${description}`);
      const lowerTags = tags.map((t) => t.toLowerCase());

      const candidates = [];

      // 2. For each entry: tag match + keyword overlap
      for (const entry of parsed.entries) {
        const entryLowerTags = entry.tags.map((t) => t.toLowerCase());

        // Tag matching: exact match
        const commonTags = lowerTags.filter((t) =>
          entryLowerTags.includes(t)
        );

        // Keyword overlap
        let keywordOverlap = 0;
        if (inputKeywords.length > 0) {
          const entryText =
            `${entry.name} ${entry.description}`.toLowerCase();
          const matched = inputKeywords.filter((kw) =>
            entryText.includes(kw)
          );
          keywordOverlap = Math.round(
            (matched.length / inputKeywords.length) * 100
          );
        }

        // 3. Threshold: >=2 common tags OR >=50% keyword overlap
        if (commonTags.length >= 2 || keywordOverlap >= 50) {
          let match_reason;
          if (commonTags.length >= 2) {
            match_reason = `${commonTags.length} common tags: [${commonTags.join(", ")}]`;
          } else {
            match_reason = `${keywordOverlap}% keyword overlap`;
          }

          candidates.push({
            file: entry.file,
            name: entry.name,
            description: entry.description,
            common_tags: commonTags,
            keyword_overlap: keywordOverlap,
            match_reason,
          });
        }
      }

      return successResult({
        has_duplicate: candidates.length > 0,
        candidates,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
