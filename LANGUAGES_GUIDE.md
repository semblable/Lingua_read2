# Guide: Adding and Configuring Languages in LinguaRead

LinguaRead allows adding and customizing languages either directly via the **Web UI** (recommended for users and admins) or by **seeding default languages in code** (for developers creating fresh installations).

---

## Table of Contents
1. [Method A: Adding a Language via the Web UI](#method-a-adding-a-language-via-the-web-ui)
   - [Step 1: Open Language Settings](#step-1-open-language-settings)
   - [Step 2: Basic Configuration](#step-2-basic-configuration)
   - [Step 3: Script & Parsing Rules](#step-3-script--parsing-rules)
   - [Step 4: Translation Target Overrides](#step-4-translation-target-overrides)
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
4. Click the blue **Add New Language** button below the language list.

---

### Step 2: Basic Configuration

| Field | Description | Example |
| :--- | :--- | :--- |
| **Language Name** | Friendly display name shown in dropdowns and statistics. | `Polish`, `Japanese`, `Arabic` |
| **Language Code** | Standard ISO 639-1 / BCP-47 language tag. **Critical:** Drives browser Text-to-Speech voice matching, translation requests, and locale-aware lowercasing. | `pl`, `ja`, `ar`, `es`, `fr-CA` |
| **Active for Translation** | Toggle **ON** so this language appears in reading menus, lesson generation, and translation dialogs. | `true` |

---

### Step 3: Script & Parsing Rules

LinguaRead's tokenizers (frontend and backend) rely on these settings to split words and sentences accurately:

1. **Parser Type**:
   - `Space Delimited` (`spacedel`): **Recommended for most languages** (Latin, Cyrillic, Greek, Arabic, Hebrew, etc.) where words are separated by spaces or punctuation.
   - `MeCab` / `Jieba`: Selectable for Japanese / Chinese. *(Note: Dictionary-based tokenization engines are currently awaiting implementation; unspaced text currently splits on whitespace and punctuation).*

2. **Word Characters (Regex)**:
   - A regular expression character class defining what constitutes a single word character.
   - **Default:** `\p{L}\p{M}` (Matches any Unicode letter plus combining diacritics/accents). This works automatically for Polish, Czech, Greek, Russian, Arabic, etc.
   - **Latin script:** `a-zA-ZÀ-ÖØ-öø-ɏḀ-ỿ\p{M}`
   - **German:** `a-zA-ZÀ-ÖØ-öø-ɏḀ-ỿ\p{M}\u200C\u200D` (includes zero-width non-joiner/joiner).
   > **Note on Glued Words:** LinguaRead's tokenizer automatically glues internal apostrophes (`'`), hyphens (`-`), and middle dots (`·`) when sandwiched between word characters (e.g., *l'eau*, *don't*, *c'est-à-dire*, *interrompo-a*, *col·lecció*). You do not need to add hyphens or apostrophes to the regex class.

3. **Sentence Splitting Characters**:
   - Characters marking end-of-sentence boundaries.
   - European scripts: `.!?,` or `.!?`
   - CJK scripts: `。！？`
   - Arabic / Persian: `؟!`

4. **Character Substitutions**:
   - Pipe-separated list of replacements: `old=new|old2=new2`.
   - Used to normalize punctuation before tokenization.
   - *(Built-in rules already convert curly single quotes `’`, `‘`, `ʼ` → `'` and Unicode hyphens → `-`).*
   - Example: `´='|`='|’='|‘='|...=…|..=‥`

5. **Show Romanization**:
   - Enable for non-Latin writing systems if you want phonetic transcription / romanized hints displayed.

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
   - Open `tokenizer-golden-vectors.json` at the root.
   - Add your language definition and test assertions under `cases` to ensure both the C# `Tokenizer.cs` and TypeScript `readerText.ts` tokenize identically.

---

## Post-Setup Steps

Once a language has been added:

### 1. Text-to-Speech (TTS) Voice Selection
1. Go to **Settings** → **Reading**.
2. Scroll to **TTS Voice Settings**.
3. Select your newly added language from the language dropdown.
4. Choose an installed browser voice (e.g., Microsoft Natural or Google voices matching your language's BCP-47 code).

### 2. Default Reading Language
If you primarily study this language, set it as default:
- In **Settings** → **Reading**, set **Default Language** so imported texts and audio lessons default to it.

### 3. Translation Providers
Ensure your translation API keys (DeepL, Google Cloud Translate, Azure Translator, or Wiktionary) are configured in **Settings** → **Integrations** or **AI Providers** if you intend to use automated translations.

---

## Language Presets Reference

| Setting | English / Western European | Polish / Slavic (Latin) | Russian / Cyrillic | Arabic / Hebrew | Japanese / Chinese |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Code** | `en`, `es`, `fr`, `de`, `it`, `pt` | `pl`, `cs`, `sk` | `ru`, `uk`, `bg` | `ar`, `he` | `ja`, `zh` |
| **Parser Type** | `spacedel` | `spacedel` | `spacedel` | `spacedel` | `spacedel` / `mecab` / `jieba` |
| **Word Characters** | `Language.LatinWordCharacters` or `\p{L}\p{M}` | `\p{L}\p{M}` | `\p{L}\p{M}` | `\p{L}\p{M}` | `\p{L}\p{M}` |
| **Split Sentences** | `.!?,` | `.!?` | `.!?` | `؟!` | `。！？` |
| **RTL** | `false` | `false` | `false` | `true` | `false` |
| **Romanization**| `false` | `false` | `true` (optional) | `true` (optional) | `true` |

---

## Managing Existing Languages

On the **Settings** → **Languages** page:

- **Reset Content**: Deletes all texts, books, vocabulary words, and statistics belonging to your user account for that language, but **preserves** the language configuration, dictionaries, and rules.
- **Delete Language**: Completely removes the language definition. *Note: If existing books, texts, or terms depend on this language, the app will prevent deletion until dependent content is cleared.*
