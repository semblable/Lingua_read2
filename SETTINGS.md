# LinguaRead Configuration & Settings Guide

> 📖 Related: **[README](README.md)** (installation) · **[Features Guide](FEATURES.md)** (what each feature does)

This document provides a comprehensive reference for configuring **LinguaRead**. It covers system environment variables (for Docker Compose and local hosting) and the in-app database-driven user preferences.

---

## 🗺️ Quick Navigation
*   [Environment Variables (`.env`)](#-environment-variables-env)
    *   [Database Settings](#1-database-settings)
    *   [Security & Authentication](#2-security--authentication)
    *   [Translation & AI Provider Keys](#3-translation--ai-provider-keys)
    *   [Networking & Integration](#4-networking--integration)
    *   [Docker Image Tags](#5-docker-image-tags)
*   [In-App User Settings](#-in-app-user-settings)
    *   [UI Preferences](#1-ui-preferences)
    *   [Reading Preferences](#2-reading-preferences)
    *   [Weekly Discord Reports](#3-weekly-discord-reports)
    *   [Hardcover Integration](#4-hardcover-integration)
    *   [Advanced AI Translation & Overrides](#5-advanced-ai-translation--overrides)
    *   [Spaced Repetition System (SRS) / Anki Settings](#6-spaced-repetition-system-srs--anki-settings)
    *   [News Feeds](#7-news-feeds)

---

## ⚙️ Environment Variables (`.env`)

Before starting LinguaRead via Docker Compose, you must create a `.env` file in the root directory (where `docker-compose.yml` resides). Below are all environment variables that can be set.

### 1. Database Settings
These variables configure the PostgreSQL database container (`db` service) and how the backend API (`api` service) connects to it.

| Variable Name | Default Value | Description |
| :--- | :--- | :--- |
| `POSTGRES_DB` | `linguaread_db` | Name of the PostgreSQL database created on initialization. |
| `POSTGRES_USER` | `linguaread_user` | Username of the PostgreSQL superuser. |
| `POSTGRES_PASSWORD` | *None* | **Required.** The password for the database superuser. Make it long and secure. |

---

### 2. Security & Authentication
Configure JSON Web Tokens (JWT) for secure authentication and authorize initial accounts.

| Variable Name | Default Value | Description |
| :--- | :--- | :--- |
| `JWT_KEY` | *None* | **Required.** Private cryptographic key for signing tokens. Must be a secure random string of **at least 32 characters** (256-bit). |
| `JWT_ISSUER` | `LinguaReadApi` | The token issuer identifier verified by the backend API. |
| `JWT_AUDIENCE` | `LinguaReadClient` | The intended recipient identifier for backend tokens. |
| `JWT_EXPIRY_HOURS` | `2160` | Duration (in hours) before a JWT token expires (defaults to 90 days). |
| `LINGUAREAD_PASSWORD`| *None* | **Optional.** Sets an initial administrator/default user password on the first startup. |

> [!NOTE]
> Behind the bundled nginx, login and first-time setup accept 5 password attempts a minute per address (plus a burst of 5); further attempts get "Too many password attempts" until the minute passes.

> [!CAUTION]
> **Keep `JWT_KEY` and `POSTGRES_PASSWORD` private!** Never commit your `.env` file containing these values to public version control systems.

---

### 3. Translation & AI Provider Keys
Enable third-party translation and content generation. While these are optional, leaving them blank disables the corresponding feature in the app.

| Variable Name | Default Value | Description |
| :--- | :--- | :--- |
| `DEEPL_API_KEY` | *None* | DeepL API Key for word and phrase translation. High quality, free tier is recommended. |
| `GEMINI_API_KEY`| *None* | Google Gemini API Key for automatic text generation and summarization. |

---

### 4. Networking & Integration
Adjust security bounds and Discord scheduler configurations.

| Variable Name | Default Value | Description |
| :--- | :--- | :--- |
| `CORS_ALLOWED_ORIGINS` | *None* | Comma-separated origins allowed to call the API **cross-origin**. The app itself is served same-origin by nginx and needs no entry, so this normally stays blank (= deny cross-origin in production; dev always allows localhost). |
| `DISCORD_WEEKLY_REPORT_DAY` | `Monday` | Day of the week for generating the background system reports (`Monday`, `Tuesday`, etc.). |
| `DISCORD_WEEKLY_REPORT_HOUR_UTC` | `8` | UTC hour (0-23) to run the Discord background reporting task. |
| `DISCORD_WEEKLY_REPORT_DRY_RUN` | `false` | If `true`, runs the background service without sending actual Discord HTTP calls. |
| `DISCORD_WEEKLY_REPORT_POLL_MINUTES` | `30` | Interval in minutes for checking the scheduling queue. |
| `HEALTHCHECK_URL` | *None* | **Optional.** healthchecks.io-style ping URL for the backup sidecar; `backup.sh` pings it on start/success/failure so silent backup failures raise an alert. |
| `BACKUP_ENV` | *None* | **Set by the deploy workflow** to the GitHub environment name. Selects the backup sidecar's Drive folder (`lingua-read-backups/<BACKUP_ENV>/`); `backup.sh` refuses to run without it so two environments can never share (and overwrite) one folder. |
| `MONITORING` | *unset* | **GitHub environment variable**, not `.env`. `true` makes the deploy start the Beszel + Dozzle dashboard (production). |
| `POSTGRES_SHARED_BUFFERS` | `1GB` | Postgres cache, sized for a ~4 GB host (about 25% of RAM). Deployed hosts set it as a GitHub environment variable, which the deploy appends to `.env`. |
| `POSTGRES_EFFECTIVE_CACHE_SIZE` | `2GB` | Postgres planner hint for the OS cache (about 50% of RAM); not an allocation. Set like `POSTGRES_SHARED_BUFFERS`. |
| `API_MEMSWAP_LIMIT` | `1500M` | API container memory **plus** swap (production overlay). Equal to the API's 1500M memory limit means it never swaps and is restarted instead; a host with less RAM than that limit sets it higher (staging: `3000M`). Set like `POSTGRES_SHARED_BUFFERS`. |

---

### 5. Docker Image Tags
Used when fetching pre-built images from GitHub Container Registry (GHCR) instead of building them locally. The deploy workflows set these automatically to the immutable `sha-<short7>` tag of the commit being deployed.

| Variable Name | Default Value | Description |
| :--- | :--- | :--- |
| `API_IMAGE_TAG` | `latest` | Tag/version of the API container image to pull. |
| `NGINX_IMAGE_TAG` | `latest` | Tag/version of the Nginx frontend container image to pull. |
| `BACKUP_IMAGE_TAG` | `latest` | Tag/version of the backup container image to pull. |

---
---

## 👤 In-App User Settings

These parameters are configured directly through the user profile interface in the web application and are stored on a per-user basis in the database.

The Settings page saves each change by itself, with no Save button: switches and dropdowns right away, text once you pause typing or leave the field. A status pill at the bottom of the screen shows *Saving…*, *All changes saved*, or an error with **Retry**. API keys, the Discord webhook and the Hardcover token are the exception: they are saved only when you press their **Save** button (or Enter), so a half-pasted secret is never stored.

### 1. UI Preferences
Tailor the look, theme, size, and layout of the reader.

| Setting Field | Default Value | Allowed Values | Description |
| :--- | :---: | :--- | :--- |
| `Theme` | `"light"` | `"light"`, `"dark"`, `"system"` | Visual stylesheet color scheme. |
| `TextSize` | `16` | Positive integers (px) | Base font size for reading lessons. |
| `TextFont` | `"default"` | Font-family string | Font family for text rendering (supports browser overrides). |
| `ReadingUiMode` | `"classic"` | `"classic"`, `"modern"` | Layout structure for reading interface. |
| `ReaderContentWidth` | `740` | Pixels | The maximum width (in pixels) of the text container to maintain readability. |
| `ReadingDensity` | `"balanced"` | `"compact"`, `"balanced"`, `"spacious"` | Padding and margin level for parsed words. |
| `LineSpacing` | `1.5` | `1.0` to `3.0` | Line-height multiplier for the reader. |
| `ParagraphSpacing` | `1.0` | `0.2` to `3.0` (em) | Gap between paragraphs; the reader toolbar offers Tight (0.6), Normal (1.0) and Relaxed (1.6). |
| `ShowWordInfoPanel` | `true` | `true` / `false` | Automatically show/hide the word information sidebar. |
| `TooltipOnlyForSavedWords` | `false` | `true` / `false` | If `true`, single-clicking a word already saved only shows a tooltip instead of loading sidebar. |
| `ReaderParagraphIndent` | `true` | `true` / `false` | Indents body paragraphs in classic/modern reading modes. |
| `ReaderTextAlignment` | `"left"` | `"left"`, `"justify"` | Text alignment property of body text. |
| `LeftPanelWidth` | `85` | `20` to `85` | Width percentage occupied by the main reading canvas (default 85%). |

The reader toolbar (text size, panel width, density, spacing, indent, alignment, panel toggle) changes these settings in place. Each change applies at once and is kept in this browser; the server gets it after a short pause, one request at a time, so a run of clicks is one save. A save that fails is retried with the next change or when you leave the page.

---

### 2. Reading Preferences
Controls language parser, default behavior during clicks, and playback sync.

| Setting Field | Default Value | Allowed / Type | Description |
| :--- | :---: | :--- | :--- |
| `AutoTranslateWords` | `true` | `true` / `false` | Auto-translate words instantly upon clicking them. |
| `AutoTranslateOnOpen` | `false` | `true` / `false` | Automatically fetch machine translations for all unknown words on loading. |
| `AutoTranslateWordStatus` | `5` | `1` to `5` | Status given to words not saved yet when translating a text's unknown words saves them (the reader's **Auto ?** button and `AutoTranslateOnOpen`). Words already tracked keep their status and only get the missing translation. Statuses 1-4 create flashcards when `SrsAutoCreateCards` allows it. |
| `PauseOnWordClick` | `false` | `true` / `false` | Automatically pauses active media playing before showing word details. |
| `HighlightKnownWords` | `true` | `true` / `false` | Color-code words based on acquaintance status. |
| `SentenceMode` | `false` | `true` / `false` | Enter sentence-by-sentence view by default. |
| `SentenceAudioRepeats` | `1` | Positive Integer | Repeating frequency for audio loop clips in sentence mode. |
| `SentenceTtsEnabled` | `false` | `true` / `false` | Enable browser Text-to-Speech synthesizers in sentence mode. |
| `SentenceTtsRate` | `1.0` | `0.5` to `2.0` | Speed of browser Text-to-Speech playback. |
| `DefaultLanguageId` | `0` | Database ID | Pre-selected language for newly imported texts. |
| `TranslationTargetLanguageCode` | `"EN"` | Language ISO | Primary target language for translating foreign terms. |
| `AutoAdvanceToNextLesson` | `false` | `true` / `false` | Move to next split lesson when clicking "Complete Lesson". |
| `ShowProgressStats` | `true` | `true` / `false` | Toggle visibility of progress meters on the homepage. |
| `AutoMoveFinishedLessons` | `false` | `true` / `false` | Auto-archive finished lessons by moving them into an archive folder. |
| `ShowDesktopLessonControls` | `true` | `true` / `false` | Keep standard desktop buttons visible. |
| `AutoAdvanceAudiobookTracks` | `true` | `true` / `false` | Play next audiobook track automatically when current one ends. |

---

### 3. Weekly Discord Reports
Allows the application to send automated weekly vocabulary and listening statistics summaries to a Discord channel.

| Setting Field | Default Value | Allowed / Type | Description |
| :--- | :---: | :--- | :--- |
| `DiscordWeeklyReportEnabled` | `false` | `true` / `false` | Toggles the active background weekly stats publisher. |
| `DiscordWebhookUrl` | *None* | Webhook URL | Unique HTTP webhook target generated by Discord. |
| `DiscordWeeklyReportDayOfWeek` | `"Monday"` | Day Name | Day of the week to issue local user progress reports. |
| `DiscordWeeklyReportHourLocal` | `8` | `0` to `23` | Hour of the day (local time) to run the notification. |
| `DiscordTimezoneOffsetMinutes` | `0` | `-840` to `840` | Timezone offset in minutes relative to UTC, used to calculate your local target hour. |

---

### 4. Hardcover Integration
Synchronize book metadata, shelf progress, and reviews to [Hardcover.app](https://hardcover.app).

| Setting Field | Default Value | Allowed / Type | Description |
| :--- | :---: | :--- | :--- |
| `HardcoverSyncEnabled` | `false` | `true` / `false` | Toggle synchronization of completed books. |
| `HardcoverApiToken` | *None* | API Token string | Personal API Token generated from Hardcover developer profile settings. |

---

### 5. Advanced AI Translation & Overrides
Choose which AI service handles sentence and selection translation, sentence explanations, story generation and summaries. The default is the server's **built-in Gemini**; alternatively pick one of the OpenAI-compatible providers below and use your own key. Each provider keeps its own key and models, so you can switch between them without re-entering anything. A provider that is missing its key, model or (for Custom) server URL is not used: AI features fall back to the built-in Gemini, and Settings says what is missing.

| Provider | Default model | Notes |
| :--- | :--- | :--- |
| OpenRouter | *choose one* | Hundreds of models behind one key. Reasoning is sent as `reasoning.effort`. |
| DeepSeek | `deepseek-flash` | Thinks by default; with reasoning off, LinguaRead asks it not to (faster, cheaper). Efforts map to DeepSeek's `low` / `high` / `max`. |
| OpenAI | *choose one* | |
| Google Gemini (your own key) | *choose one* | Gemini's OpenAI-compatible endpoint with an AI Studio key. |
| Mistral | *choose one* | |
| Groq | *choose one* | |
| Custom (OpenAI-compatible) | *choose one* | Any server with an OpenAI chat-completions API: Ollama (`http://host:11434/v1`), LM Studio, vLLM, LiteLLM, Together, Fireworks... The key is optional. The server calls it, so it must be reachable from the server. |

**Load models** in Settings lists the models your saved key can use. **Test Connection** sends a one-word request with the saved key and model. If a provider rejects an optional request parameter (such as `max_tokens` or `temperature` on some reasoning models), the request is retried once with just the model and the messages.

| Setting Field | Default Value | Allowed / Type | Description |
| :--- | :---: | :--- | :--- |
| `AiProvider` | `"gemini"` | `gemini`, `openrouter`, `deepseek`, `openai`, `google`, `mistral`, `groq`, `custom` | The provider used for AI tasks. |
| `AiApiKeys` | *None* | Provider → API key | Write-only per-provider keys, encrypted at rest; the API only reports which providers have one. An empty string removes a key. |
| `AiProviders.{provider}.Model` | Provider's default | Model id | The provider's model for every AI task. |
| `AiProviders.{provider}.BaseUrl` | *None* | `http(s)://` URL | Custom provider only: the base URL that `/chat/completions` is appended to. |
| `AiProviders.{provider}.TranslationModel` | *None* | Model id | Override for sentence and selection translation. |
| `AiProviders.{provider}.ExplanationModel` | *None* | Model id | Override for sentence explanations. |
| `AiProviders.{provider}.StoryModel` | *None* | Model id | Override for story generation. |
| `AiProviders.{provider}.SummarizationModel` | *None* | Model id | Override for summaries. |
| `OpenRouterReasoningEnabled` | `false` | `true` / `false` | Reasoning for translations and explanations (OpenRouter and DeepSeek). |
| `OpenRouterReasoningEffort` | `"medium"` | `"xhigh"`, `"high"`, `"medium"`, `"low"`, `"minimal"`, `"none"` | Reasoning effort for translations. |
| `OpenRouterStoryReasoningEnabled` | `false` | `true` / `false` | Reasoning for story generation and summaries (OpenRouter and DeepSeek). |
| `OpenRouterStoryReasoningEffort` | `"medium"` | `"xhigh"`, `"high"`, `"medium"`, `"low"`, `"minimal"`, `"none"` | Reasoning effort for stories and summaries. |
| `CustomTranslationPrompt` | *None* | System prompt text | Replaces the built-in system prompt used during word/phrase translations. |
| `CustomExplanationPrompt` | *None* | System prompt text | Replaces the built-in system prompt used during paragraph grammar analysis. |
| `CustomStoryPrompt` | *None* | System prompt text | Replaces the built-in system prompt used during story generation. |
| `CustomSummarizationPrompt` | *None* | System prompt text | Replaces the built-in system prompt used during text summaries. |

---

### 6. Spaced Repetition System (SRS) / Anki Settings
Configure flashcard reviews. Cards are scheduled with **FSRS-6** (the algorithm Anki uses by default): each card has a stability (days until recall probability falls to 90%) and a difficulty, and its next interval is chosen so you have the desired chance of remembering it when it comes due. Changing the retention, maximum interval or FSRS weights reschedules existing cards.

| Setting Field | Default Value | Allowed / Type | Description |
| :--- | :---: | :--- | :--- |
| `SrsMaxNewCards` | `20` | Positive Integer | Daily limit of new terms to introduce into study decks. |
| `SrsMaxReviews` | `200` | Positive Integer | Maximum number of existing flashcards scheduled for review in a single day. |
| `SrsReviewOrder` | `"mix"` | `"mix"`, `"new_first"`, `"reviews_first"` | Determines the queue ordering of card presentation. |
| `SrsLearningStepMinutes` | `"1,10"` | Comma-separated minutes | Steps a new card goes through (shown again after each, within the same session) before its first day-long interval. |
| `SrsRelearningStepMinutes` | `"10"` | Comma-separated minutes | Steps a forgotten (lapsed) card goes through before it returns to review. |
| `SrsDesiredRetention` | `0.9` | `0.70` - `0.97` | Target probability of recalling a card when it comes due. Higher means shorter intervals and more reviews. |
| `SrsDayStartHour` | `4` | `0` - `23` | Local hour a new SRS day starts. Review cards are due for the whole day; daily limits, streaks and bury roll over at this hour. |
| `SrsMaxIntervalDays` | `36500` | Positive Integer | Maximum possible spacing interval between card reviews (defaults to ~100 years). |
| `SrsLapseMinimumIntervalDays`| `1` | Positive Integer | Minimum interval in days a forgotten card returns to review with. |
| `SrsFsrsWeights` | *None* | 21 comma-separated numbers | Custom FSRS model weights (e.g. from an FSRS optimizer). Empty uses the FSRS-6 defaults. |
| `SrsCardType` | `"translation"` | `"translation"`, `"cloze"`, `"mixed"` | Review formats: **translation** (term -> translation), **cloze** (sentence fill-in-the-blank), or **mixed**. |
| `SrsAutoCreateCards` | `"always"` | `"always"`, `"with_sentence"`, `"never"` | When saving a word at status 1-4 creates its SRS card. With `"never"`, cards come only from *Mine sentence*. |
| `SrsStatusSyncMode` | `"promote"` | `"off"`, `"promote"`, `"promote_demote"` | Whether reviews change the word's reader status: raise it as the card gets stronger, and with `"promote_demote"` also lower it when the card is forgotten. |
| `SrsStatusLevel3Days` / `SrsStatusLevel4Days` | `7` / `21` | Days of stability | Card stability at which the word reaches status 3 and 4. A card that leaves the learning steps makes the word at least status 2. |
| `SrsAutoKnownDays` | `0` | Days of stability, `0` = never | Card stability at which a review marks the word Known (5). |
| `SrsKnownCardAction` | `"keep"` | `"keep"`, `"suspend"` | What happens to a card when its word becomes Known (from the reader, a batch import or auto-Known). Ignored words always have their card suspended. |
| `SrsLeechThreshold` | `8` | `0` - `100` | Times forgotten that make a card a leech (and again every half as many after). `0` turns leech detection off. |
| `SrsLeechAction` | `"tag"` | `"tag"`, `"suspend"` | Whether a leech is only tagged `leech` or also suspended. Suspended leeches are listed on the review page, where they can be unsuspended. |

---

### 7. News Feeds
Import articles from RSS or Atom news feeds as texts. The feeds themselves are managed in the same Settings section (add, **Fetch now**, **Browse articles**, remove, and an **Auto-import** switch per feed); adding one checks it right away and imports its first articles. A web page can be given instead of a feed address if the page links to its feed.

**Browse articles** (also at the top of a feed's folder in the Library) lists the feed's current articles with a short summary and what became of each (imported, skipped before, or new). It opens on the ones still **To import**; **Imported** and **All** show the rest, and the search box narrows the list by title or summary, accents or not. The length is shown for articles the feed carries whole. Click anywhere on an article to tick it (or **Select all**), up to 20, and press **Import**: they're imported at once, whatever the daily limit, and an article skipped before is tried again. Imported articles stay in the list with an **Open** button until you close it. With a feed's **Auto-import** off, the background import leaves it alone and you get only the articles you pick. An article a feed lists twice (as BBC News Brasil does) is listed and imported once.

| Setting Field | Default Value | Allowed / Type | Description |
| :--- | :---: | :--- | :--- |
| `NewsImportEnabled` | `false` | `true` / `false` | Checks your feeds in the background, about every two hours (less often after failed checks), and imports new articles into **Library › News › *feed name***. |
| `NewsArticlesPerFeedPerDay` | `3` | `1` - `20` | The newest articles, at most this many per feed in any 24 hours. **Fetch now** keeps to the same limit. |
| `NewsDeleteUnreadAfterDays` | `14` | `0` - `365`, `0` = never | Imported articles you never opened are deleted after this many days. Opened or finished ones stay, and so do articles of a feed you removed. |

Each article is fetched from the site and reduced to its text (no inline photos, captions, bylines or link lists). Its **lead photo** is shown above the text: the picture the page names for sharing (`og:image`), else the one the feed gives, else the first one in the article. The same photo is shown across the top of the article's card in the Library. The server downloads and stores it with your EPUB images, so reading an article never contacts the news site; only JPEG, PNG, WebP, GIF and AVIF pictures up to 2 MB are kept, and an article whose photo can't be had is imported without one. The photo is deleted with its article. Articles imported before photos were added have none. Articles shorter than about 120 words are skipped, which also skips most paywalled teasers and video pages, and an article you delete is not imported again. An article whose page can't be loaded right now (the site is slow, down or rate-limiting) isn't skipped: the next check tries it again, and in **Browse articles** it stays ticked with a *Couldn't load, try again* mark. After two such failures in a row, the rest of that site's pages wait for the next try instead of each timing out; one broken page doesn't hold back the others. The server only fetches public internet addresses, so a feed can't point it at its own network.
