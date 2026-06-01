# LinguaRead Features Guide

A concise tour of what LinguaRead can do. This is an overview — for every configurable knob behind these features, see the **[Configuration & Settings Guide](SETTINGS.md)**. For installation, see the **[README](README.md)**.

---

## 🗺️ Quick Navigation
*   [Reading & Vocabulary](#reading--vocabulary)
*   [Books & Import](#books--import)
*   [Audio & Audiobooks](#audio--audiobooks)
*   [AI Generation & Translation](#ai-generation--translation)
*   [Spaced Repetition (SRS)](#spaced-repetition-srs)
*   [Terms Management](#terms-management)
*   [Statistics](#statistics)
*   [Languages](#languages)
*   [Integrations](#integrations)

---

## Reading & Vocabulary

The core of LinguaRead is the reader. Every word in a text is colour-coded by how well you know it, from **New** through intermediate levels to **Known**, so you can see your comprehension at a glance. Click or hover a word to see its translation and a side panel with details; clicking lets you set or change its learning status, which updates the colour everywhere that word appears.

You can select a single word or drag across several words to capture a **multi-word phrase** as one term. **Sentence mode** breaks the text into one sentence at a time for focused study, optionally with browser text-to-speech (TTS) reading each sentence aloud. Most reading behaviour — auto-translate on click, highlighting, the info panel, TTS rate — is tunable in [SETTINGS.md → Reading Preferences](SETTINGS.md#2-reading-preferences) and [UI Preferences](SETTINGS.md#1-ui-preferences).

## Books & Import

Import longer texts by **pasting content** or uploading **`.txt`** or **`.epub`** files. Books are automatically split into bite-sized **lessons**, and your reading progress is tracked per book and per lesson. Add multiple **tags** to organize your library by topic, difficulty, or source.

As you finish lessons, LinguaRead can **auto-advance** to the next one and optionally **auto-archive** completed lessons into a "Finished" folder to keep your active list tidy. These behaviours are controlled in [SETTINGS.md → Reading Preferences](SETTINGS.md#2-reading-preferences).

## Audio & Audiobooks

Turn lessons into **karaoke-style** listening practice: upload an audio file (e.g. MP3) plus a matching **SRT subtitle** file, and the text highlights in sync as the audio plays. You can import many at once using a naming convention — `lesson1.mp3` paired with `lesson1_fr.srt`, and so on.

For whole books, upload a set of MP3s to build a persistent **audiobook playlist** that remembers your playback position per book and can auto-advance between tracks. All time spent actively listening — to lessons and audiobooks alike — is recorded and rolled up into your [Statistics](#statistics).

## AI Generation & Translation

LinguaRead generates original reading material on demand: describe what you want (topic, level, length) and **Google Gemini** writes a lesson or story in your target language. It also produces **summaries** of imported texts. For word and phrase translations, it integrates with the **DeepL API** for high-quality results (its free tier is plenty for personal use).

Power users can route AI requests through **OpenRouter** instead of Gemini, pick a specific model per task (translation, explanation, story, summary), and even replace the built-in prompts with their own. See [SETTINGS.md → Advanced AI Translation & Overrides](SETTINGS.md#5-advanced-ai-translation--overrides). API keys are configured in your `.env` (see [SETTINGS.md → Translation & AI Provider Keys](SETTINGS.md#3-translation--ai-provider-keys)); leaving a key blank simply disables that feature.

## Spaced Repetition (SRS)

Saved terms feed an **Anki-style flashcard** system built on the SuperMemo-2 algorithm. Cards can be **translation** (see the term, recall its meaning), **cloze** (a mined example sentence with the target word blanked out), or a **mix** of both. You set daily limits for new cards and reviews, the review order, and how aggressively intervals grow. All of these live in [SETTINGS.md → Spaced Repetition System (SRS)](SETTINGS.md#6-spaced-repetition-system-srs--anki-settings).

## Terms Management

The Terms page is the home for everything you've saved. View all terms for a language, **filter** by learning status (1–5), **search** by term or translation, and **sort** by term, status, or date added (newest first by default). You can **export** all or filtered terms to CSV, and **import** terms from a CSV (`Term, Translation [optional], Status [optional]`). The page remembers your last selected language.

## Statistics

Track your progress over time: words learned, reading activity, and listening time — broken down **per language and per day**. Filter any view by time period (Today, last 7/30/90/180 days, or All Time) to see trends. The homepage can also show at-a-glance progress meters, toggleable in [SETTINGS.md → Reading Preferences](SETTINGS.md#2-reading-preferences).

## Languages

LinguaRead supports a wide range of languages, each with its own settings managed through the **Manage Languages** UI. Per-language options include the **parser type** (space-delimited, MeCab for Japanese, Jieba for Chinese, etc.), **right-to-left (RTL)** layout, **character sets** and substitutions for normalization, **sentence-splitting rules**, and **dictionary / translation sources**. These settings drive how text is parsed, how sentences are split, and how lookups behave. You can add, edit, enable, or disable languages at any time.

## Integrations

*   **Weekly Discord Reports** — have LinguaRead post a weekly summary of your vocabulary and listening stats to a Discord channel via a webhook, on a day and hour you choose. Configure in [SETTINGS.md → Weekly Discord Reports](SETTINGS.md#3-weekly-discord-reports).
*   **Hardcover** — sync completed books, shelf progress, and reviews to your [Hardcover.app](https://hardcover.app) account. Configure in [SETTINGS.md → Hardcover Integration](SETTINGS.md#4-hardcover-integration).
