/**
 * Storage abstraction layer for shared memory operations.
 *
 * Wraps GitHub client + root-parser into a clean interface.
 * All GitHub-specific read/write logic lives here.
 *
 * @module memory-store
 */

import { parseRootMd, addEntryToRoot, updateEntryInRoot } from "./root-parser.js";
import { atomicCommitWithRetry } from "./atomic-commit.js";

/**
 * Creates a memory store backed by a GitHub repository.
 *
 * @param {object} client - GitHub client (from createGitHubClient)
 * @returns {object} store with read/write/search methods
 */
export function createMemoryStore(client) {
  return {
    async readIndex(project) {
      const file = await client.getFileContent(`${project}/root.md`);
      if (!file) return null;
      const parsed = parseRootMd(file.content);
      return {
        description: parsed.description,
        entries: parsed.entries,
        corrupted: parsed.corrupted || false,
        raw: file.content,
      };
    },

    async readEntry(project, fileName) {
      return client.getFileContent(`${project}/${fileName}`);
    },

    async listFiles(project) {
      return client.getDirectoryListing(project);
    },

    async writeEntry(project, fileName, entryContent, rootEntry) {
      return atomicCommitWithRetry(client, {
        buildFiles: async () => {
          const freshRoot = await client.getFileContent(`${project}/root.md`);
          const { updated_markdown } = addEntryToRoot(freshRoot.content, rootEntry);
          return [
            { path: `${project}/${fileName}`, content: entryContent },
            { path: `${project}/root.md`, content: updated_markdown },
          ];
        },
        message: `[shared-memory] create-entry: ${rootEntry.name}`,
      });
    },

    async updateEntry(project, fileName, updatedContent, rootChanges, commitTitle) {
      return atomicCommitWithRetry(client, {
        buildFiles: async () => {
          const result = [
            { path: `${project}/${fileName}`, content: updatedContent },
          ];
          if (rootChanges && (rootChanges.tags || rootChanges.description)) {
            const freshRoot = await client.getFileContent(`${project}/root.md`);
            if (freshRoot) {
              const changes = {};
              if (rootChanges.tags) changes.tags = rootChanges.tags;
              if (rootChanges.description) changes.description = rootChanges.description;
              const updatedRoot = updateEntryInRoot(freshRoot.content, fileName, changes);
              result.push({ path: `${project}/root.md`, content: updatedRoot });
            }
          }
          return result;
        },
        message: `[shared-memory] update-entry: ${commitTitle}`,
      });
    },

    async getRelatedEntries(project, tags, excludeFile, findRelatedFn) {
      const rootFile = await client.getFileContent(`${project}/root.md`);
      if (!rootFile) return [];
      const projectParsed = parseRootMd(rootFile.content);
      let allEntries = projectParsed.entries.map((e) => ({
        ...e, file: e.file, project,
      }));
      if (project !== "_shared") {
        const sharedRoot = await client.getFileContent("_shared/root.md");
        if (sharedRoot) {
          const sharedParsed = parseRootMd(sharedRoot.content);
          const sharedEntries = sharedParsed.entries.map((e) => ({
            ...e, file: `../_shared/${e.file}`, project: "_shared",
          }));
          allEntries = allEntries.concat(sharedEntries);
        }
      }
      return findRelatedFn(allEntries, tags, excludeFile);
    },

    async listProjects() {
      const rootItems = await client.getRootDirectoryListing();
      return rootItems
        .filter((item) => item.type === "dir" && item.name !== "_shared" && !item.name.startsWith("."))
        .map((item) => item.name);
    },

    async listAllDirs() {
      const rootItems = await client.getRootDirectoryListing();
      const dirs = rootItems
        .filter((item) => item.type === "dir" && !item.name.startsWith("."))
        .map((item) => item.name);
      if (!dirs.includes("_shared")) dirs.push("_shared");
      return dirs;
    },

    async searchDeep(query) {
      return client.searchCode(query);
    },

    async getLastCommit(path) {
      return client.getLastCommitForFile(path);
    },

    async getRootListing() {
      return client.getRootDirectoryListing();
    },

    get client() { return client; },
  };
}
