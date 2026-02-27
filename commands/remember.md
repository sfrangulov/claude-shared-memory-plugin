---
description: Save to shared team memory
allowed-tools: ["mcp__shared-memory__write_entry", "mcp__shared-memory__check_duplicate",
                "mcp__shared-memory__read_root", "mcp__shared-memory__get_state",
                "mcp__shared-memory__switch_project"]
argument-hint: "<what to remember>"
---

The user wants to save this to shared team memory: $ARGUMENTS

Follow the shared-memory skill "Workflow: Writing" section.
Important: determine the target project first (active project, _shared, or ask user).
Always confirm with the user before committing.

Examples:
- /remember we decided to use Rive instead of Lottie for animations
- /remember решили использовать PostgreSQL вместо MongoDB
