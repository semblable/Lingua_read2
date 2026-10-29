# Vocabulary export

In **My Terms**, select a language, choose an export format, then use **Export
Filtered** for the checked statuses or **Export All for Language** to ignore
status filters. Exports cover every matching term across all pages. The search
box and current page do not limit the download. All-for-language also includes
untracked (status 0) rows; use checked status filters to limit the export to
the vocabulary you want to study. Only the signed-in user's words,
mined sentences, and owned live source metadata are included.

## Simple CSV: existing import/export

The default remains `Term,Translation,Status,Language` at
`GET /api/words/export`. Existing CSV import is unchanged. Use this format for the
existing term import workflow; context/source fields are not restored by that
importer. The legacy simple format preserves exact field values and does not add
spreadsheet protection markers. Use Context CSV when opening untrusted vocabulary
in a spreadsheet.

## Context CSV

`GET /api/words/export?format=context&languageId=2&status=1,2,3`

The first four columns keep their familiar meanings; the additional columns are:

| Column | Meaning |
| --- | --- |
| WordId, LanguageId | Source installation's identifiers |
| ContextId, Context | Mined sentence identifier and original text |
| TextId, TextTitle | Owned source text and saved title (fallback to its live title) |
| BookId, BookTitle | Owned live source book, when the text belongs to one |
| SourceUrl | Original article URL, when available; exported as text |
| ContextCreatedAtUtc | When the sentence was mined, in ISO 8601 |

There is **one row per mined context**, with the word/translation repeated. A term
with three contexts has three rows; a term without context has one row with empty
context/source cells. Multiple phrases with identical text remain distinct by
ContextId. Deleting a source can remove its live identifiers/book metadata; the
saved sentence and saved text title remain when present. A text-word link alone
does not invent a mined sentence.

Files use UTF-8, CSV quoting, doubled double quotes, and CRLF record separators.
Unicode and embedded line breaks are preserved inside fields. Missing values are
empty cells. Text cells beginning with a formula marker (`=`, `+`, `-`, `@`, or
their full-width variants), including after leading whitespace, and cells starting
with a tab/newline are prefixed with a literal apostrophe. This intentionally
changes their spreadsheet representation; remove that one protection marker only
when treating the value as plain text in another tool. CSV quoting alone does not
make a formula safe. This file is for portability and inspection, not a database
backup or a context-restore format.

## One-way Anki notes

`GET /api/words/export?format=anki` uses the same language/status query filters.
The UTF-8 `.txt` file is tab-separated with Anki file headers, HTML enabled, and
six columns. It contains **one note per word**, grouping all that word's contexts
in its Contexts field. Context-free terms are retained. It does not export media,
FSRS state, review history, or schedules. Anki creates and schedules its own cards.
There is no synchronization back to LinguaRead.

1. In Anki, create a note type named **LinguaRead Context**. Add these fields in
   this exact order: `LinguaReadId`, `Term`, `Translation`, `Language`, `Status`,
   `Contexts`. Keep LinguaReadId first for duplicate matching; it can stay hidden
   on the card.
2. Example front template:

   ```html
   {{Term}}<br><small>{{Language}}</small>
   ```

   Example back template:

   ```html
   {{FrontSide}}<hr id=answer>{{Translation}}<hr>{{Contexts}}
   ```

3. Use **File → Import**, select the `.txt`, and confirm Tab separation, HTML
   enabled, the six fields mapped in order, and the intended deck/note type.
   Preview before importing. The file headers supply these format hints.
4. On subsequent imports, choose **update existing notes** with note-type match
   scope. The stable first field identifies the source user/WordId; it is not
   Anki's internal GUID. All contexts update together, so repeated terms do not
   overwrite each other's sentences. A filtered export does not delete omitted
   Anki notes. Updates may replace edits made to those imported fields in Anki.

Identifiers are local to a LinguaRead installation. If combining independent
installations (whose default account and numeric IDs may match), use a separate
Anki note type for each installation. Restoring the same library retains its IDs.
Changing/deleting terms and importing again is not a two-way merge protocol.

All user content is HTML-escaped; tabs and line breaks inside fields are encoded
as text/line breaks, and source URLs are plain text rather than active links.
This preserves literal markup without executing it. See the official
[Anki text-import manual](https://docs.ankiweb.net/importing/text-files.html) for
file headers, field mapping, HTML, and duplicate matching.

Verified using Anki 26.9.3's real backend text importer and a disposable collection;
the Anki desktop import dialog and AnkiMobile/AnkiDroid were not exercised.
