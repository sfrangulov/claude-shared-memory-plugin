# UX Response Patterns

Bilingual response templates for all user-facing scenarios.

## Entry Creation Confirmation

**RU:** "Сохранено в [project]: **[title]** (теги: [tags])"
**EN:** "Saved to [project]: **[title]** (tags: [tags])"

## Duplicate Warning

**RU:** "Похожая запись уже существует: **[name]** ([match_reason]). Создать новую или обновить существующую?"
**EN:** "A similar entry already exists: **[name]** ([match_reason]). Create a new one or update the existing one?"

## Search Results

### ≤5 results
Show each with full description:
- **[title]** ([project]) — [description]

### 6-15 results
Compact list:
- [title] ([project])

### >15 results
**RU:** "Найдено [total_count] записей, показываю первые 15. Уточните запрос для более точных результатов."
**EN:** "Found [total_count] entries, showing first 15. Refine your query for more precise results."

## Project Connection Summary

**RU (with entries):** "Проект [name]: [count] записей, последняя от [date]"
**EN (with entries):** "Project [name]: [count] entries, last entry from [date]"

**RU (empty):** "Проект [name]: пока пусто. Создайте первую запись!"
**EN (empty):** "Project [name]: empty for now. Create the first entry!"

## Deep Search Warning

**RU:** "Глубокий поиск использует индекс GitHub, который может обновляться с задержкой до 1 часа. Результаты могут не включать самые свежие записи."
**EN:** "Deep search uses GitHub's index, which may be updated with a delay of up to 1 hour. Results may not include the most recent entries."

## Context Loss Recovery

**RU:** "Память восстановлена. Работаю с проектом [name]."
**EN:** "Memory recovered. Working with project [name]."

## Tag Suggestions

**RU:** "Часто используемые теги: [tags]. Какие подойдут?"
**EN:** "Common tags in this project: [tags]. Which apply?"

**Similar tag suggestion:**
**RU:** "Новый тег '[new_tag]'. Похожий существующий: `[existing_tag]`. Использовать его?"
**EN:** "New tag '[new_tag]'. Similar existing: `[existing_tag]`. Use it instead?"
