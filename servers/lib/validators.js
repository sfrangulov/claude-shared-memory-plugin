/**
 * Input validation utilities for path safety.
 *
 * @module validators
 */

/**
 * Validates a project name is safe (no path traversal, no slashes).
 * Allows underscore-prefixed system folders like "_shared".
 *
 * @param {string} name - Project folder name
 * @throws {Error} if name is invalid
 */
export function validateProjectName(name) {
  if (
    !name ||
    name.includes("..") ||
    name.includes("/") ||
    name.startsWith(".")
  ) {
    throw new Error(
      `Invalid project name: "${name}". Must not contain "..", "/", or start with "."`
    );
  }
}

/**
 * Validates an entry filename is safe (no path traversal, no slashes).
 *
 * @param {string} name - Entry filename
 * @throws {Error} if name is invalid
 */
export function validateFileName(name) {
  if (
    !name ||
    name.includes("..") ||
    name.includes("/")
  ) {
    throw new Error(
      `Invalid file name: "${name}". Must not contain ".." or "/".`
    );
  }
}
