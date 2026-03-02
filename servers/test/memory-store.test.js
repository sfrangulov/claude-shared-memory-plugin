import { describe, it, expect, vi } from "vitest";
import { createMemoryStore } from "../lib/memory-store.js";

function makeMockClient(overrides = {}) {
  return {
    getFileContent: vi.fn().mockResolvedValue({
      content: `# Test Project\n\nDescription.\n\n| Entry | Description | Tags |\n|---|---|---|\n| [Auth](auth.md) | Auth architecture | auth, security |\n`,
      sha: "abc123",
    }),
    getDirectoryListing: vi.fn().mockResolvedValue(["root.md", "auth.md"]),
    getRootDirectoryListing: vi.fn().mockResolvedValue([
      { name: "_shared", type: "dir" },
      { name: "mobile-app", type: "dir" },
      { name: "_meta.md", type: "file" },
    ]),
    searchCode: vi.fn().mockResolvedValue([]),
    getUserInfo: vi.fn().mockResolvedValue({ name: "Test", login: "test" }),
    getHeadSHA: vi.fn().mockResolvedValue("headsha"),
    getTreeSHA: vi.fn().mockResolvedValue("treesha"),
    createBlob: vi.fn().mockResolvedValue("blobsha"),
    createTree: vi.fn().mockResolvedValue("newtreesha"),
    createCommit: vi.fn().mockResolvedValue("commitsha"),
    updateRef: vi.fn().mockResolvedValue(undefined),
    getLastCommitForFile: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("createMemoryStore", () => {
  it("returns an object with expected methods", () => {
    const client = makeMockClient();
    const store = createMemoryStore(client);
    expect(typeof store.readIndex).toBe("function");
    expect(typeof store.readEntry).toBe("function");
    expect(typeof store.listProjects).toBe("function");
  });
});

describe("readIndex", () => {
  it("reads and parses root.md for a project", async () => {
    const client = makeMockClient();
    const store = createMemoryStore(client);
    const result = await store.readIndex("mobile-app");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].file).toBe("auth.md");
    expect(client.getFileContent).toHaveBeenCalledWith("mobile-app/root.md");
  });

  it("returns null if root.md not found", async () => {
    const client = makeMockClient({
      getFileContent: vi.fn().mockResolvedValue(null),
    });
    const store = createMemoryStore(client);
    const result = await store.readIndex("nonexistent");
    expect(result).toBeNull();
  });
});

describe("listProjects", () => {
  it("returns project dirs excluding _shared and dot-prefixed", async () => {
    const client = makeMockClient();
    const store = createMemoryStore(client);
    const projects = await store.listProjects();
    expect(projects).toEqual(["mobile-app"]);
  });
});
