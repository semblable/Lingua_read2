"""Exercise the live PostgreSQL export and Anki's real text importer.

Install anki==26.9.3 in a temporary directory first (see README). Uses only the
synthetic source project, never an existing Anki profile. Collections and output
files remain in a new temporary directory for inspection.
"""
import csv
import html
import io
import json
from pathlib import Path
import sys
import tempfile
from importlib.metadata import version
import smoke


def main():
    sys.path.insert(0, str(Path(tempfile.gettempdir()) / "linguaread-anki-verification"))
    from anki.collection import Collection
    from anki.import_export_pb2 import ImportCsvRequest, CsvMetadata

    _, headers = smoke.request("/api/auth/login", {"password": smoke.PASSWORD})
    smoke.cookie = headers["Set-Cookie"].split(";")[0]
    languages = smoke.request("/api/languages")[0]
    language = next(item for item in languages if item["name"] == "Spanish")
    language_id = language["languageId"]
    books = smoke.request("/api/books")[0]
    book = next(book for book in books if book["title"] == "Synthetic first session")
    text_id = smoke.request(f'/api/books/{book["bookId"]}')[0]["parts"][0]["textId"]
    term = 'niño, "sí"'
    word = smoke.request("/api/words", {"textId": text_id, "term": term, "translation": 'a child, "yes"\nsecond line', "status": 4})[0]
    empty = smoke.request("/api/words", {"textId": text_id, "term": "=1+1", "translation": "", "status": 4})[0]
    sentences = ['El niño dice: "sí, amiga".\nOtra línea.\rFinal.', '<script>fixture</script> & ñ\ttab']
    for sentence in sentences:
        smoke.request("/api/srs/mine", {"wordId": word["wordId"], "sentence": sentence, "textId": text_id, "textTitle": '=source, "ñ"'}, expected=(200, 409))
    suffix = f"?languageId={language_id}&status=4"
    raw = smoke.request("/api/words/export" + suffix + "&format=context")[0]
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8"), newline="")))
    target_rows = [row for row in rows if int(row["WordId"]) == word["wordId"]]
    assert {row["Context"] for row in target_rows} >= set(sentences)
    assert all(row["TextId"] == str(text_id) and row["BookId"] == str(book["bookId"]) for row in target_rows)
    assert all(row["TextTitle"] == "'=source, \"ñ\"" for row in target_rows)
    assert next(row for row in rows if int(row["WordId"]) == empty["wordId"])["Term"] == "'=1+1"
    assert next(row for row in rows if int(row["WordId"]) == empty["wordId"])["Context"] == ""
    assert all(row["Language"] == "Spanish" and row["Status"] == "4" for row in rows)
    output = Path(tempfile.mkdtemp(prefix="linguaread-synthetic-export-"))
    (output / "context.csv").write_bytes(raw)
    anki_path = output / "anki.txt"
    anki_path.write_bytes(smoke.request("/api/words/export" + suffix + "&format=anki")[0])
    col = Collection(str(output / "collection.anki2"))
    try:
        model = col.models.new("LinguaRead Context")
        fields = ["LinguaReadId", "Term", "Translation", "Language", "Status", "Contexts"]
        for field in fields:
            col.models.add_field(model, col.models.new_field(field))
        template = col.models.new_template("Vocabulary")
        template["qfmt"] = "{{Term}}<br>{{Language}}"
        template["afmt"] = "{{FrontSide}}<hr id=answer>{{Translation}}<hr>{{Contexts}}"
        col.models.add_template(model, template)
        col.models.add(model)
        metadata = col.get_csv_metadata(str(anki_path), None)
        assert metadata.is_html and metadata.delimiter == CsvMetadata.TAB
        assert list(metadata.column_labels) == fields
        assert metadata.global_notetype.id == model["id"]
        metadata.global_notetype.field_columns[:] = range(1, 7)
        metadata.dupe_resolution = CsvMetadata.UPDATE
        col.import_csv(ImportCsvRequest(path=str(anki_path), metadata=metadata))
        note_count = len({row["WordId"] for row in rows})
        assert col.note_count() == note_count
        notes = [col.get_note(note_id) for note_id in col.find_notes("")]
        note = next(note for note in notes if html.unescape(note["Term"]) == f"<span>{term}</span>")
        assert all(sentence.replace("\r", "<br>").replace("\n", "<br>").replace("\t", "&#9;") in html.unescape(note["Contexts"]).replace("\t", "&#9;") for sentence in sentences)
        assert "<script>" not in note["Contexts"]
        assert all(card.type == 0 for note in notes for card in note.cards())
        # Updating preserves identity and every context; no duplicate note is added.
        smoke.request(f'/api/words/{word["wordId"]}', {"status": 4, "translation": "updated translation"}, method="PUT", expected=204)
        anki_path.write_bytes(smoke.request("/api/words/export" + suffix + "&format=anki")[0])
        col.import_csv(ImportCsvRequest(path=str(anki_path), metadata=metadata))
        assert col.note_count() == note_count
        note = col.get_note(note.id)
        assert html.unescape(note["Translation"]) == "<span>updated translation</span>"
        assert all(sentence.splitlines()[0] in html.unescape(note["Contexts"]) for sentence in sentences)
        print(json.dumps({"ankiVersion": version("anki"), "notes": note_count, "contextRows": len(rows),
            "repeatImportPreservedIdentity": True, "newAnkiScheduling": True, "artifacts": str(output)}, indent=2))
    finally:
        col.close()


if __name__ == "__main__":
    main()
