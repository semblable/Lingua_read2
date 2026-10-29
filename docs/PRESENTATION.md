# Three-minute walkthrough recording sheet

Status: **script prepared; video and full-app recording pending**. Use the reviewed
static sample for the first reader/listening segments. Use a separate isolated
full application with original or public-domain fixtures for FSRS. Keep a visible
label distinguishing **Static sample — prepared responses** from **Full app**.

| Time | Show | Suggested narration |
| --- | --- | --- |
| 0:00–0:25 | Showcase introduction, then reader | “LinguaRead is a self-hosted workspace for learning through reading and listening. It is for learners who already read in their study language and want to bring their own material, track words, and review useful sentences.” |
| 0:25–1:05 | Spanish sample: `río`, status change, phrase selection, Mine, Saved sentences | “This is the real reader with a small prepared sample. I can inspect a word, mark how familiar it is, extend a selection into a phrase, and save the sentence. These explanations are prepared, and this demo's changes reset when the page reloads.” |
| 1:05–1:40 | English sample: play/pause, cue seeking, speed | “For listening, I supply audio and an SRT transcript. Cues let me follow and seek within the recording. This sample uses a licensed human recording; the credits identify both the audio and caption sources. The demo makes no provider calls.” |
| 1:40–2:20 | Switch visibly to full app: mine a sentence, open due cards, grade a card | “This separate recording shows the installed application. Mined context can be reviewed with the integrated FSRS-6 scheduler. Retention targets and review settings are configurable. Scheduling runs on the backend and is not simulated by the static sample.” |
| 2:20–3:00 | README Docker setup, Settings, backup guide, limitations | “Docker runs the frontend, API, and database. Translation and AI providers are optional and configurable. The code is MIT, with separate third-party media and font terms. This is experimental software: language support varies, Japanese and Chinese segmentation are unfinished, and backups need the database, media, and encryption keys. Try the sample or install it and share a concrete rough edge.” |

Before recording, close private tabs and notifications, use synthetic account
settings, and verify that no keys, personal library titles, host addresses, or
backup contents appear. Do not show fake data as production or claim external
learners, revenue, measured capacity, or physical-device testing without evidence.
Include the [media credits](../client/lingua-read-client/demo/public/audio/ATTRIBUTION.txt)
when distributing audio or caption material in the recording.

For an employer-facing version, link the [architecture and engineering notes](ARCHITECTURE.md).
Add the maintainer's own contribution and verification details to those notes
before presenting them as personal case studies. Explain AI assistance honestly.
