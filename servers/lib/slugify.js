import { transliterate } from "transliteration";

/**
 * Reserved slug names that conflict with system files/folders.
 * These are checked in their slug form (after transliteration and normalization).
 * Original system names: root, _meta, _shared, shared
 * After slug processing: root, meta, shared
 */
const RESERVED_SLUGS = new Set(["root", "meta", "shared"]);

const MAX_LENGTH = 60;

/**
 * Converts a title string into a URL/filename-safe slug.
 *
 * Rules (applied in order):
 * 1. Transliterate non-Latin characters (e.g. "Привет" -> "privet")
 * 2. Lowercase
 * 3. Replace everything except a-z, 0-9 with hyphens
 * 4. Remove leading/trailing hyphens and collapse duplicate hyphens
 * 5. Truncate to max 60 characters (trim any trailing hyphen from truncation)
 * 6. Check reserved names: root, meta, shared -> add suffix "-entry"
 *
 * @param {string} title - The title to convert
 * @returns {string} The generated slug
 */
export function slugify(title) {
  if (!title) return "";

  // 1. Transliterate non-Latin characters
  let slug = transliterate(title);

  // 2. Lowercase
  slug = slug.toLowerCase();

  // 3. Replace everything except a-z, 0-9 with hyphens
  slug = slug.replace(/[^a-z0-9]/g, "-");

  // 4. Collapse duplicate hyphens and remove leading/trailing hyphens
  slug = slug.replace(/-+/g, "-").replace(/^-|-$/g, "");

  // 5. Truncate to max 60 characters, then trim any trailing hyphen
  if (slug.length > MAX_LENGTH) {
    slug = slug.slice(0, MAX_LENGTH).replace(/-$/, "");
  }

  // 6. Check reserved names
  if (RESERVED_SLUGS.has(slug)) {
    slug = `${slug}-entry`;
  }

  return slug;
}

/**
 * Ensures a slug is unique among existing files.
 * If `slug.md` already exists in the file list, appends an incrementing
 * suffix: slug-2, slug-3, etc.
 *
 * @param {string} slug - The base slug to check
 * @param {string[]} existingFiles - Array of existing filenames (e.g. ["hello.md", "world.md"])
 * @returns {string} A unique slug
 */
export function ensureUnique(slug, existingFiles) {
  const fileSet = new Set(existingFiles);

  if (!fileSet.has(`${slug}.md`)) {
    return slug;
  }

  let counter = 2;
  while (fileSet.has(`${slug}-${counter}.md`)) {
    counter++;
  }

  return `${slug}-${counter}`;
}
