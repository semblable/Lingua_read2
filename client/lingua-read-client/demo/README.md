# Static showcase and reader demo

This is a separate static build of LinguaRead's presentation page and **real**
`TextDisplay` / `AudiobookPlayer` components. It uses prepared sample data in memory.
It does not start the .NET API, connect to PostgreSQL, register the application's
service worker, or call an AI/translation service. Production has no demo switch.

## Run locally

From `client/lingua-read-client`:

```powershell
npm ci --legacy-peer-deps
npm run demo
```

Open the Local URL printed by Vite, normally
`http://127.0.0.1:4174/Lingua_read2/`.

To preview the production static output:

```powershell
npm run demo:build
npm run demo:preview
```

`demo-dist/` is the deployable directory. `demo:test` verifies the sample-data
boundary, isolation, vocabulary changes, mining, and project-path audio URLs.
The normal `npm run build` still builds the normal application into `build/`.

## What visitors can try

- The actual Spanish reader, click-to-lookup, familiarity statuses, phrase selection,
  typography controls, sentence mode, and sentence bookmarks.
- The actual audio-lesson player and cue-based transcript seeking/highlighting.
- Mining sentences into a temporary list, exposed by **Saved sentences**.
- Light/dark appearance and resetting sample vocabulary.

Click an audio transcript word to look it up. Click the surrounding space or
punctuation on a transcript line to seek to that cue.

Word changes and mined sentences live in the browsing context and reset on reload.
Some display preferences use the reader's existing browser storage. The landing
page embeds the reader in an iframe to isolate its layout; full-screen routes work
through a hash router, including when opened directly on GitHub Pages.

Imports, arbitrary translations, real AI, account management, FSRS scheduling,
and offline synchronization are not simulated. Unsupported API actions return a
local error instead of falling through to a real backend. A demo-wide fetch guard
rejects external service calls and ordinary `/api` calls. No provider credentials
or production data belong in this build.

## GitHub Pages

The workflow `.github/workflows/demo-pages.yml` is **manual only**. Adding it does
not publish anything, change repository visibility, or modify the application's
staging/production deployment.

The repository promotes `dev` to `main` through **Promote to Production**. Publish
this workflow through that normal flow; do not move `main` independently of the
production release. GitHub requires the manual workflow on the default branch
before offering **Run workflow**.

After the reviewed changes reach `main` through promotion:

1. In the repository's **Settings → Pages**, select **GitHub Actions** as the source.
2. In **Actions**, select **Publish static demo to GitHub Pages** and run it on
   `main`. The workflow runs the demo tests and builds/uploads only
   `client/lingua-read-client/demo-dist/`.
3. Follow the deployment URL returned by GitHub. For the current repository the
   expected address is `https://semblable.github.io/Lingua_read2/`; it is a target
   address, not a claim that the site is already published.
4. Test the landing page, direct `#/reader/1` and `#/reader/2` links, word changes,
   reset, audio playback/seeking, and a physical phone.

The workflow derives `DEMO_BASE_PATH` from the Pages configuration. For another
host or repository, set it explicitly when building:

```powershell
$env:DEMO_BASE_PATH = '/another-project/'
npm run demo:build
```

Use `/` for a domain-root deployment. Hash routing avoids needing a server rewrite
for reader deep links. Audio paths are computed from the same base as the app.

References: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages),
[Vite's Pages deployment guide](https://vite.dev/guide/static-deploy.html#github-pages).

## Human recording, captions, and Whisper

The Spanish text and prepared vocabulary glosses were created for this demonstration
under the repository's MIT terms. No user library data is included.

The English lesson uses the approximately 36-second **human recording of The North
Wind and the Sun** supplied by P. Roach / the International Phonetic Association on
Wikimedia Commons. Its audio is **CC BY-SA 3.0**; the initial Commons captions and
derived cue data are **CC BY-SA 4.0**. These assets are not relicensed as MIT.

See [`public/audio/ATTRIBUTION.txt`](public/audio/ATTRIBUTION.txt) for source URLs,
revision history, attribution, changes, and license links. Credits are also visible
beside the listening sample. Both the original Ogg and a browser-friendly MP3
transcode are bundled; no speech is synthesized or cut.

- `public/audio/north-wind-and-sun.mp3`: transcribe this exact file with your preferred
  Whisper tool, exporting **SRT**. No model is installed or run by this demo.
- `public/audio/north-wind-and-sun.source.ogg`: retained source recording.
- `public/audio/north-wind-and-sun.en.srt`: existing Commons captions, kept as the
  reference so the demo already has synchronized playback. They are not Whisper output.
- `content/audio-script.json` / `content/audio-timing.json`: working cue data used by
  the static backend, initially derived from those reference captions.

To use your own Whisper result, use Node.js 24 or newer and run from
`client/lingua-read-client`:

```powershell
node scripts/import-demo-srt.mjs 'C:\path\to\north-wind-and-sun.srt'
npm run demo:build
```

The helper uses the production reader's SRT parser, checks for invalid/overlapping
cues and timestamps beyond the sample, and updates the working JSON. Review and
correct ASR mistakes before publishing; update the caption provenance notice when
replacing the reference-derived transcript. Keep any temporary Whisper outputs in
ignored `demo/.whisper/` if you want them inside the project.

To restore the reference cue data:

```powershell
node scripts/import-demo-srt.mjs
```

## Keeping it representative

- Reuse production components; do not maintain a second reader implementation.
- Update fixtures when the reader's API contracts change.
- Test under a non-root base path to catch broken Pages assets.
- Label prepared responses and show the boundaries of the static sample.
- Keep the demo small; a full backend emulator would create another product to maintain.
