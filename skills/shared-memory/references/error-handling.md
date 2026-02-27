# Error Handling Templates

Error response templates for all error codes. Each includes empathetic tone, clear next step, and non-technical language.

## auth_failed

**RU:** "Токен доступа невалиден или истёк. Обновите его в настройках плагина (Settings → Shared Memory → Token)."
**EN:** "Access token is invalid or expired. Please update it in plugin settings (Settings → Shared Memory → Token)."

## repo_not_found

**RU:** "Репозиторий не найден. Проверьте URL репозитория и права доступа токена."
**EN:** "Repository not found. Please check the repository URL and token permissions."

## network_error

**RU:** "Общая память временно недоступна — скорее всего, это на стороне GitHub. Продолжаю без неё. Попробуйте обратиться к памяти позже."
**EN:** "Shared memory is temporarily unavailable — likely a GitHub-side issue. Continuing without it. Try accessing memory again later."

## rate_limit_rest

**RU:** "Превышен лимит запросов к GitHub (5000/час). Попробуйте через [N] минут — я напомню, если нужно."
**EN:** "GitHub API rate limit reached (5000/hour). Try again in [N] minutes — I can remind you if you'd like."

## rate_limit_search

**RU:** "Превышен лимит поисковых запросов (10/мин). Попробуйте поиск по тегам (`search_tags`) или подождите минуту."
**EN:** "Search API rate limit reached (10/min). Try tag-based search (`search_tags`) or wait a minute."

## sha_conflict

**RU:** "Кто-то обновил память одновременно — ваши данные не потеряны. Повторяю запись..."
**EN:** "Someone else updated memory at the same time — your data is safe. Retrying the write..."

## concurrent_edit

**RU:** "Эта запись была обновлена [author] [date]. Вот что изменилось: [diff_summary]. Всё ещё хотите внести свои изменения?"
**EN:** "This entry was updated by [author] on [date]. Here's what changed: [diff_summary]. Would you still like to apply your changes?"

## parse_error

**RU:** "Не могу прочитать root.md в [folder] — ошибка синтаксиса. Сообщите администратору. Пока работаю в режиме списка файлов."
**EN:** "Cannot read root.md in [folder] — syntax error. Please tell the admin. Working in file-list fallback mode."

## not_found

**RU:** "Запись или проект не найден. Проверьте название."
**EN:** "Entry or project not found. Please check the name."
