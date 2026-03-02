/**
 * Atomic commit via Git Trees API with SHA conflict retry.
 *
 * @module atomic-commit
 */

/**
 * Error thrown when a ref update fails due to a SHA conflict (HTTP 422).
 */
export class ConflictError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "ConflictError";
  }
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Performs a single atomic commit using the Git Trees API.
 *
 * Workflow:
 * 1. Get HEAD SHA (or use provided parentSHA)
 * 2. Get tree SHA of parent commit
 * 3. Create blobs for each file
 * 4. Create new tree with base_tree (preserves existing files)
 * 5. Create commit pointing to new tree
 * 6. Update ref to new commit (throws ConflictError on 422)
 *
 * @param {object} client - GitHub client (from createGitHubClient)
 * @param {object} params
 * @param {Array<{path: string, content: string}>} params.files - files to commit
 * @param {string} params.message - commit message
 * @param {string} [params.parentSHA] - optional parent commit SHA (fetches HEAD if omitted)
 * @returns {Promise<{commitSHA: string, success: true}>}
 * @throws {ConflictError} when ref update fails with 422
 */
export async function atomicCommit(client, { files, message, parentSHA }) {
  // Step 1: Get parent SHA
  const resolvedParentSHA = parentSHA ?? (await client.getHeadSHA());

  // Step 2: Get tree SHA of parent commit
  const treeSHA = await client.getTreeSHA(resolvedParentSHA);

  // Step 3: Create blobs for each file
  const filesWithBlobs = await Promise.all(
    files.map(async (file) => {
      const blobSHA = await client.createBlob(file.content);
      return { path: file.path, blobSHA };
    })
  );

  // Step 4: Create new tree with base_tree
  const newTreeSHA = await client.createTree(treeSHA, filesWithBlobs);

  // Step 5: Create commit
  const commitSHA = await client.createCommit(
    newTreeSHA,
    resolvedParentSHA,
    message
  );

  // Step 6: Update ref — throw ConflictError on 422
  try {
    await client.updateRef(commitSHA);
  } catch (err) {
    if (err.status === 422) {
      throw new ConflictError(
        `Ref update conflict: ${err.message || "SHA mismatch"}`
      );
    }
    throw err;
  }

  return { commitSHA, success: true };
}

/**
 * Performs an atomic commit with automatic retry on SHA conflicts.
 *
 * On ConflictError: retries with fresh HEAD SHA.
 * Backoff: 1s, 3s, 9s (exponential * 3).
 * After all retries exhausted: returns { success: false, error: 'conflict' }.
 * On non-ConflictError: rethrows immediately.
 *
 * @param {object} client - GitHub client (from createGitHubClient)
 * @param {object} params
 * @param {Function} [params.buildFiles] - async callback returning files array, called on each attempt (preferred)
 * @param {Array<{path: string, content: string}>} [params.files] - static files to commit (backward compat)
 * @param {string} params.message - commit message
 * @param {number} [params.maxRetries=3] - maximum number of retries
 * @returns {Promise<{commitSHA: string, success: true} | {success: false, error: 'conflict'}>}
 */
export async function atomicCommitWithRetry(
  client,
  { buildFiles, files, message, maxRetries = 3 }
) {
  const resolveFiles = buildFiles || (async () => files);
  const backoffs = [1000, 3000, 9000];

  // First attempt
  try {
    const currentFiles = await resolveFiles();
    return await atomicCommit(client, { files: currentFiles, message });
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
  }

  // Retry loop
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const delay = backoffs[attempt] ?? backoffs[backoffs.length - 1];
    await sleep(delay);

    try {
      const currentFiles = await resolveFiles();
      return await atomicCommit(client, { files: currentFiles, message });
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
    }
  }

  return { success: false, error: "conflict" };
}
