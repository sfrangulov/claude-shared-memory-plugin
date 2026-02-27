import { describe, it, expect } from "vitest";
import { slugify, ensureUnique } from "../lib/slugify.js";

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
describe("slugify", () => {
  it("converts basic English title to slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("transliterates Cyrillic characters", () => {
    expect(slugify("Привет мир")).toBe("privet-mir");
  });

  it("removes special characters", () => {
    expect(slugify("Rive vs. Lottie!")).toBe("rive-vs-lottie");
  });

  it("collapses multiple consecutive hyphens", () => {
    expect(slugify("hello---world")).toBe("hello-world");
  });

  it("removes leading and trailing hyphens", () => {
    expect(slugify("--hello-world--")).toBe("hello-world");
  });

  it("truncates to max 60 characters without trailing hyphen", () => {
    // Create a title that produces a slug longer than 60 characters
    const longTitle =
      "This is a very long title that should be truncated to sixty characters maximum";
    const result = slugify(longTitle);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).not.toMatch(/-$/);
  });

  it("adds -entry suffix to reserved name root", () => {
    expect(slugify("root")).toBe("root-entry");
  });

  it("adds -entry suffix to reserved name _meta (slug becomes meta)", () => {
    // "_meta" → transliterate → lowercase → replace non-alphanum → "-meta"
    // → trim leading hyphen → "meta" → reserved → "meta-entry"
    expect(slugify("_meta")).toBe("meta-entry");
  });

  it("adds -entry suffix to reserved name _shared (slug becomes shared)", () => {
    // "_shared" → transliterate → lowercase → replace non-alphanum → "-shared"
    // → trim leading hyphen → "shared" → reserved → "shared-entry"
    expect(slugify("_shared")).toBe("shared-entry");
  });

  it("adds -entry suffix to reserved name shared", () => {
    expect(slugify("shared")).toBe("shared-entry");
  });

  it("handles mixed language (Latin + Cyrillic)", () => {
    // transliteration library renders "х" as "h" (not "kh")
    expect(slugify("Auth архитектура")).toBe("auth-arhitektura");
  });

  it("preserves numbers in the slug", () => {
    expect(slugify("Version 2.0")).toBe("version-2-0");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles string of only special characters", () => {
    const result = slugify("@#$%^&*");
    expect(result).toBe("");
  });

  it("handles single word", () => {
    expect(slugify("Testing")).toBe("testing");
  });

  it("truncates and removes trailing hyphen from truncation boundary", () => {
    // Build a slug where position 60 falls on a hyphen
    // "a]59 chars + "-b..." => should truncate and trim trailing hyphen
    const title = "a".repeat(60) + " b";
    const result = slugify(title);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).not.toMatch(/-$/);
  });
});

// ---------------------------------------------------------------------------
// ensureUnique
// ---------------------------------------------------------------------------
describe("ensureUnique", () => {
  it("returns slug as-is when no conflict exists", () => {
    const result = ensureUnique("hello-world", ["other.md", "readme.md"]);
    expect(result).toBe("hello-world");
  });

  it("appends -2 on first conflict", () => {
    const result = ensureUnique("hello-world", [
      "hello-world.md",
      "other.md",
    ]);
    expect(result).toBe("hello-world-2");
  });

  it("increments suffix when multiple conflicts exist", () => {
    const result = ensureUnique("hello-world", [
      "hello-world.md",
      "hello-world-2.md",
      "hello-world-3.md",
    ]);
    expect(result).toBe("hello-world-4");
  });

  it("returns slug as-is when existingFiles is empty", () => {
    const result = ensureUnique("my-slug", []);
    expect(result).toBe("my-slug");
  });

  it("is case-sensitive when checking existing files", () => {
    const result = ensureUnique("hello", ["Hello.md"]);
    expect(result).toBe("hello");
  });
});
