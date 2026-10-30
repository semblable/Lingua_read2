# Third-party notices

LinguaRead's own code and original demo text use the [MIT license](LICENSE).
Third-party code, fonts, and media retain their own terms. This file identifies
copied/adapted code and bundled presentation assets; it is not an exhaustive
dependency inventory. npm/NuGet/container dependencies retain their upstream
licenses and notices; consult the lockfile, project files, and installed packages
when redistributing a build.

## FSRS port

The C# memory model, parameters, and review state machine in
`server/LinguaReadApi/Services/Srs/{FsrsAlgorithm,FsrsParameters,SrsScheduler}.cs`
adapt [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs), specifically
`fsrs/scheduler.py`. Golden vectors are generated using **py-fsrs 6.3.2** in
`server/LinguaReadApi.Tests/FsrsGoldenVectors/generate.py`.

Upstream: Copyright (c) 2022 Open Spaced Repetition, MIT.
The [full upstream notice](server/LinguaReadApi/ThirdPartyNotices/py-fsrs.txt)
is retained with the port and copied into server build/publish output. The
[versioned upstream license](https://github.com/open-spaced-repetition/py-fsrs/blob/v6.3.2/LICENSE)
was checked during release preparation. LinguaRead adapts ratings, day boundaries,
stored state, and fuzzing; it does not claim an unchanged upstream scheduler.

## Chinese dictionary

The opt-in `jieba-v1` segmenter uses the unmodified `extra_dict/dict.txt.big` from
[jieba](https://github.com/fxsjy/jieba), commit
`67fa2e36e72f69d9134b8a1037b83fbb070b9775`, under the MIT license (Sun Junyi).
The [full license](server/LinguaReadApi/Resources/Segmentation/LICENSE.jieba.txt)
is copied into server publish output and [browser notices](client/lingua-read-client/public/licenses/jieba.txt).
The pinned dictionary SHA-256 is `b16011275c42955ccd81fc1adecc93a59dbb7926af69d93fc95d4943d40f6aad`.
C#/TypeScript implementations use dictionary-frequency DAG scoring, without HMM or
script conversion; this is not a claim of full upstream behavior or native-reviewed quality.

## Self-hosted fonts and icons

The application imports fonts through Fontsource; the demo currently imports Inter
and Lora. The files are served locally. Full font copyright/license texts from the
installed packages are retained under
[`public/licenses`](client/lingua-read-client/public/licenses/).

| Asset | License | Upstream |
| --- | --- | --- |
| Inter | SIL OFL 1.1 | [Inter](https://github.com/rsms/inter) |
| Lora | SIL OFL 1.1 | [Lora](https://github.com/cyrealtype/Lora-Cyrillic) |
| Lato | SIL OFL 1.1 | [Lato](https://www.latofonts.com/) |
| Merriweather | SIL OFL 1.1 | [Merriweather](https://github.com/EbenSorkin/Merriweather4) |
| Open Sans | SIL OFL 1.1 | [Open Sans](https://github.com/googlefonts/opensans) |
| Atkinson Hyperlegible | SIL OFL 1.1 | [Braille Institute](https://www.brailleinstitute.org/freefont/) |
| Roboto Slab | Apache 2.0 (as supplied in the installed Fontsource package) | [Roboto Slab](https://github.com/googlefonts/robotoslab) |
| Bootstrap Icons | MIT, Copyright (c) 2019–2024 The Bootstrap Authors | [Bootstrap Icons](https://github.com/twbs/icons) |
| Bootstrap CSS | MIT, Copyright (c) 2011–2025 The Bootstrap Authors | [Bootstrap](https://github.com/twbs/bootstrap) |
| Language catalog flags (flag-icons 7.5.0, selected 4:3 SVGs) | MIT, Copyright (c) 2013 Panayiotis Lipiridis | [flag-icons](https://github.com/lipis/flag-icons/tree/v7.5.0) |

The application copies these notices through Vite's public directory; the demo
build emits the same `licenses/` directory. When upgrading a font/icon package,
refresh its corresponding text from the installed package and review changed
copyright and license terms. Font names reserved in those notices remain reserved.

The demo's `mark.svg` is an original simple text mark under MIT. Provenance of
legacy app icons (`favicon.ico`, `logo192.png`, `logo512.png`, and
`public/assets/img/favicon.png`) still needs maintainer confirmation before a
release; the presence of an asset in Git is not evidence of permission.

## Demonstration audio and captions

The English sample uses the human recording of *The North Wind and the Sun*,
contributed by P. Roach / International Phonetic Association to Wikimedia Commons.
The recording and MP3 transcode use **CC BY-SA 3.0**. Initial Commons captions and
derived cue JSON use **CC BY-SA 4.0**. They are not covered by MIT.

The [media attribution](client/lingua-read-client/demo/public/audio/ATTRIBUTION.txt)
retains exact source revisions, contributors, license URLs, changes, and source
checksum. It is shipped with the demo. Prepared Spanish glosses and explanations
are sample content, not live provider responses. User uploads and external
provider content are not distributed as project fixtures.
