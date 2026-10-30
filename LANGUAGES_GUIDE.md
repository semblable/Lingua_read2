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
4. Browse the **Add a language** catalog. Search by language, native name, or country,
   then click **Add**. The 44 presets are optional: opening the catalog does not add
   them or change the installation's starter languages.
5. Added languages appear under **Your languages** and become available when
   importing or creating texts. Select one to edit its configuration.
6. Choose regional speech voices inside the existing language's voice settings;
   Portuguese, for example, needs only one language entry for Brazilian and European
   voices. Select an existing language to adjust its code or script settings.
   For a language absent from the catalog, click **Set up a custom language**.

Presets include Unicode word characters, combining marks and joiners, sentence
punctuation, and right-to-left layout where applicable. They do not override your
translation target or add dictionaries. Existing regional codes such as `pt-BR`
count as already added for their base language. Translation and speech availability
still depend on your provider and installed voices.

Chinese, Japanese and Thai are labeled **Basic word splitting**: the legacy
tokenizer splits at spaces and punctuation, so an unspaced run is one word.
Selecting MeCab or Jieba does not change existing texts. For **new Chinese texts, book imports (`.txt`, `.epub`, or pasted), and audio/transcript imports**,
**Chinese word segmentation (experimental)** is enabled by default;
you can uncheck it for that import. It uses a pinned
8.6 MB dictionary (`jieba-v1`) downloaded once and cached for offline reopening. HTTPS or
localhost is required to verify the download. Existing content and unprofiled imports
keep their splitting (and re-splitting a book preserves its profile); there is no automatic relinking or script conversion.
Unknown names may split into characters; native review is still outstanding.

Korean keeps space-separated surface forms. Saved composed/decomposed Hangul
spellings can match when the saved record is unambiguous; existing exact spellings,
IDs and conflicting meanings remain distinct. Particle analysis and dictionary-form
lookup are not implemented.

---

### Step 2: Basic Configuration

| Field | Description | Example |
| :--- | :--- | :--- |
| **Language Name** | Friendly display name shown in dropdowns and statistics. | `Polish`, `Japanese`, `Arabic` |
| **Language Code** | Standard ISO 639-1 / BCP-47 language tag. **Critical:** Drives browser Text-to-Speech voice matching, translation requests, and locale-aware lowercasing. | `pl`, `ja`, `ar`, `es`, `fr-CA` |
| **Active for Translation** | Toggle **ON** so this language appears in reading menus, lesson generation, and translation dialogs. | `true` |

---

### Step 3: Script & Parsing Rules

LinguaRead's tokenizers use these settings for word and sentence splitting.
See [the language roadmap](docs/LANGUAGE_SUPPORT_PLAN.md) for tested scope
and unresolved Unicode, segmentation and sentence-boundary limitations.

1. **Parser Type**:
   - `Space Delimited` (`spacedel`): **Recommended for most languages** (Latin, Cyrillic, Greek, Arabic, Hebrew, etc.) where words are separated by spaces or punctuation.
   - `MeCab` / `Jieba`: Legacy language settings; they do not upgrade existing text boundaries. The new-text Chinese option above is the explicit dictionary-segmentation rollout. Japanese dictionary segmentation remains unfinished.

2. **Word Characters (Regex)**:
   - A regular expression character class defining what constitutes a single word character.
   - **Default:** `\p{L}\p{M}` (Matches any Unicode letter plus combining diacritics/accents). This works automatically for Polish, Czech, Greek, Russian, Arabic, etc.
   - **Latin script:** `a-zA-ZÀ-ÖØ-öø-ɏḀ-ỿ\p{M}`
   - **German:** `a-zA-ZÀ-ÖØ-öø-ɏḀ-ỿ\p{M}\u200C\u200D` (includes zero-width non-joiner/joiner).
   > **Note on Glued Words:** LinguaRead's tokenizer automatically glues internal apostrophes (`'`), hyphens (`-`), and middle dots (`·`) when sandwiched between word characters (e.g., *l'eau*, *don't*, *c'est-à-dire*, *interrompo-a*, *col·lecció*). You do not need to add hyphens or apostrophes to the regex class.

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
   - Currently unavailable. The ineffective switch is hidden; an existing stored
     preference is preserved when editing a language.

6. **Right-to-Left Script (RTL)**:
   - Enable for languages written right-to-left (Arabic, Hebrew, Persian, Urdu). Adjusts text alignment and layout direction in the reader.
   - This does not establish full support for font shaping, mixed-direction
     selection, cards or physical devices; those checks remain in the support plan.

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
2. Enable browser text-to-speech and scroll to **Voices on this device**.
3. Find your language's row and choose an installed voice. The list can include
   regional varieties of the same language.
4. Preview it with the play button. Choices are saved on this device; available
   voices vary by browser/device, and cloud voices need an internet connection.

### 2. Default Reading Language
If you primarily study this language, set it as default:
- In **Settings** → **Reading**, set **Default Language** so imported texts and audio lessons default to it.

### 3. Translation Providers
Ensure your translation API keys (DeepL, Google Cloud Translate, Azure Translator, or Wiktionary) are configured in **Settings** → **Integrations** or **AI Providers** if you intend to use automated translations.

### 4. Reading and listening repeats

The reader shows **Read ×** and **Listened ×** for newly recorded complete passes.
Open the counter beside the lesson title to record another pass. On mobile, the
counters are inside the **Lesson** header; **Listened** appears only when lesson
audio or a book audiobook is attached.
Completing a lesson records a read; **Record a read** logs a deliberate pass without
leaving the reader. **Record a listen** records one completed listen. Leave additional
minutes at zero when the player already tracked that time, or enter time for a
listen outside the app. Repeated playback continues to add actual listening time.

These pass actions require a connection. If a response is lost, retry the same action
in the browser session. Earlier aggregate activity is preserved; past per-lesson
repeat counts are not reconstructed. Sentence navigation alone is not a complete
pass, and completing a lesson without statistics does not add one.
Partial playback already earns listening minutes, based on time spent playing
rather than the audio's original duration. The current pass counters are whole
numbers; fractional listens and automatic transcript reading credit are not yet
implemented.

---

## Language Presets Reference

The optional catalog is defined in
`client/lingua-read-client/src/utils/languagePresets.ts`. All catalog presets use
`\p{L}\p{M}\u200C\u200D` for letters, combining marks and joiners. Romanization
starts off, and translation availability starts on. Existing configurations and
database seed defaults retain their own settings.

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
| Chinese | Left to right | `.!?。！？` | `jieba` (basic splitting only) |
| Japanese | Left to right | `.!?。！？` | `mecab` (basic splitting only) |
| Thai | Left to right | `.!?` | `spacedel` (basic splitting only) |

---

## Managing Existing Languages

On the **Settings** → **Languages** page:

- **Reset Content**: Deletes all texts, books, vocabulary words, and statistics belonging to your user account for that language, but **preserves** the language configuration, dictionaries, and rules.
- **Delete Language**: Completely removes the language definition. *Note: If existing books, texts, or terms depend on this language, the app will prevent deletion until dependent content is cleared.*
