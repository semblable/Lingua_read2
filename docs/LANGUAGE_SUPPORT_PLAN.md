# Language implementation roadmap

Goal: practical support for all 44 catalog languages while preserving learner IDs and history. Read [CONTRIBUTING](../CONTRIBUTING.md), inspect local changes, then use [focused verification](../verification/language-support/README.md). Native quality, mobile cost, and physical offline/reconnect behavior remain unverified.

## Verified checkpoint — 2026-11-05

Leading apostrophes, Finnish suffixes, dotted initialisms/abbreviations, and space-grouped decimals on tokenizer v4:
- **Server (`dotnet test -c Release`):** 1,732 passed, 0 failed, 7 PostgreSQL-only skipped locally (1,739 total).
- **Client (`npm test -- --run`):** 1,746 passed across 114 files; `tsc --noEmit`, production build, and `eslint` (46 existing warnings) passed.
- **Shared golden v4 corpus:** 89 source cases across 44 languages retained intact; 100 runtime cases, 35 normalization cases, and 51 lookup cases execute with 100% C#/TypeScript parity. Remaining reference gaps: **24** span/key cases (down from 27) and **86** semantic lemma cases.

## Implemented scope

- **Chinese/Japanese/Thai:** opt-out defaults for new text, book, and audio/SRT imports using `jieba-v1`, `tinysegmenter-ja-v1`, and `thai-dict-v1`. Existing unprofiled items stay legacy. Japanese strips EPUB `<rt>`/`<rp>` ruby and handles supplementary Han; Thai uses TCC-bounded dictionary DP with OOV coalescing.
- **Korean:** full eojeol touch targets, Josa/copula decomposition, verb/adjective candidates, and `ㄹ` restoration against the pinned 43,445-headword KRDICT dataset ([notices](../THIRD_PARTY_NOTICES.md)). Validated alternatives appear as selectable chips; tracked vocabulary takes precedence.
- **Normalization & validated lookup:** Indic marks and medial joiners are preserved. Language-scoped Turkish/Azerbaijani `İ`/`I` folds, Greek accent/final-sigma folds, Arabic/Persian `Yeh`/`Kaf`/`Alef` unification (preserving `Ta Marbuta`), and Hebrew positional quote rules share normalization across tokens and stored headwords. Validated exact-first lookup fallbacks cover Hebrew trailing Geresh, Hebrew/Arabic proclitics, French (`l'`, `d'`), Catalan (`l'`, `d'`), and Italian (`l'`, `d'`, `un'`, `quell'`, and trailing `po'`).
- **Spans & numeric/currency grouping:** Clickable Romance elision spans stay whole, and Italian trailing `po'` stays a single span (`po'`). Contiguous decimals (`.`, `,`, `٫`), grouped numbers (`NBSP`, `NNBSP`, standard `.`/`,`/`٬` separators), Persian digits (`fa-02`), adjacent currency symbols (`€`, `$`, `₽`), Dutch `,-`, and Hungarian numeric/percent suffixes (`2026-ban`, `10%-os`) tokenize as words while preserving sentence-ending periods and leaving bare integers governed by `WordCharacters`.
- **Bounded spans:** Afrikaans `'n` and Dutch `'s`/`'t` retain leading apostrophes case-insensitively unless closed by a quote. Finnish lowercase colon suffixes (`EU:ssa`), dotted single-letter initialisms (`U.S.A.`), English `Dr.`, and Ukrainian `грн.` stay whole. ASCII-space three-digit groups require a comma decimal and adjacent currency/unit context (`1 250,00 грн.`). Single initials and sentence periods remain separators.
- **Tokenizer v4:** startup relinking is versioned (`CurrentTokenizerVersion = 4`) and idempotent, verified by disposable relational snapshot tests.

## Next priorities

1. **Remaining [24 span/key gaps](../verification/language-support/reference-gap-audit.md):**
   - Multiword lexical phrases (5 cases: `vi-01`, `vi-02`, `nl-01`, `ms-02`, `en-02`).
   - ASCII-space grouped integers (`uk-02` `2 000`; decimal grouping is supported) and bare years (`ar-02`, `he-01` when `\p{N}` is excluded from default `WordCharacters`).
   - Intentional design differences (glued Romance/Romanian clitics, Korean full eojeols, Arabic Alef folding, Greek accent/sigma folding, pinned CJK segmentation).
2. **Language quality & device verification:** native review for CJK/Thai/Korean ambiguity and RTL fallback false positives; physical phone testing for touch targets, chips, mining, and offline/reconnect flows.

## Preservation contracts

Keep C# (`Tokenizer.cs`, `WordLinker.cs`) and TypeScript (`readerText.ts`) UTF-16 offsets and ordinal tie-breaks identical. Preserve vocabulary IDs, meanings/statuses, phrases, mined sentences, SRS, bookmarks, study history, and tokenizer version **4**. Keep [user guidance](../LANGUAGES_GUIDE.md) aligned with verified behavior and leave test timing JSON files untracked.
