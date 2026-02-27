/**
 * Markdown table parser for root.md files.
 *
 * Handles parsing, adding, and updating entries in the table of contents
 * that lives inside each project's root.md file.
 *
 * @module root-parser
 */

/** Regex that matches a separator line like |---|---|---| */
const SEPARATOR_RE = /^\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/;

/** Regex that matches a markdown link [name](file.md) */
const LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;

/**
 * Splits a markdown table row into cell values, respecting escaped `\|`.
 *
 * Algorithm (from spec):
 * 1. Remove leading/trailing `|` from the line
 * 2. Walk character by character:
 *    - If char is `\` and next char is `|` -> append `|` to current cell, skip next
 *    - If char is `|` -> push current cell (trimmed) to result, start new cell
 *    - Otherwise -> append char to current cell
 * 3. Push final cell (trimmed) to result
 *
 * @param {string} line - a single markdown table row
 * @returns {string[]} array of cell values (trimmed, unescaped)
 */
export function splitTableRow(line) {
  let s = line;

  // Remove leading pipe (with optional whitespace)
  if (s.startsWith("|")) {
    s = s.slice(1);
  }
  // Remove trailing pipe (with optional whitespace)
  const trimmedEnd = s.trimEnd();
  if (trimmedEnd.endsWith("|")) {
    // Make sure it's not an escaped pipe
    if (!trimmedEnd.endsWith("\\|")) {
      s = trimmedEnd.slice(0, -1);
    }
  }

  const cells = [];
  let current = "";

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && s[i + 1] === "|") {
      current += "|";
      i++; // skip next char
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  // Push the final cell
  cells.push(current.trim());

  return cells;
}

/**
 * Escapes pipe characters in text for safe inclusion in a markdown table cell.
 * Replaces `|` with `\|`.
 *
 * @param {string} text - raw text
 * @returns {string} escaped text
 */
export function escapeTableCell(text) {
  return text.replace(/\|/g, "\\|");
}

/**
 * Reverses pipe escaping. Replaces `\|` with `|`.
 *
 * @param {string} text - escaped text
 * @returns {string} unescaped text
 */
export function unescapeTableCell(text) {
  return text.replace(/\\\|/g, "|");
}

/**
 * Finds the table header row in an array of lines and returns the column
 * index mapping. The header columns can appear in any order.
 *
 * @param {string[]} lines - all lines of the markdown document
 * @returns {{ headerIndex: number, columnMap: Record<string, number> } | null}
 */
function findTableHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // A header row must contain at least a pipe and the word "Entry"
    if (!line.includes("|")) continue;

    const cells = splitTableRow(line);
    const lower = cells.map((c) => c.toLowerCase().trim());

    const entryIdx = lower.indexOf("entry");
    if (entryIdx === -1) continue;

    // Check that a separator line follows
    if (i + 1 < lines.length && SEPARATOR_RE.test(lines[i + 1].trim())) {
      const columnMap = {};
      for (let j = 0; j < lower.length; j++) {
        if (lower[j] === "entry") columnMap.entry = j;
        else if (lower[j] === "description") columnMap.description = j;
        else if (lower[j] === "tags") columnMap.tags = j;
      }
      return { headerIndex: i, columnMap };
    }
  }
  return null;
}

/**
 * Parses a root.md markdown string into a structured object.
 *
 * @param {string} markdown - full content of root.md
 * @returns {{ description: string, entries: Array<{ name: string, file: string, description: string, tags: string[] }>, corrupted?: boolean }}
 */
export function parseRootMd(markdown) {
  const lines = markdown.split("\n");
  const header = findTableHeader(lines);

  if (!header) {
    return { description: "", entries: [], corrupted: true };
  }

  const { headerIndex, columnMap } = header;

  // Description = everything before the table header line
  const descriptionLines = lines.slice(0, headerIndex);
  // Trim trailing empty lines from description
  while (
    descriptionLines.length > 0 &&
    descriptionLines[descriptionLines.length - 1].trim() === ""
  ) {
    descriptionLines.pop();
  }
  const description = descriptionLines.join("\n");

  const entries = [];

  // Start parsing from headerIndex + 2 (skip header and separator)
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.includes("|")) continue;
    if (SEPARATOR_RE.test(line)) continue;

    const cells = splitTableRow(lines[i]);

    const entryCell =
      columnMap.entry !== undefined ? cells[columnMap.entry] ?? "" : "";
    const descCell =
      columnMap.description !== undefined
        ? cells[columnMap.description] ?? ""
        : "";
    const tagsCell =
      columnMap.tags !== undefined ? cells[columnMap.tags] ?? "" : "";

    // Parse entry cell: could be [name](file.md) or plain text
    const linkMatch = entryCell.match(LINK_RE);
    let name = "";
    let file = "";
    if (linkMatch) {
      name = linkMatch[1];
      file = linkMatch[2];
    } else {
      name = entryCell;
      file = "";
    }

    // Parse tags: split by comma, trim, filter empty
    const tags = tagsCell
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    entries.push({ name, file, description: descCell, tags });
  }

  return { description, entries };
}

/**
 * Adds an entry row to a root.md markdown table. Idempotent: if a row with
 * the same filename already exists, the markdown is returned unchanged.
 *
 * @param {string} markdown - full content of root.md
 * @param {{ file: string, name: string, description: string, tags: string[] }} entry
 * @returns {{ updated_markdown: string, was_added: boolean }}
 */
export function addEntryToRoot(markdown, entry) {
  const lines = markdown.split("\n");
  const header = findTableHeader(lines);

  if (!header) {
    // If there's no table, we can't add to it
    return { updated_markdown: markdown, was_added: false };
  }

  const { headerIndex, columnMap } = header;

  // Check idempotency: does a row with this filename already exist?
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.includes("|")) continue;
    if (SEPARATOR_RE.test(line)) continue;

    const cells = splitTableRow(lines[i]);
    const entryCell =
      columnMap.entry !== undefined ? cells[columnMap.entry] ?? "" : "";

    // Check if filename matches (parse link or compare plain text)
    const linkMatch = entryCell.match(LINK_RE);
    const existingFile = linkMatch ? linkMatch[2] : "";

    if (existingFile === entry.file) {
      return { updated_markdown: markdown, was_added: false };
    }
  }

  // Build the new row in the correct column order
  const entryValue = `[${escapeTableCell(entry.name)}](${entry.file})`;
  const descValue = escapeTableCell(entry.description);
  const tagsValue = escapeTableCell(entry.tags.join(", "));

  // Determine the number of columns from the header
  const headerCells = splitTableRow(lines[headerIndex]);
  const newRowCells = new Array(headerCells.length).fill("");

  if (columnMap.entry !== undefined) newRowCells[columnMap.entry] = entryValue;
  if (columnMap.description !== undefined)
    newRowCells[columnMap.description] = descValue;
  if (columnMap.tags !== undefined) newRowCells[columnMap.tags] = tagsValue;

  const newRow = "| " + newRowCells.join(" | ") + " |";

  // Find the last table row to append after it
  let lastTableRowIndex = headerIndex + 1; // separator line
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.includes("|")) break;
    if (line === "") break;
    lastTableRowIndex = i;
  }

  // Insert the new row after the last table row
  const updatedLines = [
    ...lines.slice(0, lastTableRowIndex + 1),
    newRow,
    ...lines.slice(lastTableRowIndex + 1),
  ];

  return { updated_markdown: updatedLines.join("\n"), was_added: true };
}

/**
 * Updates an existing entry row in a root.md markdown table.
 * Only updates the fields provided in `changes`. Returns the original
 * markdown if the filename is not found.
 *
 * @param {string} markdown - full content of root.md
 * @param {string} filename - the filename to match (e.g. "overview.md")
 * @param {{ description?: string, tags?: string[] }} changes
 * @returns {string} updated markdown
 */
export function updateEntryInRoot(markdown, filename, changes) {
  const lines = markdown.split("\n");
  const header = findTableHeader(lines);

  if (!header) {
    return markdown;
  }

  const { headerIndex, columnMap } = header;

  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.includes("|")) continue;
    if (SEPARATOR_RE.test(line)) continue;

    const cells = splitTableRow(lines[i]);
    const entryCell =
      columnMap.entry !== undefined ? cells[columnMap.entry] ?? "" : "";

    const linkMatch = entryCell.match(LINK_RE);
    const existingFile = linkMatch ? linkMatch[2] : "";

    if (existingFile !== filename) continue;

    // Found the row — rebuild it with changes applied
    const headerCells = splitTableRow(lines[headerIndex]);
    const newCells = new Array(headerCells.length).fill("");

    // Populate all cells from the current row, re-escaping preserved values
    for (let j = 0; j < headerCells.length; j++) {
      newCells[j] = escapeTableCell(cells[j] ?? "");
    }

    // Apply changes (these get escaped as well)
    if (changes.description !== undefined && columnMap.description !== undefined) {
      newCells[columnMap.description] = escapeTableCell(changes.description);
    }
    if (changes.tags !== undefined && columnMap.tags !== undefined) {
      newCells[columnMap.tags] = changes.tags.join(", ");
    }

    const updatedRow = "| " + newCells.join(" | ") + " |";
    lines[i] = updatedRow;

    return lines.join("\n");
  }

  // Filename not found — return original
  return markdown;
}
