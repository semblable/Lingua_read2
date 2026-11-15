# Reader word forms: enabling and extending separate-form saving

**Save exact form** lets a learner track the spelling in the passage separately
from the base word selected by the reader. For example, Korean `책을` can resolve
to `책`; the override saves `책을` with its own vocabulary status and, when
automatic card creation allows it, its own flashcard.

## How it is enabled

This is an automatic code capability, with no account setting, environment
variable, database flag, or language-editor checkbox. The language's code selects
the supported analysis. Changing this capability requires a client rebuild and
deployment.

The action appears only when all these conditions hold:

1. The language is Korean. `isKoreanLanguageCode` accepts `ko`, regional tags such
   as `ko-KR`, and equivalent case/underscore spellings such as `KO_kr`.
2. Both the clicked surface spelling and the displayed vocabulary term exist.
3. Their lookup keys differ after the reader's spelling normalization and Korean
   Jamo composition. Equivalent encodings of the same word do not qualify.
4. The clicked word's `lemmaCandidates` contains the displayed term, compared
   using the same keys.
5. The caller supplies the save action. While a word save is processing, or no
   word is selected, the control is disabled.

The panel resolves the language from `languageConfig.code`, then
`languageConfig.languageCode`, then the text's language code supplied through
`definition.sourceLanguageCode`. A missing or unsupported code leaves the action
hidden. All other languages, including Portuguese and French/Italian/Catalan
apostrophe matches, currently keep it hidden.

Normal status buttons save the vocabulary term already selected by the reader.
**Save exact form** passes the original surface spelling as an explicit override.
It uses the displayed word's status (or New for an untracked word) and current
translation. It does not rename or merge the base entry. Existing exact entries
retain their own identity; once the surface itself is selected, the extra action
is hidden because there is no distinct base/surface pair.

## Where the behavior lives

| Responsibility | Code |
| --- | --- |
| Visibility rule | [`WordInfoPanel.tsx`](../client/lingua-read-client/src/components/reader/WordInfoPanel.tsx): `canSaveExactForm`, `formKey` |
| Selection and saving | [`TextDisplay.tsx`](../client/lingua-read-client/src/pages/TextDisplay.tsx): `getWordData`, `handleWordClick`, `handleSaveExactForm`, `handleSaveWord` |
| Korean language detection, candidate analysis, and equivalent-encoding lookup | [`koreanLookup.ts`](../client/lingua-read-client/src/utils/koreanLookup.ts): `isKoreanLanguageCode`, `analyzeKoreanCandidates`, `composeKoreanLookupText` |
| Candidate metadata carried by the panel | [`displayedWord.ts`](../client/lingua-read-client/src/types/displayedWord.ts): `DisplayedWord.lemmaCandidates` (currently `KoreanLemmaCandidate[]`) |
| Server matching | [`KoreanLookup.cs`](../server/LinguaReadApi/Services/Tokenization/KoreanLookup.cs), [`WordLinker.cs`](../server/LinguaReadApi/Services/Tokenization/WordLinker.cs) |

Korean candidates come from particle/copula and verb/adjective rules, with the
bundled KRDICT list helping rank or filter alternatives. When no candidate is in
the dictionary, the analyzer can retain unvalidated hypotheses. The button checks
that a candidate matches the displayed term; it does **not** require
`dictionaryValidated`, and its presence is not a guarantee that the analysis is
correct. Ambiguous forms remain a reason to retain this manual override.

## Changing the policy or adding a language

For a visibility-only adjustment, edit `canSaveExactForm` in `WordInfoPanel.tsx`
and its panel tests. Keep equivalent-spelling suppression and the requirement for
an actual match to the displayed base form.

Adding another language takes more than adding its code to a condition:

1. Implement that language's base-form analysis and vocabulary resolution. Wire
   it into selection in `TextDisplay.tsx`, and keep backend word linking in
   agreement so reloading a text preserves the same vocabulary identity.
2. Generalize the Korean-specific candidate type and supply the analyzed
   candidates on `DisplayedWord`. Preserve exact saved words before falling
   back to a base form, and retain a way to select ambiguous alternatives.
3. Extend the visibility rule with an explicit capability for the new language
   and use that language's key normalization. Keep Korean Jamo composition
   specific to Korean. Do not broaden `isKoreanLanguageCode`: it also selects
   Korean parsing and lookup behavior elsewhere.
4. Add regression cases for a useful inflection, an ambiguous form, an already
   saved surface form, equivalent spellings, and unsupported/missing language
   codes. Check that saving the base edits its existing row and saving the
   surface creates or updates the intended separate row, including after reload.

Tokenization, translation, capitalization folding, and apostrophe fallback alone
do not establish general inflection support. Enabling Portuguese, for example,
would first require a reliable way to relate its conjugated forms to the intended
base word. The [language roadmap](LANGUAGE_SUPPORT_PLAN.md) tracks that wider work.

## Verification

For visibility changes, run from `client/lingua-read-client`:

```powershell
npm test -- --run src/__tests__/WordInfoPanel.test.js src/__tests__/koreanReader.test.jsx
npm run typecheck
```

If analysis or lookup changes, also run the relevant candidate/lookup suites and
the frontend/backend shared cases described in
[language-support verification](../verification/language-support/README.md).
The panel suite covers supported codes, unsupported languages, missing analyses,
and equivalent encodings. The reader suite verifies the real selection/save
path and preservation of vocabulary identity.

## Optional flashcards

Separate-form saving follows the same automatic-card preference as other word
saves. **Settings → Reading → Create flashcards when saving words** edits
`srsAutoCreateCards`, also available in review settings. Off disables new
automatic cards and hides the reader's Reading credit action; existing cards
remain available. Review-to-word-status synchronization is a separate preference
in review settings. See [the settings reference](../SETTINGS.md#6-spaced-repetition-system-srs--anki-settings).
