# Reader workspace improvements

Date: 2026-11-15

## Agreed behavior

- Reading follows select → understand → grade/save → continue reading.
- Remove **Finish (no stats)** and **Mine / Mine sentence** from the reader UI. Do not replace mining with another required action.
- Saving a learning word (statuses 1–4) captures a valid sentence and its source automatically, including words that already exist in the vocabulary. Preserve the first saved example, avoid duplicates, and never reset an existing card's schedule through an ordinary save.
- Automatic card creation remains enabled by default. Respect existing review preferences and the opt-out; Known and Ignored saves create no new cards.
- Existing unrelated working-tree changes are outside this work.

## Implementation steps

1. **Selection and word panel**
   - Persist an indicator on the exact selected token or phrase, including repeated Known words, phrase expansion, and sentence/audio views.
   - Keep headword, accurately named sentence bookmark, and phrase expansion controls compact and usable at narrow widths.
   - Place AI definition actions beside the definition, then grading/saving, followed by quiet dictionary fallbacks.
   - Remove the duplicate status badge; keep status names and accessible pressed states in the grading area.
   - Keep the textarea compact with real content growth and visible keyboard focus, without autofocus.
   - Use theme status colors for grading and neutral utility surfaces; preserve touch targets and keyboard navigation.

2. **Appearance and lesson controls**
   - Put font size, text width, line spacing, paragraph spacing, indent/alignment, and audio transcript flow/alignment in one accessible **Aa / Appearance** popover.
   - Label choices in words. Retain existing density and reader/sidebar split preferences as explicitly named advanced controls, since the present divider is not draggable.
   - Keep reading mode, Panel, Translate, Summarize, and Auto tools readily available.
   - Place Library/Book navigation by the lesson title, separate completion from reading utilities, and put All Known in a secondary lesson menu.
   - Remove Finish (no stats) from every reader layout; preserve normal book, standalone-text, and audio completion behavior.

3. **Automatic examples and review**
   - Carry sentence/source through existing-word saves, queued offline writes, and replay without losing word identity or edited translations.
   - Store the first valid matching example for a learning word; do not append examples on every grading change.
   - Preserve existing review cards, schedules, suspension rules, and review preferences.
   - Update settings/demo copy and fixtures that refer to manual mining.
   - Add meaningful regression coverage for existing-word examples, duplicate saves, Known/Ignore, opt-out, offline replay, and schedule preservation.

4. **Review and evidence**
   - Independently review the completed implementation and fix actionable issues.
   - Run focused client/server regressions, type checks, lint, and production/demo build checks as applicable.
   - Use synthetic browser fixtures to check desktop and mobile reader, word panel, Appearance controls, and sentence/audio views.
   - Capture and inspect screenshots in light, dark, classic dark, high-contrast light, and high-contrast dark themes. Check text contrast, active selection, focus, wrapping, popover bounds, and root overflow.
   - Record commands, results, screenshot paths, and any limits in a verification report.

## Progress

- [x] Scope and implementation plan recorded.
- [x] Selection and word panel implemented.
- [x] Appearance and lesson controls implemented.
- [x] Automatic examples and review implemented.
- [x] Independent review complete and findings resolved.
- [x] Automated checks and visual verification complete.

Verification results and the five-theme desktop/mobile screenshot index are recorded in
[the verification report](../verification/reader-redesign/README.md).
