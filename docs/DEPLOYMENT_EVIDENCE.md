# Personal deployment and mobile evidence

Status: **measurement pending**. The maintainer reports acceptable personal use
on an Oracle Cloud free-tier micro instance with swap enabled and solid mobile
performance for their own workflow. Instance specifications and representative
measurements have not yet been recorded here. This is not a capacity benchmark
or a claim about concurrent users.

Copy the record below for each actual test. Publish only sanitized observations;
keep hostnames, IP addresses, credentials, library contents, and raw system logs
private. Use an original/public-domain EPUB and distributable audio if publishing
fixtures. Do not benchmark by importing private production data into this repo.

## Environment record

| Field | Recorded value |
| --- | --- |
| Test date and tester | Pending |
| App commit and immutable image tags | Pending |
| Instance model / CPU architecture / vCPUs | Pending |
| RAM / disk type, size, free space | Pending |
| OS / kernel / Docker / Compose versions | Pending |
| Swap size and configuration / swappiness | Pending |
| PostgreSQL shared_buffers / effective_cache_size | Pending |
| Container memory and memory+swap limits | Pending |
| Build performed on host or prebuilt images | Pending |
| Concurrent users and background jobs | Pending |

The Compose defaults tune PostgreSQL for roughly 4 GB hosts. That is a configuration
default, not a measured minimum requirement. Record any overrides used on a smaller
machine, including `POSTGRES_SHARED_BUFFERS`, `POSTGRES_EFFECTIVE_CACHE_SIZE`, and
`API_MEMSWAP_LIMIT` when the production overlay is used. Do not invent values for
the existing small installation.

On the Linux host, these read-only commands can help collect a private record:

```sh
uname -m
lscpu
free -m
swapon --show --bytes
sysctl vm.swappiness
df -h
docker version --format '{{.Server.Version}}'
docker compose version
git rev-parse HEAD
docker compose stats --no-stream
```

Run `docker compose stats` and `vmstat 1` in separate terminals during an import or
playback session, stopping with Ctrl+C. Record sampling interval and observed
peaks; sampled peaks can miss short spikes. `effective_cache_size` is a planner
hint, not allocated memory. Avoid publishing `docker inspect`, environment dumps,
or full Compose config output because they can include secrets.

## Representative workflow record

| Scenario | Inputs and method | Result |
| --- | --- | --- |
| Idle after startup | Wait duration; container/host memory, swap used, CPU | Pending |
| Import one EPUB | Rights/source, bytes, word/chapter count; elapsed time; sampled peak memory/swap; errors | Pending |
| Open/interact with lesson | Words/characters, warm/cold cache, device/browser, measured timing or clearly labeled subjective observation | Pending |
| Play and seek audio | Rights/source, bytes/duration/codec, network, device/browser, buffering/seeking observations | Pending |
| Restore isolated backup | App/DB versions, database+media+keys restored, volume/port isolation, integrations disabled, verification steps | Pending |

Report failures and stalls as well as successful results. A suitable resulting
claim is: “This setup works for my personal library and these recorded tasks.”
Swap is part of the configuration and may affect responsiveness.

## Browser checks at phone-sized viewports

Completed on 2026-10-28 against the locally built production static demo at the
project base `/Lingua_read2/`, using desktop Chromium in the in-app browser.
The checkout was based on `f01e2745` with local release-preparation changes.
The tool changed viewport dimensions; it did not run a mobile OS/browser engine,
inject real touch events, or measure a physical phone's performance.

| Requested viewport (CSS px) | Showcase | Spanish reader | English audio transcript |
| --- | --- | --- | --- |
| 320 × 568 | No horizontal overflow | No horizontal overflow | No horizontal overflow |
| 360 × 800 | No horizontal overflow | No horizontal overflow | No horizontal overflow |
| 390 × 844 | No horizontal overflow | No horizontal overflow | No horizontal overflow |
| 430 × 932 | No horizontal overflow | No horizontal overflow | No horizontal overflow |
| 844 × 390 (landscape) | No horizontal overflow | No horizontal overflow | No horizontal overflow |

The overflow check compared rendered document `scrollWidth` with `clientWidth`.
Desktop scrollbars consumed 15 pixels in most cases; this is browser layout
evidence, not a named phone certification or a guarantee about every element.

Interactions checked with browser mouse/click input:

- At 390 pixels, the embedded Spanish reader opened the word drawer, changed
  `río` from Learning to Known, and mined a sentence with the saved count changing
  to one. Phrase extension worked; an unsupported phrase returned the expected
  local prepared-response error.
- At 320 pixels, full-screen lookup and **+ Prev word** selected the prepared
  phrase `al río`, showed “to the river,” and saved it as New. Clicking outside
  dismissed the drawer. Lesson controls/menu opened and closed; sentence mode
  displayed the prepared sentence translation. Reset completed.
- At 390 pixels, audio loaded the bundled 36.43-second sample. Play/pause changed
  the actual media state; speed changed from 1.00× to 1.05×. Clicking transcript
  punctuation sought from 26 seconds to the first cue at zero; the +10-second
  control also advanced playback position. Direct hash-link reload loaded the
  reader and bundled audio again. Highlighting and layout were visually inspected.
- Portrait/landscape layouts were inspected, and the temporary viewport override
  was cleared after testing.

Evidence: [embedded reader screenshot](images/mobile-reader-check.jpg),
[audio screenshot](images/mobile-audio-check.jpg), and
[landscape screenshot](images/mobile-landscape-check.jpg).
See [screenshot provenance](images/README.md) for caption licensing.

Remaining: real touch selection/scroll conflicts, iOS Safari and Android browser
behavior, virtual keyboard and browser-chrome effects, background/lock-screen
audio, hardware/network performance, and the installed app's login/import/review/
offline workflow. Browser viewport checks do not complete those items.

## Physical-phone check

Run on an actual phone against the reviewed demo and, separately, the full app.
A narrow desktop viewport does not complete this gate.

- [ ] Record phone model, OS/browser versions, app commit/demo URL, and network.
- [ ] Portrait/landscape: navigation, text, tooltips, and controls remain reachable.
- [ ] Tap a word, change its status, select a phrase using touch, save a sentence.
- [ ] Close tooltips/settings; scroll without accidental selection or blocked controls.
- [ ] Play/pause audio, seek through cues, change playback speed, confirm highlighting.
- [ ] Reload/direct-link to both demo samples and reset temporary data.
- [ ] Full app: sign in, reopen a lesson, verify progress, review a card.
- [ ] Record any unsupported gestures or browser behavior explicitly.

Date, device, results, and limitations: **Pending physical-device testing**.
The browser portion above is complete; only device-dependent/full-app coverage
should be repeated on the actual phone.
