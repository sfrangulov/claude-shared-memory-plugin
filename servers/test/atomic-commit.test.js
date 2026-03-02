import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ConflictError,
  atomicCommit,
  atomicCommitWithRetry,
} from "../lib/atomic-commit.js";

/**
 * Helper: build a mock client that simulates github-client methods.
 * Each method is a vi.fn() with sensible defaults.
 */
function makeMockClient(overrides = {}) {
  return {
    getHeadSHA: vi.fn().mockResolvedValue("headsha111"),
    getTreeSHA: vi.fn().mockResolvedValue("treesha222"),
    createBlob: vi.fn().mockResolvedValue("blobsha333"),
    createTree: vi.fn().mockResolvedValue("newtreesha444"),
    createCommit: vi.fn().mockResolvedValue("commitsha555"),
    updateRef: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ConflictError", () => {
  it("is an instance of Error with name ConflictError", () => {
    const err = new ConflictError("conflict happened");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConflictError");
    expect(err.message).toBe("conflict happened");
  });
});

describe("atomicCommit", () => {
  it("happy path: creates blobs, tree, commit, updates ref in order", async () => {
    const client = makeMockClient();
    const files = [
      { path: "project-alpha/entry.md", content: "# Entry\nHello" },
      { path: "project-alpha/notes.md", content: "# Notes\nWorld" },
    ];

    const result = await atomicCommit(client, {
      files,
      message: "add two entries",
    });

    // Verify result
    expect(result).toEqual({ commitSHA: "commitsha555", success: true });

    // Step 1: getHeadSHA called (no parentSHA provided)
    expect(client.getHeadSHA).toHaveBeenCalledTimes(1);

    // Step 2: getTreeSHA called with head SHA
    expect(client.getTreeSHA).toHaveBeenCalledWith("headsha111");

    // Step 3: createBlob called for each file
    expect(client.createBlob).toHaveBeenCalledTimes(2);
    expect(client.createBlob).toHaveBeenCalledWith("# Entry\nHello");
    expect(client.createBlob).toHaveBeenCalledWith("# Notes\nWorld");

    // Step 4: createTree called with base tree and files with blobSHAs
    expect(client.createTree).toHaveBeenCalledWith("treesha222", [
      { path: "project-alpha/entry.md", blobSHA: "blobsha333" },
      { path: "project-alpha/notes.md", blobSHA: "blobsha333" },
    ]);

    // Step 5: createCommit with new tree, parent, and message
    expect(client.createCommit).toHaveBeenCalledWith(
      "newtreesha444",
      "headsha111",
      "add two entries"
    );

    // Step 6: updateRef with new commit SHA
    expect(client.updateRef).toHaveBeenCalledWith("commitsha555");

    // Verify call order
    const callOrder = [];
    client.getHeadSHA.mock.invocationCallOrder.forEach((o) =>
      callOrder.push({ fn: "getHeadSHA", order: o })
    );
    client.getTreeSHA.mock.invocationCallOrder.forEach((o) =>
      callOrder.push({ fn: "getTreeSHA", order: o })
    );
    client.createBlob.mock.invocationCallOrder.forEach((o) =>
      callOrder.push({ fn: "createBlob", order: o })
    );
    client.createTree.mock.invocationCallOrder.forEach((o) =>
      callOrder.push({ fn: "createTree", order: o })
    );
    client.createCommit.mock.invocationCallOrder.forEach((o) =>
      callOrder.push({ fn: "createCommit", order: o })
    );
    client.updateRef.mock.invocationCallOrder.forEach((o) =>
      callOrder.push({ fn: "updateRef", order: o })
    );
    callOrder.sort((a, b) => a.order - b.order);

    const fnOrder = callOrder.map((c) => c.fn);
    expect(fnOrder.indexOf("getHeadSHA")).toBeLessThan(
      fnOrder.indexOf("getTreeSHA")
    );
    expect(fnOrder.indexOf("getTreeSHA")).toBeLessThan(
      fnOrder.indexOf("createTree")
    );
    expect(fnOrder.indexOf("createTree")).toBeLessThan(
      fnOrder.indexOf("createCommit")
    );
    expect(fnOrder.indexOf("createCommit")).toBeLessThan(
      fnOrder.indexOf("updateRef")
    );
  });

  it("throws ConflictError on 422 from updateRef", async () => {
    const error422 = new Error("Reference update failed");
    error422.status = 422;

    const client = makeMockClient({
      updateRef: vi.fn().mockRejectedValue(error422),
    });

    const files = [
      { path: "project-alpha/entry.md", content: "# Entry" },
    ];

    await expect(
      atomicCommit(client, { files, message: "test commit" })
    ).rejects.toThrow(ConflictError);
  });

  it("uses provided parentSHA instead of calling getHeadSHA", async () => {
    const client = makeMockClient();
    const files = [
      { path: "project-alpha/entry.md", content: "# Entry" },
    ];

    await atomicCommit(client, {
      files,
      message: "with parent",
      parentSHA: "customparentsha",
    });

    // getHeadSHA should NOT be called
    expect(client.getHeadSHA).not.toHaveBeenCalled();

    // getTreeSHA should use provided parentSHA
    expect(client.getTreeSHA).toHaveBeenCalledWith("customparentsha");

    // createCommit should use provided parentSHA
    expect(client.createCommit).toHaveBeenCalledWith(
      "newtreesha444",
      "customparentsha",
      "with parent"
    );
  });
});

describe("atomicCommitWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("succeeds on first try", async () => {
    const client = makeMockClient();
    const files = [
      { path: "project-alpha/entry.md", content: "# Entry" },
    ];

    const promise = atomicCommitWithRetry(client, {
      files,
      message: "first try success",
    });

    const result = await promise;

    expect(result).toEqual({ commitSHA: "commitsha555", success: true });
    expect(client.getHeadSHA).toHaveBeenCalledTimes(1);
  });

  it("retries on ConflictError, succeeds on 2nd attempt", async () => {
    const error422 = new Error("Reference update failed");
    error422.status = 422;

    let callCount = 0;
    const client = makeMockClient({
      updateRef: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw error422;
        // second call succeeds
      }),
    });

    const files = [
      { path: "project-alpha/entry.md", content: "# Entry" },
    ];

    const promise = atomicCommitWithRetry(client, {
      files,
      message: "retry success",
    });

    // Advance past the first backoff (1000ms)
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result).toEqual({ commitSHA: "commitsha555", success: true });
    // First attempt + one retry = 2 calls to getHeadSHA
    expect(client.getHeadSHA).toHaveBeenCalledTimes(2);
    expect(client.updateRef).toHaveBeenCalledTimes(2);
  });

  it("retries up to maxRetries, then returns failure", async () => {
    const error422 = new Error("Reference update failed");
    error422.status = 422;

    const client = makeMockClient({
      updateRef: vi.fn().mockRejectedValue(error422),
    });

    const files = [
      { path: "project-alpha/entry.md", content: "# Entry" },
    ];

    const promise = atomicCommitWithRetry(client, {
      files,
      message: "always conflict",
      maxRetries: 3,
    });

    // Advance past backoff: 1000ms + 3000ms + 9000ms
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(9000);

    const result = await promise;

    expect(result).toEqual({ success: false, error: "conflict" });
    // 1 initial + 3 retries = 4 total attempts
    expect(client.updateRef).toHaveBeenCalledTimes(4);
  });

  it("calls buildFiles on each retry to get fresh content", async () => {
    const error422 = new Error("Reference update failed");
    error422.status = 422;

    let callCount = 0;
    const client = makeMockClient({
      updateRef: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw error422;
      }),
    });

    let buildFilesCallCount = 0;
    const buildFiles = vi.fn().mockImplementation(async () => {
      buildFilesCallCount++;
      return [
        { path: "project/entry.md", content: `version-${buildFilesCallCount}` },
        { path: "project/root.md", content: `root-version-${buildFilesCallCount}` },
      ];
    });

    const promise = atomicCommitWithRetry(client, {
      buildFiles,
      message: "retry with fresh files",
    });

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toEqual({ commitSHA: "commitsha555", success: true });
    expect(buildFiles).toHaveBeenCalledTimes(2);
    expect(client.createBlob).toHaveBeenCalledWith("version-2");
  });

  it("still accepts static files array for backward compatibility", async () => {
    const client = makeMockClient();
    const files = [{ path: "project/entry.md", content: "static content" }];

    const result = await atomicCommitWithRetry(client, {
      files,
      message: "static files",
    });

    expect(result).toEqual({ commitSHA: "commitsha555", success: true });
    expect(client.createBlob).toHaveBeenCalledWith("static content");
  });

  it("rethrows non-ConflictError immediately", async () => {
    const genericError = new Error("Network failure");

    const client = makeMockClient({
      getHeadSHA: vi.fn().mockRejectedValue(genericError),
    });

    const files = [
      { path: "project-alpha/entry.md", content: "# Entry" },
    ];

    await expect(
      atomicCommitWithRetry(client, {
        files,
        message: "network error",
      })
    ).rejects.toThrow("Network failure");

    // Should not retry — only one attempt
    expect(client.getHeadSHA).toHaveBeenCalledTimes(1);
  });
});
