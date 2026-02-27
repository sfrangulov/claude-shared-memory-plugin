---
description: Search shared team memory
allowed-tools: ["mcp__shared-memory__read_root", "mcp__shared-memory__read_entry",
                "mcp__shared-memory__search_tags", "mcp__shared-memory__search_author",
                "mcp__shared-memory__search_deep", "mcp__shared-memory__get_state"]
argument-hint: "<search query>"
---

Search the team's shared memory for: $ARGUMENTS

Follow the shared-memory skill "Workflow: Searching" section.
Start by checking the active project with get_state, then search.

Examples:
- /memory what animation library did we choose?
- /memory что мы решили про авторизацию?
