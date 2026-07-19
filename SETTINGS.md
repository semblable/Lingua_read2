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
| `CORS_ALLOWED_ORIGINS` | *None* | Comma-separated list of allowed origins (e.g. `http://localhost:3000`). If blank, the API defaults to standard docker service bounds. |
| `DISCORD_WEEKLY_REPORT_DAY` | `Monday` | Day of the week for generating the background system reports (`Monday`, `Tuesday`, etc.). |
| `DISCORD_WEEKLY_REPORT_HOUR_UTC` | `8` | UTC hour (0-23) to run the Discord background reporting task. |
| `DISCORD_WEEKLY_REPORT_DRY_RUN` | `false` | If `true`, runs the background service without sending actual Discord HTTP calls. |
| `DISCORD_WEEKLY_REPORT_POLL_MINUTES` | `30` | Interval in minutes for checking the scheduling queue. |
| `HEALTHCHECK_URL` | *None* | **Optional.** healthchecks.io-style ping URL for the backup sidecar; `backup.sh` pings it on start/success/failure so silent backup failures raise an alert. |

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
| `ShowWordInfoPanel` | `true` | `true` / `false` | Automatically show/hide the word information sidebar. |
| `TooltipOnlyForSavedWords` | `false` | `true` / `false` | If `true`, single-clicking a word already saved only shows a tooltip instead of loading sidebar. |
| `ReaderParagraphIndent` | `true` | `true` / `false` | Indents body paragraphs in classic/modern reading modes. |
| `ReaderTextAlignment` | `"left"` | `"left"`, `"justify"` | Text alignment property of body text. |
| `LeftPanelWidth` | `85` | `1` to `99` | Width percentage occupied by the main reading canvas (default 85%). |

---

### 2. Reading Preferences
Controls language parser, default behavior during clicks, and playback sync.

| Setting Field | Default Value | Allowed / Type | Description |
| :--- | :---: | :--- | :--- |
| `AutoTranslateWords` | `true` | `true` / `false` | Auto-translate words instantly upon clicking them. |
| `AutoTranslateOnOpen` | `false` | `true` / `false` | Automatically fetch machine translations for all unknown words on loading. |
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
Allows replacing standard Gemini configuration with **OpenRouter**, custom models, and customized prompting templates.

| Setting Field | Default Value | Allowed / Type | Description |
| :--- | :---: | :--- | :--- |
| `UseOpenRouter` | `false` | `true` / `false` | Routes AI translation/generation queries to OpenRouter instead of direct Google Gemini. |
| `OpenRouterApiKey` | *None* | API Token | Authentication token for OpenRouter. |
| `OpenRouterModel` | `"google/gemini-2.5-flash-preview-05-20:free"` | Model Slug | The default OpenRouter model used for AI processes. |
| `OpenRouterReasoningEnabled` | `false` | `true` / `false` | Turn on deep reasoning for translation tasks. |
| `OpenRouterReasoningEffort` | `"medium"` | `"low"`, `"medium"`, `"high"` | Reasoning scale parameter for LLMs. |
| `OpenRouterStoryReasoningEnabled` | `false` | `true` / `false` | Enable reasoning LLM processing specifically for AI Story Generation. |
| `OpenRouterStoryReasoningEffort` | `"medium"` | `"low"`, `"medium"`, `"high"` | Reasoning scale specifically for Story generation. |
| `OpenRouterTranslationModel` | *None* | Model Slug | Override model used *strictly* for single-word / phrase translations. |
| `OpenRouterExplanationModel` | *None* | Model Slug | Override model used *strictly* for grammar / context explanations. |
| `OpenRouterStoryModel` | *None* | Model Slug | Override model used *strictly* for generating prompt-based stories. |
| `OpenRouterSummarizationModel`| *None* | Model Slug | Override model used *strictly* for text summaries. |
| `CustomTranslationPrompt` | *None* | System prompt text | Replaces the built-in system prompt used during word/phrase translations. |
| `CustomExplanationPrompt` | *None* | System prompt text | Replaces the built-in system prompt used during paragraph grammar analysis. |
| `CustomStoryPrompt` | *None* | System prompt text | Replaces the built-in system prompt used during story generation. |
| `CustomSummarizationPrompt` | *None* | System prompt text | Replaces the built-in system prompt used during text summaries. |

---

### 6. Spaced Repetition System (SRS) / Anki Settings
Configure flashcard reviews using a SuperMemo-2 style spaced-repetition algorithm.

| Setting Field | Default Value | Allowed / Type | Description |
| :--- | :---: | :--- | :--- |
| `SrsMaxNewCards` | `20` | Positive Integer | Daily limit of new terms to introduce into study decks. |
| `SrsMaxReviews` | `200` | Positive Integer | Maximum number of existing flashcards scheduled for review in a single day. |
| `SrsReviewOrder` | `"mix"` | `"mix"`, `"new_first"`, `"reviews_first"` | Determines the queue ordering of card presentation. |
| `SrsLearningStepMinutes` | `"1,10"` | Comma-separated minutes | Learning steps for cards in learning state (re-displays after X minutes on incorrect recall). |
| `SrsMaxIntervalDays` | `36500` | Positive Integer | Maximum possible spacing interval between card reviews (defaults to ~100 years). |
| `SrsLapseMinimumIntervalDays`| `1` | Positive Integer | Minimum interval in days assigned to a card that lapses (failed during review). |
| `SrsCardType` | `"translation"` | `"translation"`, `"cloze"`, `"mixed"` | Review formats: **translation** (term -> translation), **cloze** (sentence fill-in-the-blank), or **mixed**. |
