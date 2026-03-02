/**
 * Shared helper functions for entry content building and metadata parsing.
 *
 * @module helpers
 */

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "of", "in", "to",
  "for", "with", "on", "at", "from", "by", "about", "as", "into",
  "through", "during", "before", "after", "above", "below", "and", "but",
  "or", "nor", "not", "so", "yet", "both", "either", "neither", "each",
  "every", "all", "any", "few", "more", "most", "other", "some", "such",
  "no", "only", "own", "same", "than", "too", "very", "just", "because",
  "if", "when", "how", "what", "which", "who", "whom", "this", "that",
  "these", "those", "it", "its", "we", "our", "they", "their", "he",
  "she", "his", "her",
]);

export function extractKeywords(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function buildEntryContent({ title, date, author, tags, content, related }) {
  let md = `# ${title}\n\n`;
  md += `- **Date:** ${date}\n`;
  md += `- **Author:** ${author}\n`;
  md += `- **Tags:** ${tags.join(", ")}\n\n`;
  md += content;
  if (related && related.length > 0) {
    md += `\n\n## Related\n\n`;
    for (const r of related) {
      md += `- [${r}](${r})\n`;
    }
  }
  return md;
}

export function parseEntryMetadata(content) {
  const lines = content.split("\n");
  const result = {
    title: "",
    date: "",
    author: "",
    tags: [],
    content: "",
    related: [],
  };

  // Title from first # heading
  for (const line of lines) {
    if (line.startsWith("# ")) {
      result.title = line.slice(2).trim();
      break;
    }
  }

  // Metadata fields
  for (const line of lines) {
    const dateMatch = line.match(/^\s*-\s*\*\*Date:\*\*\s*(.+)/);
    if (dateMatch) result.date = dateMatch[1].trim();

    const authorMatch = line.match(/^\s*-\s*\*\*Author:\*\*\s*(.+)/);
    if (authorMatch) result.author = authorMatch[1].trim();

    const tagsMatch = line.match(/^\s*-\s*\*\*Tags:\*\*\s*(.+)/);
    if (tagsMatch)
      result.tags = tagsMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
  }

  // Related section
  const relatedIdx = content.indexOf("## Related");
  if (relatedIdx !== -1) {
    const relatedSection = content.slice(relatedIdx);
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRe.exec(relatedSection)) !== null) {
      result.related.push(match[2]);
    }
  }

  // Content: everything between metadata and Related section (or end)
  const tagsIdx = content.indexOf("**Tags:**");
  const contentStart = tagsIdx !== -1 ? content.indexOf("\n\n", tagsIdx) : -1;
  const contentEnd = relatedIdx !== -1 ? relatedIdx : content.length;
  if (contentStart !== -1) {
    result.content = content.slice(contentStart, contentEnd).trim();
  }

  return result;
}

export function findRelated(entries, tags, excludeFile) {
  return entries
    .filter((e) => e.file !== excludeFile)
    .map((e) => {
      const commonTags = e.tags.filter((t) => tags.includes(t));
      return {
        file: e.file,
        common_tags: commonTags,
        match_count: commonTags.length,
      };
    })
    .filter((r) => r.match_count >= 1)
    .sort((a, b) => b.match_count - a.match_count);
}
