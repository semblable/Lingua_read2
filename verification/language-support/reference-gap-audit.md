# Reference gap audit — 2026-11-05

All 89 original reference cases across 44 languages remain intact in `tests/golden/multilingual_tokenizer_and_lemmatizer_test_suite_v4.json`. Runtime surfaces address the **displayed processed sentence** using **UTF-16 code units**.

This Tokenizer v5 slice expands Romance and Romanian clitic and elision lookup fallbacks across French, Italian, Catalan, and Romanian (`fr`, `it`, `ca`, `ro`), while keeping clickable display spans whole to protect learner bookmarks, saved phrases, and sentence mining. Romanian is now fully registered in `RequiresLookupFallback`. Validated lookup candidates now cover French demonstrative suffixes (`œuf-là` → `œuf`) and contractions (`qu'il` → `il`, `C'est` → `est`), Italian articulated prepositions and determiners (`nell'ombra` → `ombra`, `qualcos'altro` → `altro`), Catalan proclitics and chained enclitics (`Dona'm-ho` → `dona`, `anem-nos-en` → `anem`, `d'anar-te'n` → `anar-te'n`), and Romanian hyphenated clitics (`și-au` → `au` / `și`). All 89 original references remain unchanged; 100 runtime cases execute. Semantic markers remain **86**.

Verification: server **1,742 passed, 7 PostgreSQL-only skipped**; client **1,775 passed across 114 files**. Solution build, typecheck, production build, and lint pass (46 existing lint warnings). Docker is unavailable locally. Tokenizer is at version **5** (`WordLinker.CurrentTokenizerVersion = 5`), verified by `TokenizerV5MigrationAcceptanceTests`.

## Remaining 18 span/key gaps

| Cases | Classification and reason |
| --- | --- |
| `zh-01` | Contextual boundary disambiguation: source `乒乓球拍 / 卖`, pinned dictionary `乒乓球 / 拍卖`. |
| `ja-01` | Segmentation granularity for repeated `すもも`/`もも`. |
| `ja-02` | Mixed: pinned TinySegmenter boundaries versus larger inflected/grammatical units. |
| `fr-01`, `fr-02` | Intentional glued Romance elision/clitic spans (`C'est`, `l'eau`, `d'Anne`, `qu'il`, `œuf-là`); `l'`/`d'`/`c'`/`qu'`/`-là`/`-ci` use validated lookup fallback. |
| `it-01`, `it-02` | Intentional glued elision spans (`C'è`, `d'acqua`, `nell'ombra`, `qualcos'altro`, `un'occhiata`, `quell'albero`); `po'` span `[7:10]` matches reference and `l'`/`d'`/`un'`/`quell'`/`nell'`/`qualcos'`/`all'`/`dall'`/`sull'`/`coll'`/`bell'`/`sant'`/`quest'`/`po'` use validated lookup fallback. |
| `ca-01`, `ca-02` | Intentional glued elision/clitic spans (`L'home`, `d'aigua`, `d'objectes`, `d'un`, `Dona'm-ho`, `d'anar-te'n`, `l'església`); `l'`/`d'`/`m'`/`t'`/`s'`/`n'` and chained enclitics (`-ho`, `-en`, `-nos`, `'m`, `'t`, etc.) use validated lookup fallback. |
| `vi-01`, `vi-02` | Multiword lexical phrase grouping (`Việt Nam`, `Quốc ngữ`, `đặc biệt`). |
| `ro-01` | Generic hyphen glue (`și-au`) versus clitic subtokens (`și / -au`); `și-` and `-au` use validated lookup fallback. |
| `ko-01`, `ko-02` | Intentional full eojeol touch targets; Josa/stem decomposition is handled in lookup candidates. |
| `nl-01` | Lexical phrase grouping of `'s Morgens`; the leading apostrophe matches. |
| `ms-02` | Multiword phrase `Kuala Lumpur` (`RM` and `50.00` match). |
| `en-01` | Intentional ASCII apostrophe surface normalization; `Dr.` matches. |
| `en-02` | Multiword `rock 'n' roll`; `U.S.A.` matches and quoted `'n'` retains separate quote tokens. |

## The 86 semantic markers

Only `zh-01`, `af-02`, and `vi-02` have no semantic lemma difference. The 86 semantic markers represent broader dictionary lemmatization, morphology, or subtoken expansion outside the tokenizer span/key contract:

| Cases/language groups | Count | Remaining expectations |
| --- | ---: | --- |
| Thai, `zh-02`, Japanese | 5 | Abbreviation/digit expansion, contextual readings, kanji, and inflected headwords. |
| Hindi, Bengali, Tamil | 6 | Morphology and conjunct/joiner variants. |
| Arabic, Persian, Hebrew, Urdu | 8 | Inflection, clitics, vocalized headwords, and lexical/abbreviation variants. |
| French, Italian, Catalan, Romanian, Spanish, Portuguese | 13 | Inflection and clitic/contraction expansion (e.g. `Dámelo → dar/me/lo`). |
| `af-01`, German, Swedish, Danish, Norwegian, Dutch, English | 13 | Inflection, casing, and contextual contractions. |
| Greek | 2 | Inflection and accented/final-sigma headword presentation. |
| `vi-01` | 1 | Proper-name headword casing. |
| Slavic languages (9) | 18 | Inflection, proper names, abbreviations, and derivation. |
| Turkish, Hungarian, Finnish, Estonian | 8 | Agglutination, stem changes, and numeric suffix decomposition. |
| Lithuanian, Latvian | 4 | Inflection and proper names. |
| Indonesian, Malay, Swahili | 6 | Affixes, reduplication, noun classes, and capitalization. |
| Korean | 2 | Plurals, honorific/tense endings, and adjective headwords beyond current KRDICT stem candidates. |
