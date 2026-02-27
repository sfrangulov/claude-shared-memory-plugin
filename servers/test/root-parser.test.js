import { describe, it, expect } from "vitest";
import {
  splitTableRow,
  escapeTableCell,
  unescapeTableCell,
  parseRootMd,
  addEntryToRoot,
  updateEntryInRoot,
} from "../lib/root-parser.js";

// ---------------------------------------------------------------------------
// splitTableRow
// ---------------------------------------------------------------------------
describe("splitTableRow", () => {
  it("splits a simple row with leading/trailing pipes", () => {
    const result = splitTableRow("| alpha | beta | gamma |");
    expect(result).toEqual(["alpha", "beta", "gamma"]);
  });

  it("handles escaped pipes inside cells", () => {
    const result = splitTableRow("| a \\| b | c |");
    expect(result).toEqual(["a | b", "c"]);
  });

  it("splits a row without leading/trailing pipes", () => {
    const result = splitTableRow("alpha | beta | gamma");
    expect(result).toEqual(["alpha", "beta", "gamma"]);
  });

  it("trims whitespace from cell values", () => {
    const result = splitTableRow("|  foo  |  bar  |  baz  |");
    expect(result).toEqual(["foo", "bar", "baz"]);
  });
});

// ---------------------------------------------------------------------------
// escapeTableCell / unescapeTableCell
// ---------------------------------------------------------------------------
describe("escapeTableCell", () => {
  it("escapes pipe characters", () => {
    expect(escapeTableCell("a | b | c")).toBe("a \\| b \\| c");
  });

  it("returns text unchanged when no pipes present", () => {
    expect(escapeTableCell("no pipes here")).toBe("no pipes here");
  });
});

describe("unescapeTableCell", () => {
  it("unescapes pipe characters", () => {
    expect(unescapeTableCell("a \\| b \\| c")).toBe("a | b | c");
  });

  it("returns text unchanged when no escaped pipes", () => {
    expect(unescapeTableCell("no pipes here")).toBe("no pipes here");
  });
});

// ---------------------------------------------------------------------------
// parseRootMd
// ---------------------------------------------------------------------------
describe("parseRootMd", () => {
  it("parses a standard 3-entry table", () => {
    const md = [
      "# Project Alpha",
      "",
      "Short project description.",
      "",
      "## Table of Contents",
      "",
      "| Entry | Description | Tags |",
      "|-------|-------------|------|",
      "| [overview](overview.md) | Project goals, current status | goals, status |",
      "| [stack](stack.md) | Rive, React, Node.js | tech, stack |",
      "| [auth](auth.md) | JWT + refresh tokens | auth, decision |",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual({
      name: "overview",
      file: "overview.md",
      description: "Project goals, current status",
      tags: ["goals", "status"],
    });
    expect(result.entries[1]).toEqual({
      name: "stack",
      file: "stack.md",
      description: "Rive, React, Node.js",
      tags: ["tech", "stack"],
    });
    expect(result.entries[2]).toEqual({
      name: "auth",
      file: "auth.md",
      description: "JWT + refresh tokens",
      tags: ["auth", "decision"],
    });
    expect(result.description).toBe(
      "# Project Alpha\n\nShort project description.\n\n## Table of Contents"
    );
    expect(result.corrupted).toBeUndefined();
  });

  it("parses tags with hyphens (e2e-testing, react-query)", () => {
    const md = [
      "# Proj",
      "",
      "| Entry | Description | Tags |",
      "|---|---|---|",
      "| [tests](tests.md) | End-to-end testing setup | e2e-testing, react-query |",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries[0].tags).toEqual(["e2e-testing", "react-query"]);
  });

  it("parses empty table (only header + separator)", () => {
    const md = [
      "# Empty Project",
      "",
      "Description here.",
      "",
      "| Entry | Description | Tags |",
      "|-------|-------------|------|",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries).toEqual([]);
    expect(result.corrupted).toBeUndefined();
  });

  it("handles escaped pipes in description", () => {
    const md = [
      "# P",
      "",
      "| Entry | Description | Tags |",
      "|---|---|---|",
      "| [doc](doc.md) | Use A \\| B pattern | patterns |",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries[0].description).toBe("Use A | B pattern");
  });

  it("handles flexible column order (Tags | Entry | Description)", () => {
    const md = [
      "# Alt Order",
      "",
      "| Tags | Entry | Description |",
      "|------|-------|-------------|",
      "| auth, jwt | [auth](auth.md) | Authentication setup |",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries[0]).toEqual({
      name: "auth",
      file: "auth.md",
      description: "Authentication setup",
      tags: ["auth", "jwt"],
    });
  });

  it("parses table without description lines before it", () => {
    const md = [
      "| Entry | Description | Tags |",
      "|---|---|---|",
      "| [a](a.md) | A desc | tag-a |",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries).toHaveLength(1);
    expect(result.description).toBe("");
  });

  it("handles unicode in description", () => {
    const md = [
      "# Проект",
      "",
      "| Entry | Description | Tags |",
      "|---|---|---|",
      "| [glossary](glossary.md) | Глоссарий терминов проекта | glossary |",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries[0].description).toBe("Глоссарий терминов проекта");
  });

  it("returns corrupted: true when no table header found", () => {
    const md = [
      "# Broken",
      "",
      "This file has no table at all.",
      "Just some text.",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.corrupted).toBe(true);
    expect(result.entries).toEqual([]);
  });

  it("handles description with special characters (quotes, parentheses)", () => {
    const md = [
      "# P",
      "",
      "| Entry | Description | Tags |",
      "|---|---|---|",
      '| [entry](entry.md) | Uses React.memo() and "hooks" for (re)rendering | react |',
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries[0].description).toBe(
      'Uses React.memo() and "hooks" for (re)rendering'
    );
  });

  it("handles table with missing Tags column", () => {
    const md = [
      "# P",
      "",
      "| Entry | Description |",
      "|---|---|",
      "| [entry](entry.md) | Some desc |",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.corrupted).toBeUndefined();
    expect(result.entries[0]).toEqual({
      name: "entry",
      file: "entry.md",
      description: "Some desc",
      tags: [],
    });
  });

  it("parses entry with plain text (no markdown link) in Entry column", () => {
    const md = [
      "# P",
      "",
      "| Entry | Description | Tags |",
      "|---|---|---|",
      "| plain-entry | Some description | misc |",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries[0]).toEqual({
      name: "plain-entry",
      file: "",
      description: "Some description",
      tags: ["misc"],
    });
  });

  it("handles trailing whitespace in rows", () => {
    const md = [
      "# P",
      "",
      "| Entry | Description | Tags |   ",
      "|---|---|---|  ",
      "| [a](a.md) | Desc A | tag1 |   ",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].tags).toEqual(["tag1"]);
  });

  it("handles empty tags column", () => {
    const md = [
      "# P",
      "",
      "| Entry | Description | Tags |",
      "|---|---|---|",
      "| [a](a.md) | Desc A |  |",
    ].join("\n");

    const result = parseRootMd(md);
    expect(result.entries[0].tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addEntryToRoot
// ---------------------------------------------------------------------------
describe("addEntryToRoot", () => {
  const baseMd = [
    "# Project",
    "",
    "Desc.",
    "",
    "| Entry | Description | Tags |",
    "|-------|-------------|------|",
    "| [old](old.md) | Old entry | misc |",
  ].join("\n");

  it("adds a new row to the table", () => {
    const entry = {
      file: "new-entry.md",
      name: "new-entry",
      description: "A brand new entry",
      tags: ["new", "feature"],
    };
    const { updated_markdown, was_added } = addEntryToRoot(baseMd, entry);
    expect(was_added).toBe(true);
    expect(updated_markdown).toContain("[new-entry](new-entry.md)");
    expect(updated_markdown).toContain("A brand new entry");
    expect(updated_markdown).toContain("new, feature");

    // verify the original row is still there
    expect(updated_markdown).toContain("[old](old.md)");
  });

  it("skips idempotently when file already exists", () => {
    const entry = {
      file: "old.md",
      name: "old",
      description: "Different description",
      tags: ["different"],
    };
    const { updated_markdown, was_added } = addEntryToRoot(baseMd, entry);
    expect(was_added).toBe(false);
    expect(updated_markdown).toBe(baseMd);
  });

  it("escapes pipes in description when adding", () => {
    const entry = {
      file: "pipes.md",
      name: "pipes",
      description: "Use A | B pattern",
      tags: ["patterns"],
    };
    const { updated_markdown, was_added } = addEntryToRoot(baseMd, entry);
    expect(was_added).toBe(true);
    // The raw markdown should have escaped pipes
    expect(updated_markdown).toContain("Use A \\| B pattern");
  });

  it("adds to an empty table (only header + separator)", () => {
    const emptyMd = [
      "# Project",
      "",
      "| Entry | Description | Tags |",
      "|-------|-------------|------|",
    ].join("\n");
    const entry = {
      file: "first.md",
      name: "first",
      description: "First entry",
      tags: ["init"],
    };
    const { updated_markdown, was_added } = addEntryToRoot(emptyMd, entry);
    expect(was_added).toBe(true);
    expect(updated_markdown).toContain("[first](first.md)");
    expect(updated_markdown).toContain("First entry");
    expect(updated_markdown).toContain("init");
  });

  it("preserves description text before the table", () => {
    const entry = {
      file: "new.md",
      name: "new",
      description: "New desc",
      tags: ["tag"],
    };
    const { updated_markdown } = addEntryToRoot(baseMd, entry);
    expect(updated_markdown).toMatch(/^# Project\n\nDesc\./);
  });
});

// ---------------------------------------------------------------------------
// updateEntryInRoot
// ---------------------------------------------------------------------------
describe("updateEntryInRoot", () => {
  const baseMd = [
    "# Project",
    "",
    "| Entry | Description | Tags |",
    "|-------|-------------|------|",
    "| [overview](overview.md) | Old overview desc | goals, status |",
    "| [stack](stack.md) | Tech stack | tech |",
  ].join("\n");

  it("updates description and tags for a matching file", () => {
    const result = updateEntryInRoot(baseMd, "overview.md", {
      description: "New overview description",
      tags: ["goals", "overview", "updated"],
    });
    expect(result).toContain("New overview description");
    expect(result).toContain("goals, overview, updated");
    // other row should be untouched
    expect(result).toContain("Tech stack");
    expect(result).toContain("tech");
  });

  it("returns original markdown if file not found", () => {
    const result = updateEntryInRoot(baseMd, "nonexistent.md", {
      description: "Won't be used",
    });
    expect(result).toBe(baseMd);
  });

  it("updates only description when tags not provided", () => {
    const result = updateEntryInRoot(baseMd, "overview.md", {
      description: "Updated desc only",
    });
    expect(result).toContain("Updated desc only");
    // tags should remain unchanged
    expect(result).toContain("goals, status");
  });

  it("updates only tags when description not provided", () => {
    const result = updateEntryInRoot(baseMd, "overview.md", {
      tags: ["new-tag"],
    });
    expect(result).toContain("new-tag");
    // description should remain unchanged
    expect(result).toContain("Old overview desc");
  });

  it("escapes pipes in updated description", () => {
    const result = updateEntryInRoot(baseMd, "overview.md", {
      description: "A | B pattern",
    });
    expect(result).toContain("A \\| B pattern");
  });

  it("preserves escaped pipes in unchanged columns during update", () => {
    const mdWithPipes = [
      "# Project",
      "",
      "| Entry | Description | Tags |",
      "|-------|-------------|------|",
      "| [doc](doc.md) | Use A \\| B pattern | patterns |",
    ].join("\n");

    const result = updateEntryInRoot(mdWithPipes, "doc.md", {
      tags: ["new-tag"],
    });
    // Description should still have escaped pipe in the raw markdown
    expect(result).toContain("A \\| B pattern");
    expect(result).toContain("new-tag");
  });
});
