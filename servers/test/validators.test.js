import { describe, it, expect } from "vitest";
import { validateProjectName, validateFileName } from "../lib/validators.js";

describe("validateProjectName", () => {
  it("accepts valid project names", () => {
    expect(() => validateProjectName("mobile-app")).not.toThrow();
    expect(() => validateProjectName("backend-api")).not.toThrow();
    expect(() => validateProjectName("_shared")).not.toThrow();
  });

  it("rejects path traversal attempts", () => {
    expect(() => validateProjectName("../etc")).toThrow("Invalid project name");
    expect(() => validateProjectName("../../secrets")).toThrow("Invalid project name");
    expect(() => validateProjectName("foo/../bar")).toThrow("Invalid project name");
  });

  it("rejects names with slashes", () => {
    expect(() => validateProjectName("foo/bar")).toThrow("Invalid project name");
    expect(() => validateProjectName("a/b/c")).toThrow("Invalid project name");
  });

  it("rejects names starting with dot", () => {
    expect(() => validateProjectName(".hidden")).toThrow("Invalid project name");
    expect(() => validateProjectName(".git")).toThrow("Invalid project name");
  });

  it("rejects empty strings", () => {
    expect(() => validateProjectName("")).toThrow("Invalid project name");
  });
});

describe("validateFileName", () => {
  it("accepts valid filenames", () => {
    expect(() => validateFileName("auth-architecture.md")).not.toThrow();
    expect(() => validateFileName("rive-vs-lottie.md")).not.toThrow();
  });

  it("rejects path traversal", () => {
    expect(() => validateFileName("../secret.md")).toThrow("Invalid file name");
    expect(() => validateFileName("foo/../../etc")).toThrow("Invalid file name");
  });

  it("rejects names with slashes", () => {
    expect(() => validateFileName("sub/file.md")).toThrow("Invalid file name");
  });

  it("rejects empty strings", () => {
    expect(() => validateFileName("")).toThrow("Invalid file name");
  });
});
