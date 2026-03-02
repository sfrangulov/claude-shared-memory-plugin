import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import pLimit from "p-limit";

const limit = pLimit(5);

/**
 * Creates an Octokit instance with retry and throttling plugins.
 * @param {string} token - GitHub personal access token
 * @returns {Octokit} configured Octokit instance
 */
export function createOctokit(token) {
  const MyOctokit = Octokit.plugin(retry, throttling);

  return new MyOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(
          `Rate limit hit for ${options.method} ${options.url}`
        );
        if (retryCount < 1) return true;
      },
      onSecondaryRateLimit: (retryAfter, options, octokit) => {
        octokit.log.warn(
          `Secondary rate limit for ${options.method} ${options.url}`
        );
      },
    },
    retry: { doNotRetry: ["429"] },
    request: { timeout: 10000 },
  });
}

/**
 * Creates a GitHub client object with convenience methods.
 * @param {object} params
 * @param {Octokit} params.octokit - Octokit instance (or mock)
 * @param {string} params.repo - "owner/repo" string
 * @returns {object} client with owner, repo, and API methods
 */
export function createGitHubClient({ octokit, repo, branch = "main" }) {
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid repo format: "${repo}". Expected "owner/repo".`
    );
  }
  const [owner, repoName] = parts;

  return {
    owner,
    repo: repoName,

    async getUserInfo() {
      return limit(async () => {
        const { data } = await octokit.rest.users.getAuthenticated();
        return {
          name: data.name ?? data.login,
          login: data.login,
        };
      });
    },

    async getFileContent(path) {
      return limit(async () => {
        try {
          const { data } = await octokit.rest.repos.getContent({
            owner,
            repo: repoName,
            path,
          });
          const content = Buffer.from(data.content, "base64").toString("utf-8");
          return { content, sha: data.sha };
        } catch (err) {
          if (err.status === 404) return null;
          throw err;
        }
      });
    },

    async getDirectoryListing(path) {
      return limit(async () => {
        try {
          const { data } = await octokit.rest.repos.getContent({
            owner,
            repo: repoName,
            path,
          });
          return Array.isArray(data)
            ? data.filter((item) => item.type === "file").map((item) => item.name)
            : [];
        } catch (err) {
          if (err.status === 404) return [];
          throw err;
        }
      });
    },

    async searchCode(query) {
      return limit(async () => {
        const { data } = await octokit.rest.search.code({
          q: `${query} repo:${owner}/${repoName} extension:md`,
        });
        return data.items;
      });
    },

    async getHeadSHA() {
      return limit(async () => {
        const { data } = await octokit.rest.git.getRef({
          owner,
          repo: repoName,
          ref: `heads/${branch}`,
        });
        return data.object.sha;
      });
    },

    async getTreeSHA(commitSHA) {
      return limit(async () => {
        const { data } = await octokit.rest.git.getCommit({
          owner,
          repo: repoName,
          commit_sha: commitSHA,
        });
        return data.tree.sha;
      });
    },

    async createBlob(content) {
      return limit(async () => {
        const { data } = await octokit.rest.git.createBlob({
          owner,
          repo: repoName,
          content,
          encoding: "utf-8",
        });
        return data.sha;
      });
    },

    async createTree(baseTreeSHA, files) {
      return limit(async () => {
        const tree = files.map(({ path, blobSHA }) => ({
          path,
          mode: "100644",
          type: "blob",
          sha: blobSHA,
        }));
        const { data } = await octokit.rest.git.createTree({
          owner,
          repo: repoName,
          base_tree: baseTreeSHA,
          tree,
        });
        return data.sha;
      });
    },

    async createCommit(treeSHA, parentSHA, message) {
      return limit(async () => {
        const { data } = await octokit.rest.git.createCommit({
          owner,
          repo: repoName,
          message,
          tree: treeSHA,
          parents: [parentSHA],
        });
        return data.sha;
      });
    },

    async updateRef(commitSHA) {
      return limit(async () => {
        await octokit.rest.git.updateRef({
          owner,
          repo: repoName,
          ref: `heads/${branch}`,
          sha: commitSHA,
          force: false,
        });
      });
    },

    async getLastCommitForFile(path) {
      return limit(async () => {
        try {
          const { data } = await octokit.rest.repos.listCommits({
            owner,
            repo: repoName,
            path,
            per_page: 1,
          });
          if (data.length === 0) return null;
          const commit = data[0].commit;
          return {
            author: commit.author.name,
            date: commit.author.date,
          };
        } catch (err) {
          if (err.status === 404) return null;
          throw err;
        }
      });
    },

    async getRootDirectoryListing() {
      return limit(async () => {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo: repoName,
          path: "",
        });
        return Array.isArray(data) ? data : [data];
      });
    },
  };
}
