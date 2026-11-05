# Guide: Adding and Configuring Languages in LinguaRead

LinguaRead allows adding and customizing languages either directly via the **Web UI** (recommended for users and admins) or by **seeding default languages in code** (for developers creating fresh installations).

---

## Table of Contents
1. [Method A: Adding a Language via the Web UI](#method-a-adding-a-language-via-the-web-ui)
   - [Step 1: Open Language Settings](#step-1-open-language-settings)
   - [Step 2: Basic Configuration](#step-2-basic-configuration)
   - [Step 3: Script & Parsing Rules](#step-3-script--parsing-rules)
   - [Step 4: Translation Target Overrides](#step-4-translation-target-overrides-optional)
   - [Step 5: External Dictionaries](#step-5-external-dictionaries)
   - [Step 6: Sentence-Split Exceptions](#step-6-sentence-split-exceptions)
2. [Method B: Seeding Languages in Code (Developers)](#method-b-seeding-languages-in-code-developers)
3. [Post-Setup Steps](#post-setup-steps)
   - [TTS Voice Selection](#1-text-to-speech-tts-voice-selection)
   - [Default Language Setting](#2-default-reading-language)
   - [Translation Providers](#3-translation-providers)
4. [Language Presets Reference](#language-presets-reference)
5. [Managing Existing Languages (Reset & Delete)](#managing-existing-languages)

---

## Method A: Adding a Language via the Web UI

This is the standard approach. Any changes take effect immediately across the app without restarting Docker or rebuilding containers.

### Step 1: Open Language Settings
1. Launch LinguaRead and log in.
2. In the navigation bar, click on **Settings** (`/settings`).
3. In the left navigation menu, select **Languages**.
4. Browse the **Add a language** catalog. Search by language, native name, or country, then click **Add**. The 44 presets are optional: opening the catalog does not add them or change the installation's starter languages.
5. Added languages appear under **Your languages** and become available when importing or creating texts. Select one to edit its configuration.
6. Choose regional speech voices inside the existing language's voice settings; Portuguese, for example, needs only one language entry for Brazilian and European voices. For a language absent from the catalog, click **Set up a custom language**.

Presets include Unicode word characters, combining marks and joiners, sentence punctuation, and right-to-left layout where applicable. They do not override your translation target or add dictionaries. Existing regional codes such as `pt-BR` count as already added for their base language.

Chinese, Japanese, and Thai default to **profiled word segmentation** (with per-import opt-out) for new texts, book imports (`.txt`, `.epub`, or manual), and audio/SRT imports:
- **Chinese (`jieba-v1`):** uses a pinned 8.6 MB dictionary downloaded once and cached for offline reopening (requires HTTPS or localhost).
- **Japanese (`tinysegmenter-ja-v1`):** uses the built-in TinySegmenter profile and strips `<rt>`/`<rp>` furigana annotations from EPUB imports.
- **Thai (`thai-dict-v1`):** uses a pinned ~62,108-word PyThaiNLP (CC0) dictionary constrained by Thai Character Cluster (TCC) boundaries.
Existing unprofiled content keeps its legacy splitting; re-splitting a book preserves its profile.

Korean keeps space-separated eojeol touch targets while decomposing common Josa/copula suffixes and verb/adjective stems (including `ㄹ` restoration) against the built-in 43,445-headword KRDICT lemma list. Exact saved vocabulary takes precedence, and validated alternatives appear as selectable chips.

---

### Step 2: Basic Configuration

| Field | Description | Example |
| :--- | :--- | :--- |
| **Language Name** | Friendly display name shown in dropdowns and statistics. | `Polish`, `Japanese`, `Arabic` |
| **Language Code** | Standard ISO 639-1 / BCP-47 language tag. **Critical:** Drives browser Text-to-Speech voice matching, translation requests, and locale-aware lowercasing. | `pl`, `ja`, `ar`, `es`, `fr-CA` |
| **Active for Translation** | Toggle **ON** so this language appears in reading menus, lesson generation, and translation dialogs. | `true` |

---

### Step 3: Script & Parsing Rules

LinguaRead's tokenizers use these settings for word and sentence splitting. See [the language roadmap](docs/LANGUAGE_SUPPORT_PLAN.md) for tested scope and remaining reference gaps.

1. **Parser Type**:
   - `Space Delimited` (`spacedel`): **Recommended for most languages** (Latin, Cyrillic, Greek, Arabic, Hebrew, etc.) where words are separated by spaces or punctuation.
   - `MeCab` / `Jieba`: Legacy language settings; they do not upgrade existing text boundaries. New imports use the versioned `jieba-v1`, `tinysegmenter-ja-v1`, and `thai-dict-v1` profiles above.

2. **Word Characters (Regex)**:
   - A regular expression character class defining what constitutes a single word character.
   - **Default:** `\p{L}\p{M}` (Matches any Unicode letter plus combining diacritics/accents).
   - **Latin script:** `a-zA-ZÀ-ÖØ-öø-ɏḀ-ỿ\p{M}`
   - **German:** `a-zA-ZÀ-ÖØ-öø-ɏḀ-ỿ\p{M}\u200C\u200D` (includes zero-width non-joiner/joiner).
   > **Note on Glued Words & Numbers:** LinguaRead's tokenizer glues internal apostrophes (`'`), hyphens (`-`), and middle dots (`·`) between word characters (e.g., *l'eau*, *don't*, *c'est-à-dire*, *interrompo-a*, *col·lecció*), keeps Italian trailing *po'* as a single span, unifies Dutch proclitic noun phrases (*'s Morgens*), English coordinate contraction idioms (*rock 'n' roll*), and multiword compounds in Vietnamese (*Việt Nam*, *Quốc ngữ*, *đặc biệt*) and Malay (*Kuala Lumpur*), and snaps partial reader selections or phrase extensions across those compounds to their full boundaries (`snapPhraseCompoundBounds`). It groups contiguous decimals (`12,5`, `3.14`), thousands-separated numbers (including NBSP/NNBSP and Persian digits `۴۵٬۰۰۰`), adjacent currency symbols (`€`, `$`, `₽`), Dutch `,-`, and numeric/percent suffixes (`2026-ban`, `10%-os`) while preserving sentence-ending periods.
   > Afrikaans (`af`) keeps leading `'n`; Dutch (`nl`) keeps `'s`/`'t`, including capitals, unless closed by a quote. Finnish (`fi`) keeps lowercase colon suffixes (`EU:ssa`). Dotted initialisms (`U.S.A.`), English `Dr.`, and Ukrainian `грн.` retain periods; single initials (`M.`) and ordinary sentence periods stay separate. ASCII-space grouping covers three-digit groups with currency/unit context (`2 000 грн.`, `1 250,00 грн.`), and bare integers (`2026`) are clickable without creating untracked `Status = 0` vocabulary clutter.
   > Verified 2026-11-05: tokenizer v5; server 1,767 passed / 9 PostgreSQL-only skipped; client 1,815 passed across 114 files. Build, typecheck, and lint pass (35 existing warnings). The shared corpus has 100 runtime cases, 11 remaining reference span/key gaps (78 / 89 = 87.6% exact reference matches), and 86 semantic lemma markers.

   > **Romance & Romanian clitic/elision lookup (French, Italian, Catalan, Romanian):** Exact whole terms take precedence. When a glued elision has no exact match, lookup falls back to the stripped headword only if saved vocabulary or Wiktionary validates it: French (`l'`, `d'`, `c'`, `qu'`, `-là`, `-ci`), Italian (`l'`, `d'`, `un'`, `quell'`, `nell'`, `qualcos'`, `all'`, `dall'`, `sull'`, `coll'`, `bell'`, `sant'`, `quest'`, trailing `po'` → `po`), Catalan (`l'`, `d'`, `m'`, `t'`, `s'`, `n'`, and chained enclitics `-nos`, `-vos`, `'m`, `-ho`, etc.), and Romanian hyphenated clitics (`și-au` → `au` / `și`). Clickable spans stay whole.

3. **Sentence Splitting Characters**:
   - Characters marking end-of-sentence boundaries.
   - European scripts: `.!?` (commas ordinarily do not end sentences)
   - CJK scripts: `.!?。！？`
   - Arabic / Persian: `.!?؟`

4. **Character Substitutions**:
   - Pipe-separated list of replacements: `old=new|old2=new2`.
   - Used to normalize punctuation before tokenization.
   - *(Built-in rules already convert curly single quotes `’`, `‘`, `ʼ` → `'` and Unicode hyphens → `-`).*
   - Example: `´='|`='|’='|‘='|...=…|..=‥`

5. **Romanization**:
   - Currently unavailable. The ineffective switch is hidden; an existing stored preference is preserved when editing a language.

6. **Right-to-Left Script (RTL)**:
   - Enable for languages written right-to-left (Arabic, Hebrew, Persian, Urdu). Adjusts text alignment and layout direction in the reader.

---

### Step 4: Translation Target Overrides (Optional)

If your primary native/learning target language differs from the global default when reading this language:
- **DeepL Target Code**: Override target ISO code (e.g., `EN-US`, `DE`, `JA`).
- **Gemini Target Code**: Override target ISO code for AI generation/translations.

---

### Step 5: External Dictionaries

When reading, clicking a term opens external dictionary lookups in a popup or embedded panel.
Click **+ Add Dictionary** to add one or more providers:

- **Purpose**: `Terms` (single words/phrases) or `Sentences`.
- **Display**: `Popup` (opens in a new window/tab) or `Embedded` (loads in reader iframe).
- **URL Template**: The dictionary URL containing the placeholder `###` where the search term is injected.
  - *WordReference:* `https://www.wordreference.com/enru/###`
  - *Wiktionary:* `https://{lang}.wiktionary.org/wiki/###`
  - *Cambridge:* `https://dictionary.cambridge.org/dictionary/english-spanish/###`
  - *Jisho (Japanese):* `https://jisho.org/search/###`
  - *Diki (Polish):* `https://www.diki.pl/slownik-angielsko-polski?q=###`
- **Order & Active**: Lower numbers display first. Check **Active** to enable.

---

### Step 6: Sentence-Split Exceptions

Prevents unwanted sentence breaks on common abbreviations ending in a period.
Click **+ Add Exception** and add strings (case-sensitive):
- English/Spanish: `Dr.`, `Mr.`, `Mrs.`, `Ms.`, `Prof.`, `Sr.`, `Sra.`, `vs.`, `etc.`
- German: `z.B.`, `bzw.`, `Dr.`, `Prof.`, `usw.`
- Polish: `np.`, `itp.`, `itd.`, `prof.`, `dr`

Finally, click **Create Language** (or **Update Language** if editing).

---

## Method B: Seeding Languages in Code (Developers)

If you are developing LinguaRead or want default languages to be pre-populated on brand-new database installations:

1. Open `server/LinguaReadApi/Data/DbInitializer.cs`.
2. Locate `DbInitializer.Initialize` and add a new entry to the `languages` list:

```csharp
new Language {
    Name = "Polish",
    Code = "pl",
    ShowRomanization = false,
    RightToLeft = false,
    ParserType = "spacedel",
    SplitSentences = ".!?",
    WordCharacters = Language.DefaultWordCharacters, // @"\p{L}\p{M}"
    IsActiveForTranslation = true,
    CharacterSubstitutions = "´='|`='|’='|‘='|...=…|..=‥",
    Dictionaries = new List<LanguageDictionary> {
        new LanguageDictionary {
            Purpose = "terms",
            DisplayType = "popup",
            UrlTemplate = "https://pl.wiktionary.org/wiki/###",
            IsActive = true,
            SortOrder = 0
        }
    },
    SentenceSplitExceptions = new List<LanguageSentenceSplitException> {
        new LanguageSentenceSplitException { ExceptionString = "np." },
        new LanguageSentenceSplitException { ExceptionString = "itp." }
    }
}
```

3. **Add Golden Tokenizer Test Vectors** (Recommended):
   - Open `tokenizer-golden-vectors.json` or `tests/golden/multilingual_tokenizer_and_lemmatizer_test_suite_v4.json`.
   - Add your language definition and test assertions under `cases` to ensure both C# `Tokenizer.cs` and TypeScript `readerText.ts` tokenize identically.

---

## Post-Setup Steps

Once a language has been added:

### 1. Text-to-Speech (TTS) Voice Selection
1. Go to **Settings** → **Reading**.
2. Enable browser text-to-speech and scroll to **Voices on this device**.
3. Find your language's row and choose an installed voice (including regional varieties).
4. Preview it with the play button. Choices are saved per device; cloud voices require an internet connection.

### 2. Default Reading Language
In **Settings** → **Reading**, set **Default Language** so imported texts and audio lessons default to it.

### 3. Translation Providers
Ensure your translation API keys (DeepL, Google Cloud Translate, Azure Translator, or Wiktionary) are configured in **Settings** → **Integrations** or **AI Providers** if you intend to use automated translations.

### 4. Reading and listening repeats

The reader shows **Read ×** and **Listened ×** for newly recorded complete passes. Open the counter beside the lesson title (or inside the **Lesson** header on mobile) to record another pass; **Listened** appears only when lesson audio or an audiobook is attached. Completing a lesson records a read; **Record a read** and **Record a listen** log deliberate passes without leaving the reader. Partial playback earns listening minutes based on active playback time.

---

## Language Presets Reference

The optional catalog is defined in `client/lingua-read-client/src/utils/languagePresets.ts`. All catalog presets use `\p{L}\p{M}\u200C\u200D` for letters, combining marks, and joiners. Existing configurations and database seed defaults retain their own settings.

| Languages | Direction | Sentence boundaries | Parser setting |
| :--- | :--- | :--- | :--- |
| Most catalog languages | Left to right | `.!?` | `spacedel` |
| Arabic, Persian | Right to left | `.!?؟` | `spacedel` |
| Hebrew | Right to left | `.!?` | `spacedel` |
| Urdu | Right to left | `.!?؟۔` | `spacedel` |
| Hindi | Left to right | `.!?।॥` | `spacedel` |
| Bengali, Tamil | Left to right | `.!?।` | `spacedel` |
| Greek | Left to right | `.!?;` plus the Greek question mark | `spacedel` |
| Korean | Left to right | `.!?。！？` | `spacedel` |
| Chinese | Left to right | `.!?。！？` | `jieba` (legacy; new imports default to `jieba-v1` with opt-out) |
| Japanese | Left to right | `.!?。！？` | `mecab` (legacy; new imports default to `tinysegmenter-ja-v1` with opt-out) |
| Thai | Left to right | `.!?` | `spacedel` (legacy; new imports default to `thai-dict-v1` with opt-out) |

---

## Managing Existing Languages

On the **Settings** → **Languages** page:

- **Reset Content**: Deletes all texts, books, vocabulary words, and statistics belonging to your user account for that language, while **preserving** the language configuration, dictionaries, and rules.
- **Delete Language**: Completely removes the language definition once dependent books, texts, and terms are cleared.
