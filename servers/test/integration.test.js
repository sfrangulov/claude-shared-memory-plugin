/**
 * Integration tests — against real GitHub repository.
 *
 * Run: GITHUB_TOKEN=$(gh auth token) GITHUB_REPO=sfrangulov/shared-memory npx vitest run test/integration.test.js
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createOctokit, createGitHubClient } from "../lib/github-client.js";
import { parseRootMd, addEntryToRoot } from "../lib/root-parser.js";
import { slugify, ensureUnique } from "../lib/slugify.js";
import { atomicCommitWithRetry } from "../lib/atomic-commit.js";

const REPO = process.env.GITHUB_REPO || "sfrangulov/shared-memory";
const TOKEN = process.env.GITHUB_TOKEN;

const describeIntegration = TOKEN ? describe : describe.skip;

let client;
let octokit;
const [owner, repoName] = REPO.split("/");

describeIntegration("Integration: GitHub API", { timeout: 60000 }, () => {
  beforeAll(() => {
    octokit = createOctokit(TOKEN);
    client = createGitHubClient({ octokit, repo: REPO });
  });

  it("getUserInfo returns valid user", async () => {
    const info = await client.getUserInfo();
    expect(info).toHaveProperty("login");
    expect(info.login.length).toBeGreaterThan(0);
  });

  it("initializes empty repo via Contents API if needed", async () => {
    let rootFile = await client.getFileContent("_shared/root.md");

    if (!rootFile) {
      // Empty repo — use Contents API (PUT) which works without existing commits
      const metaContent = `# Shared Memory Repository\n\n- **Created:** ${new Date().toISOString().split("T")[0]}\n- **Format version:** 1\n`;

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo: repoName,
        path: "_meta.md",
        message: "[shared-memory] init: create _meta.md",
        content: Buffer.from(metaContent).toString("base64"),
      });

      const sharedRoot = `# Shared Knowledge\n\nCross-project knowledge available to all team members.\n\n| Entry | Description | Tags |\n|---|---|---|\n`;

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo: repoName,
        path: "_shared/root.md",
        message: "[shared-memory] init: create _shared/root.md",
        content: Buffer.from(sharedRoot).toString("base64"),
      });

      rootFile = await client.getFileContent("_shared/root.md");
    }

    expect(rootFile).not.toBeNull();
    const parsed = parseRootMd(rootFile.content);
    expect(parsed.corrupted).toBeUndefined();
    expect(Array.isArray(parsed.entries)).toBe(true);
  });

  it("getHeadSHA + getTreeSHA return valid SHAs", async () => {
    const headSHA = await client.getHeadSHA();
    expect(headSHA).toMatch(/^[0-9a-f]{40}$/);
    const treeSHA = await client.getTreeSHA(headSHA);
    expect(treeSHA).toMatch(/^[0-9a-f]{40}$/);
  });

  it("writes a test entry and reads it back", async () => {
    const rootFile = await client.getFileContent("_shared/root.md");
    const testId = Date.now().toString(36);
    const testTitle = `Integration Test ${testId}`;
    const slug = ensureUnique(
      slugify(testTitle),
      await client.getDirectoryListing("_shared")
    );

    const { updated_markdown, was_added } = addEntryToRoot(rootFile.content, {
      file: `${slug}.md`,
      name: testTitle,
      description: `Automated test ${testId}`,
      tags: ["integration-test", "automated"],
    });
    expect(was_added).toBe(true);

    const entryContent = `# ${testTitle}\n\n- **Date:** ${new Date().toISOString().split("T")[0]}\n- **Author:** integration-test\n- **Tags:** integration-test, automated\n\nTest entry ID: ${testId}`;

    const result = await atomicCommitWithRetry(client, {
      files: [
        { path: `_shared/${slug}.md`, content: entryContent },
        { path: "_shared/root.md", content: updated_markdown },
      ],
      message: `[shared-memory] create-entry: test ${testId}`,
    });
    expect(result.success).toBe(true);

    // Read back
    const readBack = await client.getFileContent(`_shared/${slug}.md`);
    expect(readBack).not.toBeNull();
    expect(readBack.content).toContain(testId);

    // Verify root.md
    const updatedRoot = await client.getFileContent("_shared/root.md");
    const parsed = parseRootMd(updatedRoot.content);
    expect(parsed.entries.find((e) => e.file === `${slug}.md`)).toBeDefined();
  });

  it("search_tags finds entries by keyword", async () => {
    const rootFile = await client.getFileContent("_shared/root.md");
    const parsed = parseRootMd(rootFile.content);

    const results = parsed.entries
      .map((entry) => {
        const match = entry.tags.some((t) => t === "integration-test") ? 1 : 0;
        return match > 0 ? { ...entry, match_count: match } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.match_count - a.match_count);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].tags).toContain("integration-test");
  });

  it("getDirectoryListing returns files in _shared", async () => {
    const files = await client.getDirectoryListing("_shared");
    expect(files).toContain("root.md");
  });

  it("getRootDirectoryListing includes _shared and _meta.md", async () => {
    const items = await client.getRootDirectoryListing();
    const names = items.map((i) => i.name);
    expect(names).toContain("_shared");
    expect(names).toContain("_meta.md");
  });
});
