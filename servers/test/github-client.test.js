import { describe, it, expect, vi } from "vitest";
import { createGitHubClient } from "../lib/github-client.js";

/**
 * Helper: build a mock Octokit instance with vi.fn() stubs.
 * Each test can override specific response values as needed.
 */
function makeMockOctokit(overrides = {}) {
  return {
    rest: {
      users: {
        getAuthenticated: vi.fn().mockResolvedValue({
          data: { name: "Test User", login: "testuser" },
        }),
      },
      repos: {
        getContent: vi.fn().mockResolvedValue({
          data: {
            type: "file",
            content: Buffer.from("hello world").toString("base64"),
            sha: "abc123",
          },
        }),
        listCommits: vi.fn().mockResolvedValue({
          data: [
            {
              commit: {
                author: { name: "author1", date: "2025-01-01T00:00:00Z" },
              },
            },
          ],
        }),
      },
      git: {
        getRef: vi.fn().mockResolvedValue({
          data: { object: { sha: "headsha123" } },
        }),
        getCommit: vi.fn().mockResolvedValue({
          data: { tree: { sha: "treesha456" } },
        }),
        createBlob: vi.fn().mockResolvedValue({
          data: { sha: "blobsha789" },
        }),
        createTree: vi.fn().mockResolvedValue({
          data: { sha: "newtreesha" },
        }),
        createCommit: vi.fn().mockResolvedValue({
          data: { sha: "newcommitsha" },
        }),
        updateRef: vi.fn().mockResolvedValue({}),
      },
      search: {
        code: vi.fn().mockResolvedValue({
          data: { items: [{ name: "result.md", path: "docs/result.md" }] },
        }),
      },
    },
    ...overrides,
  };
}

describe("createGitHubClient", () => {
  it("parses owner/repo correctly", () => {
    const octokit = makeMockOctokit();
    const client = createGitHubClient({ octokit, repo: "myowner/myrepo" });
    expect(client.owner).toBe("myowner");
    expect(client.repo).toBe("myrepo");
  });

  it("throws on invalid format (no slash)", () => {
    const octokit = makeMockOctokit();
    expect(() => createGitHubClient({ octokit, repo: "invalid-repo" })).toThrow();
  });
});

describe("getUserInfo", () => {
  it("returns { name, login }", async () => {
    const octokit = makeMockOctokit();
    const client = createGitHubClient({ octokit, repo: "owner/repo" });
    const info = await client.getUserInfo();
    expect(info).toEqual({ name: "Test User", login: "testuser" });
  });

  it("falls back to login when name is null", async () => {
    const octokit = makeMockOctokit();
    octokit.rest.users.getAuthenticated.mockResolvedValue({
      data: { name: null, login: "testuser" },
    });
    const client = createGitHubClient({ octokit, repo: "owner/repo" });
    const info = await client.getUserInfo();
    expect(info).toEqual({ name: "testuser", login: "testuser" });
  });
});

describe("getFileContent", () => {
  it("decodes base64 content, returns { content, sha }", async () => {
    const octokit = makeMockOctokit();
    const client = createGitHubClient({ octokit, repo: "owner/repo" });
    const result = await client.getFileContent("some/path.md");
    expect(result).toEqual({ content: "hello world", sha: "abc123" });
    expect(octokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      path: "some/path.md",
    });
  });

  it("returns null on 404", async () => {
    const octokit = makeMockOctokit();
    octokit.rest.repos.getContent.mockRejectedValue({ status: 404 });
    const client = createGitHubClient({ octokit, repo: "owner/repo" });
    const result = await client.getFileContent("missing.md");
    expect(result).toBeNull();
  });
});

describe("getDirectoryListing", () => {
  it("returns array of filenames (files only, not dirs)", async () => {
    const octokit = makeMockOctokit();
    octokit.rest.repos.getContent.mockResolvedValue({
      data: [
        { name: "file1.md", type: "file" },
        { name: "subdir", type: "dir" },
        { name: "file2.md", type: "file" },
      ],
    });
    const client = createGitHubClient({ octokit, repo: "owner/repo" });
    const listing = await client.getDirectoryListing("docs");
    expect(listing).toEqual(["file1.md", "file2.md"]);
  });

  it("returns [] on 404", async () => {
    const octokit = makeMockOctokit();
    octokit.rest.repos.getContent.mockRejectedValue({ status: 404 });
    const client = createGitHubClient({ octokit, repo: "owner/repo" });
    const listing = await client.getDirectoryListing("nonexistent");
    expect(listing).toEqual([]);
  });
});

describe("getHeadSHA", () => {
  it("returns SHA from ref", async () => {
    const octokit = makeMockOctokit();
    const client = createGitHubClient({ octokit, repo: "owner/repo" });
    const sha = await client.getHeadSHA();
    expect(sha).toBe("headsha123");
    expect(octokit.rest.git.getRef).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      ref: "heads/main",
    });
  });
});
