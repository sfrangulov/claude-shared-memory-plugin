---
name: shared-memory
description: >
  **Shared Team Memory**: Use this skill whenever the user mentions shared memory,
  team knowledge, team decisions, or when looking up information that should come
  from the team's knowledge base. Triggers: "запомни для команды", "общая память",
  "что мы решили", "кто в команде", "сохрани решение", "добавь в общую память",
  "shared memory", "team memory", "save for the team", "what did we decide",
  "save this decision". Also triggers when context requires information that
  individual Claude memory wouldn't have (cross-team decisions, project
  architecture, team contacts).
version: 1.0.0
---

# Claude Shared Memory

You have access to a shared team knowledge base stored in a GitHub repository.
Use the shared-memory MCP tools (prefixed as `mcp__shared-memory__*` in your
tool list; internally registered as `read_root`, `write_entry`, etc.).

## Core Principles

1. **Never write automatically.** Only write to shared memory when the user
   explicitly asks. Triggers (RU): "запомни для команды", "добавь в общую память",
   "сохрани решение". Triggers (EN): "save for the team", "remember this for everyone".
2. **Always re-read.** Never rely on previously loaded data. Call `read_root`
   before every search or write operation.
3. **Explicit source attribution.** When answering from shared memory, say:
   - RU: "Согласно общей памяти команды, ..."
   - EN: "According to the team's shared memory, ..."
4. **Separation from local memory.** Shared memory ≠ your built-in memory.
   If the user says "запомни" / "remember this" without clarification, ask:
   - RU: "В общую память команды или в локальную?"
   - EN: "Should I save this to the team's shared memory or just my local memory?"

## Workflow: First-Time Onboarding

On the very first session (no state file exists yet AND `connect_repo` returns `status: "initialized"`):

1. Greet the user briefly:
   RU: "Общая память команды подключена! Репозиторий инициализирован."
   EN: "Team shared memory connected! Repository initialized."
2. Explain in 2-3 sentences what they can do:
   RU: "Используйте /remember чтобы сохранить решение, /memory чтобы найти что-то, /project чтобы переключить проект."
   EN: "Use /remember to save a decision, /memory to find something, /project to switch projects."
3. Suggest next steps with concrete dialogue:
   RU: "Хотите создать первый проект? (например, 'mobile-app')
   Или сохранить знание в общую память (_shared — доступно всем)?"
   EN: "Would you like to create a new project? (e.g., 'mobile-app')
   Or save knowledge to shared memory (_shared — available to everyone)?"

This only fires once per repository (detected by `connect_repo` returning `status: "initialized"`). Subsequent sessions skip to the normal Startup & Connection workflow.

## Workflow: Startup & Connection

On first invocation in a session:

1. Call `get_state` — check if there's an active project from previous session
2. Call `connect_repo` — connect to the GitHub repository
3. If `connect_repo` returns `status: "error"`:
   - Auth error → tell user: "Access token is invalid. Please update it in plugin settings."
     / "Токен доступа невалиден. Обновите в настройках плагина."
   - Repo error → tell user: "Repository not found. Check URL and token."
     / "Репозиторий не найден. Проверьте URL и токен."
   - **Continue without memory** (fallback mode) — do not block the user's workflow.
4. On success → read `_shared/root.md` and active project from state

## Workflow: Reading Context

When the user asks a question that might be in shared memory:

1. Call `get_state` to check active project
2. Call `read_root` for the active project (if any) and for `_shared`
3. Extract keywords from the user's question (use your judgment, not mechanical split)
4. Match keywords against Tags (exact) and Description (substring) — see references/matching-algorithm.md
5. Load relevant entries with `read_entry`:
   - 1 candidate → load automatically
   - 2-5 candidates → load all (context budget: max 5 entries at once).
     Show progress: "Loading N relevant entries from memory..." / "Загружаю N записей из памяти..."
   - >5 candidates → show list with descriptions and project names, ask user to select (max 5)
   **Hard limit:** Never load more than 5 entries in a single operation. If skill needs more context, ask user to narrow the query or select specific entries.
6. Answer the user, citing the source. Always show project name next to each entry:
   "**[title]** (project-name)" or "**[title]** (_shared)"

## Workflow: Writing

When the user asks to save something:

0. **Check intent — local vs shared:**
   - Explicit shared trigger ("remember for the team", "запомни для команды") → proceed to step 1
   - Explicit local trigger ("remember just for me", "запомни для меня") → use local memory, skip shared workflow
   - Ambiguous ("remember this", "запомни") → ask once:
     RU: "В общую память команды или в локальную?"
     EN: "Save to the team's shared memory or just my local memory?"
1. **Determine target project:**
   - If user explicitly names the project ("в проекте Alpha" / "in project Alpha") → use it
   - If `active_project` exists in state → ask:
     RU: "Сохранить в [project] или в другой проект?"
     EN: "Save to [project] or a different project?"
   - If no active project → show combined single prompt (avoid sequential questions):
     RU: "Где сохранить? В общую память (_shared — для всех) или в проект? [список проектов]"
     EN: "Where should I save this? Shared memory (_shared — for everyone) or a project? [project list]"
     If project selected → call `switch_project` first
2. Call `check_duplicate` to look for existing entries
3. If duplicate found → show WHY it matched and ask user:
   RU: "Похожая запись уже существует: **[name]** (совпадение: теги [common_tags], [keyword_overlap]% совпадение ключевых слов). Создать новую или обновить существующую?"
   EN: "A similar entry already exists: **[name]** (match: tags [common_tags], [keyword_overlap]% keyword overlap). Create a new one or update the existing one?"
4. Prepare: title, tags (suggest from existing — see tag suggestions below), description (max 80 chars), content
5. Call `write_entry` with `auto_related: true`
6. If output contains `related_candidates` (>3 matches) → show list to user, ask to choose, then retry with `related_override`
7. Confirm to user with entry name and project

**UX optimization — minimize sequential questions:**
When the skill has enough context to infer the target project (active project exists,
or user explicitly said "shared"), skip the project selection question. Prefer
reasonable defaults over extra confirmation steps.

## Workflow: Updating

When user says "обнови" / "update":

1. Find the entry via `search_tags` or `read_root`
2. If multiple candidates → show list, ask to choose
3. Call `read_entry` to get current version — **save the returned `sha`**
4. Apply changes to the content
5. Call `update_entry` with `previous_sha` = SHA from step 3
6. If response `status: "concurrent_edit"` → show user `diff_summary` and clarify consequence:
   RU: "Эта запись обновлена [author] [date]. Что изменилось: [diff_summary].
   Если продолжите, ваши изменения заменят ВЕСЬ текст записи. Продолжить?"
   EN: "This entry was updated by [author] on [date]. What changed: [diff_summary].
   If you proceed, your changes will replace the ENTIRE entry text. Continue?"

## Workflow: Searching

See references/matching-algorithm.md for the full algorithm.

**Search mode decision tree:**
1. Query contains a person's name → `search_author`
2. Query contains specific technical terms, tags, or topics → `search_tags` (fast)
3. Fast search returned no results → offer `search_deep` (full-text)
4. User explicitly asks for deep search → `search_deep`

**Presenting results:**
- ≤5 entries → show all with brief description from root.md
- 6–15 entries → compact list (title + project)
- >15 entries → first 15 + message:
  RU: "Найдено N записей, уточните запрос"
  EN: "Found N entries, please refine your query"

**Tag suggestions when writing:**
1. Show the 5 most-used tags in the active project
2. If user proposes a new tag similar to existing, suggest the existing one

## Workflow: Project Management

- `/project` or "подключи проект" / "switch project" → call `list_projects`, show options
- On switch → call `switch_project`, show summary IMMEDIATELY
- If project doesn't exist → ask to create

## Error Responses

See references/error-handling.md for templates.

## Bilingual Glossary

| English | Russian | Notes |
|---------|---------|-------|
| project | проект | Translate in narrative |
| project-alpha | project-alpha | Folder name — never translate |
| shared memory | общая память | Feature name — always translate |
| _shared | _shared | Folder name — never translate |
| entry | запись | Always translate |
| tag | тег | Always translate |
| root.md | root.md | Filename — never translate |

## Commands Quick Reference

```
/memory <query>     — search shared memory
/remember <text>    — save a new entry
/project [name]     — switch project or show list

Examples:
  /memory what did we decide about Rive?
  /memory что мы решили про авторизацию?
  /remember decided to use PostgreSQL
  /remember решили использовать Rive вместо Lottie
  /project mobile-app
  /project
```
