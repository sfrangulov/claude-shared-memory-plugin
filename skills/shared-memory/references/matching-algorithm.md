# Matching Algorithm

5-step matching algorithm for finding relevant entries in shared memory.

## Step 1: Keyword Extraction

Claude extracts keywords from the user's request based on meaning (not mechanical word splitting). Technical terms, project names, and domain-specific words are prioritized.

## Step 2: Keyword Comparison

For each entry in root.md:
- **Tags:** exact match (case-insensitive). Tag "auth" ≠ "auth-jwt"
- **Description:** substring match (case-insensitive). "react" matches "React component architecture"

## Step 3: Ranking

Results are ranked by:
1. `match_count` DESC (more matching keywords = higher rank)
2. Priority tiebreaker:
   - Active project entries (highest)
   - `_shared` entries
   - Other active project entries
   - Archived project entries (lowest)

## Step 4: Candidate Handling

Based on the number of matches:
- **1 candidate** → auto-load (call `read_entry` immediately)
- **2-5 candidates** → load all (max 5 entries context budget)
- **>5 candidates** → show list with descriptions, ask user to select (max 5 to load)

## Step 5: No Matches

If no entries match:
- Offer deep search (`search_deep`) as a fallback
- RU: "По тегам и описаниям ничего не найдено. Поищем по полному тексту?"
- EN: "No matches found by tags and descriptions. Search full text?"
