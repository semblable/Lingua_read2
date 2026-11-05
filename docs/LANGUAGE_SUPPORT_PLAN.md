# Language implementation roadmap

Goal: practical support for all 44 catalog languages while preserving learner IDs and history. Read [CONTRIBUTING](../CONTRIBUTING.md), inspect local changes, then use [focused verification](../verification/language-support/README.md). Native quality, mobile cost, and physical offline/reconnect behavior remain unverified.

## Verified checkpoint — 2026-11-05

Tokenizer v5 slice (Greek monotonic accents & contextual final sigma, Arabic hamza preservation, dual-key folded lookup with in-place canonical DB promotion, space-grouped integers, and bare numbers with pure-numeric status-0 filtering):
- **Server (`dotnet test -c Release`):** 1,733 passed, 0 failed, 7 PostgreSQL-only skipped locally (1,740 total).
- **Client (`npm test -- --run`):** 1,766 passed across 114 files; `tsc --noEmit`, production build, and `eslint` (46 existing warnings) passed.
- **Shared golden corpus:** 89 source cases across 44 languages retained intact; 100 runtime cases, 35 normalization cases, and 51 lookup cases execute with 100% C#/TypeScript parity. Remaining reference gaps: **18** span/key cases (down from 24 after closing `ar-01`, `ar-02`, `he-01`, `el-01`, `el-02`, and `uk-02`) and **86** semantic lemma cases.

## Implemented scope

- **Chinese/Japanese/Thai:** opt-out defaults for new text, book, and audio/SRT imports using `jieba-v1`, `tinysegmenter-ja-v1`, and `thai-dict-v1`. Existing unprofiled items stay legacy. Japanese strips EPUB `<rt>`/`<rp>` ruby and handles supplementary Han; Thai uses TCC-bounded dictionary DP with OOV coalescing.
- **Korean:** full eojeol touch targets, Josa/copula decomposition, verb/adjective candidates, and `ㄹ` restoration against the pinned 43,445-headword KRDICT dataset ([notices](../THIRD_PARTY_NOTICES.md)). Validated alternatives appear as selectable chips; tracked vocabulary takes precedence.
- **Normalization & dual-key lookup:** Indic marks and medial joiners are preserved. Language-scoped Turkish/Azerbaijani `İ`/`I` folds, Greek monotonic accents and contextual final sigma (`ς`/`σ`), Arabic/Persian `Yeh`/`Kaf` unification with preserved hamza (`أ`, `إ`, `آ`, `ٱ`) and `Ta Marbuta`, and Hebrew positional quote rules share canonical normalization across tokens and stored headwords. Secondary folded keys (`FoldLookupKey` / `foldLookupTerm`) match legacy v4 unaccented/hamza-stripped headwords and promote them in-place on relink. Validated exact-first lookup fallbacks cover Hebrew trailing Geresh, Hebrew/Arabic proclitics, French (`l'`, `d'`), Catalan (`l'`, `d'`), and Italian (`l'`, `d'`, `un'`, `quell'`, and trailing `po'`), and `splitSentenceAroundTerm` / `pickSentenceForTerm` match normalized, folded, and proclitic/elision tokens in vocalized or stressed sentences while preserving raw UTF-16 display slices.
- **Spans & numeric/currency grouping:** Clickable Romance elision spans stay whole, and Italian trailing `po'` stays a single span (`po'`). Bare integers (`2026`), space-grouped integers and decimals with currency/unit context (`2 000 грн.`, `1 250,00 грн.`), contiguous decimals (`.`, `,`, `٫`), grouped numbers (`NBSP`, `NNBSP`, standard `.`/`,`/`٬` separators), Persian digits (`fa-02`), adjacent currency symbols (`€`, `$`, `₽`), Dutch `,-`, and Hungarian numeric/percent suffixes (`2026-ban`, `10%-os`) tokenize as words while pure numeric tokens skip automatic `Status = 0` DB creation and render unhighlighted (`status = 6`) unless explicitly saved.
- **Bounded spans:** Afrikaans `'n` and Dutch `'s`/`'t` retain leading apostrophes case-insensitively unless closed by a quote. Finnish lowercase colon suffixes (`EU:ssa`), dotted single-letter initialisms (`U.S.A.`), English `Dr.`, and Ukrainian `грн.` stay whole. Single initials, ordinal indicators (`1º`, `2ª`), and sentence periods remain separators.
- **Tokenizer v5:** startup relinking is versioned (`CurrentTokenizerVersion = 5`) and idempotent, verified by disposable relational snapshot tests (`TokenizerV4MigrationAcceptanceTests` and `TokenizerV5MigrationAcceptanceTests`).

## Next priorities

1. **Remaining [18 span/key gaps](../verification/language-support/reference-gap-audit.md):**
   - Multiword lexical phrases (5 cases: `vi-01`, `vi-02`, `nl-01`, `ms-02`, `en-02`).
   - Intentional design differences (glued Romance/Romanian clitics, Korean full eojeols, English ASCII apostrophe normalization, pinned CJK segmentation).
2. **Language quality & device verification:** native review for CJK/Thai/Korean ambiguity and RTL fallback false positives; physical phone testing for touch targets, chips, mining, and offline/reconnect flows.

## Preservation contracts

Keep C# (`Tokenizer.cs`, `WordLinker.cs`) and TypeScript (`readerText.ts`) UTF-16 offsets and ordinal tie-breaks identical. Preserve vocabulary IDs, meanings/statuses, phrases, mined sentences, SRS, bookmarks, study history, and tokenizer version **5**. Keep [user guidance](../LANGUAGES_GUIDE.md) aligned with verified behavior and leave test timing JSON files untracked.
