"""Run against verification/compose.yml ONLY. Original synthetic text and tone.

No provider requests. Uses the standard library; does not print cookies or dumps.
The caller must start the dedicated stack on 127.0.0.1:18080 first.
"""
import io
import json
import struct
import time
import urllib.error
import urllib.request
import wave

BASE = "http://127.0.0.1:18080"
PASSWORD = "synthetic-learner-password"
cookie = ""


def request(path, body=None, method=None, content_type=None, expected=(200, 201)):
    if isinstance(body, dict):
        body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        content_type = "application/json"
    headers = {"X-Requested-With": "XMLHttpRequest"}
    if cookie:
        headers["Cookie"] = cookie
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    data = response.read()
    assert response.status in (expected if isinstance(expected, tuple) else (expected,)), (path, response.status, data[:500])
    result = json.loads(data) if "application/json" in response.headers.get("Content-Type", "") else data
    return result, response.headers


def multipart(path, fields, files):
    boundary = "linguaread-synthetic-boundary"
    data = bytearray()
    for name, value in fields.items():
        data.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for name, filename, mime, content in files:
        data.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode())
        data.extend(content)
        data.extend(b"\r\n")
    data.extend(f"--{boundary}--\r\n".encode())
    return request(path, bytes(data), content_type=f"multipart/form-data; boundary={boundary}")


def main():
    global cookie
    for attempt in range(40):
        try:
            status, _ = request("/api/auth/status")
            break
        except (OSError, AssertionError):
            if attempt == 39:
                raise
            time.sleep(1)
    if status["needsSetup"]:
        request("/api/auth/setup", {"password": PASSWORD}, expected=403)
        _, headers = request("/api/auth/setup", {"password": PASSWORD, "setupToken": "synthetic-operator-token"})
    else:
        _, headers = request("/api/auth/login", {"password": PASSWORD})
    cookie = headers["Set-Cookie"].split(";")[0]
    assert request("/api/auth/status")[0]["authenticated"]
    languages, _ = request("/api/languages")
    language_id = next(item["languageId"] for item in languages if item["name"] == "Spanish")
    sentence = 'El gato mira la luna. Una amiga dice: "¡Hola, gato!"'
    book, _ = multipart("/api/books/upload", {"LanguageId": language_id, "TitleOverride": "Synthetic first session", "SplitMethod": "paragraph", "MaxSegmentSize": 3000},
        [("File", "fixture.txt", "text/plain", sentence.encode("utf-8"))])
    book_id = book["bookId"]
    details, _ = request(f"/api/books/{book_id}")
    text_id = details["parts"][0]["textId"]
    word, _ = request("/api/words", {"textId": text_id, "term": "gato", "translation": "cat", "status": 2})
    word_id = word["wordId"]
    request("/api/words", {"textId": text_id, "term": "la luna", "translation": "the moon", "status": 1})
    request("/api/srs/mine", {"wordId": word_id, "sentence": sentence, "textId": text_id, "textTitle": "Synthetic first session"})
    cards, _ = request(f"/api/srs/due?languageId={language_id}")
    card = next(item for item in cards if item["wordId"] == word_id)
    event = {"srsCardReviewId": card["srsCardReviewId"], "grade": 2, "clientEventId": f"fixture-{book_id}"}
    result, _ = request("/api/srs/review", event)
    assert result["stability"] > 0 and result["difficulty"] > 0, result
    replay, _ = request("/api/srs/review", event)
    assert result["srsReviewLogId"] == replay["srsReviewLogId"]
    # New request after reload; the database, not a demo/mock, retains the grade.
    assert request("/api/srs/last-review")[0]["srsReviewLogId"] == result["srsReviewLogId"]
    missing, _ = request("/api/translation", {"text": "gato", "sourceLanguageCode": "ES", "targetLanguageCode": "EN"}, expected=400)
    assert "not configured" in missing["message"]
    wav = io.BytesIO()
    with wave.open(wav, "wb") as audio:
        audio.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        audio.writeframes(struct.pack("<h", 0) * 24000)
    lesson, _ = multipart("/api/texts/audio", {"Title": "Synthetic audio cues", "LanguageId": language_id}, [
        ("AudioFile", "fixture.wav", "audio/wav", wav.getvalue()),
        ("SrtFile", "fixture.srt", "text/plain", b"1\n00:00:00,000 --> 00:00:01,400\nEl gato mira la luna.\n\n2\n00:00:01,400 --> 00:00:03,000\nHola, amiga.\n")])
    print(json.dumps({"bookId": book_id, "textId": text_id, "audioTextId": lesson["textId"], "wordId": word_id,
        "cardId": card["srsCardReviewId"], "fsrsStability": result["stability"], "replayDeduplicated": True}, indent=2))


if __name__ == "__main__":
    main()
