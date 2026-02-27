---
description: Switch or create a project
allowed-tools: ["mcp__shared-memory__list_projects", "mcp__shared-memory__switch_project",
                "mcp__shared-memory__get_state"]
argument-hint: "[project name]"
---

The user wants to switch projects. Target: $ARGUMENTS

If no argument provided, show the list of available projects with entry counts.
If argument provided, try to switch to it. Show the project summary on success.

Examples:
- /project mobile-app
- /project (shows list)
