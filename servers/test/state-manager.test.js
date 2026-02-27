import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStateManager } from "../lib/state-manager.js";

const STATE_FILENAME = ".shared-memory-state";

describe("createStateManager", () => {
  let workdir;
  let mgr;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "sm-state-test-"));
    mgr = createStateManager(workdir);
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // readState
  // -------------------------------------------------------------------------
  describe("readState", () => {
    it("returns defaults when file is missing", async () => {
      const state = await mgr.readState();
      expect(state).toEqual({ active_project: null, version: 1 });
    });

    it("reads an existing state file", async () => {
      const data = { active_project: "my-project", version: 1 };
      await writeFile(
        join(workdir, STATE_FILENAME),
        JSON.stringify(data),
        "utf-8"
      );

      const state = await mgr.readState();
      expect(state).toEqual({ active_project: "my-project", version: 1 });
    });

    it("resets to defaults on corrupted JSON", async () => {
      await writeFile(
        join(workdir, STATE_FILENAME),
        "NOT VALID JSON {{{",
        "utf-8"
      );

      const state = await mgr.readState();
      expect(state).toEqual({ active_project: null, version: 1 });

      // The file should have been recreated with defaults
      const raw = await readFile(join(workdir, STATE_FILENAME), "utf-8");
      const saved = JSON.parse(raw);
      expect(saved).toEqual({ active_project: null, version: 1 });
    });

    it("treats missing version field as version 1 and rewrites", async () => {
      const data = { active_project: "proj-a" };
      await writeFile(
        join(workdir, STATE_FILENAME),
        JSON.stringify(data),
        "utf-8"
      );

      const state = await mgr.readState();
      expect(state).toEqual({ active_project: "proj-a", version: 1 });

      // File should have been rewritten with version field
      const raw = await readFile(join(workdir, STATE_FILENAME), "utf-8");
      const saved = JSON.parse(raw);
      expect(saved.version).toBe(1);
    });

    it("treats non-numeric version as version 1 and rewrites", async () => {
      const data = { active_project: null, version: "bad" };
      await writeFile(
        join(workdir, STATE_FILENAME),
        JSON.stringify(data),
        "utf-8"
      );

      const state = await mgr.readState();
      expect(state).toEqual({ active_project: null, version: 1 });

      const raw = await readFile(join(workdir, STATE_FILENAME), "utf-8");
      const saved = JSON.parse(raw);
      expect(saved.version).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // writeState
  // -------------------------------------------------------------------------
  describe("writeState", () => {
    it("writes state atomically (verifiable via readFile)", async () => {
      const state = { active_project: "test-proj", version: 1 };
      await mgr.writeState(state);

      const raw = await readFile(join(workdir, STATE_FILENAME), "utf-8");
      const saved = JSON.parse(raw);
      expect(saved).toEqual(state);
    });
  });

  // -------------------------------------------------------------------------
  // Author cache
  // -------------------------------------------------------------------------
  describe("author cache", () => {
    it("returns null for empty/unknown project", () => {
      const cache = mgr.getAuthorCache("unknown-project");
      expect(cache).toBeNull();
    });

    it("stores and retrieves cache for a project", () => {
      const cache = { "overview.md": "alice", "stack.md": "bob" };
      mgr.setAuthorCache("my-project", cache);

      const result = mgr.getAuthorCache("my-project");
      expect(result).toEqual(cache);
    });

    it("invalidates cache for a specific project", () => {
      mgr.setAuthorCache("proj-a", { "a.md": "alice" });
      mgr.setAuthorCache("proj-b", { "b.md": "bob" });

      mgr.invalidateAuthorCache("proj-a");

      expect(mgr.getAuthorCache("proj-a")).toBeNull();
      expect(mgr.getAuthorCache("proj-b")).toEqual({ "b.md": "bob" });
    });

    it("invalidates all caches when no project specified", () => {
      mgr.setAuthorCache("proj-a", { "a.md": "alice" });
      mgr.setAuthorCache("proj-b", { "b.md": "bob" });

      mgr.invalidateAuthorCache();

      expect(mgr.getAuthorCache("proj-a")).toBeNull();
      expect(mgr.getAuthorCache("proj-b")).toBeNull();
    });
  });
});
