"""Extract the pinned KRDICT mirror's Hangul headwords; no definitions or media.

Run with Python 3 and curl on PATH. The resulting data is CC BY-SA 2.0 KR;
see THIRD_PARTY_NOTICES.md. Downloads stay in the OS temporary directory.
"""
import concurrent.futures
import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
import unicodedata
import html

REVISION = "e7249562dca526461a347eb2cc5a2e67a17c4488"
ROOT = Path(__file__).resolve().parents[1]


def extract(number):
    with tempfile.TemporaryDirectory(prefix="linguaread-krdict-") as temporary:
        path = Path(temporary) / f"{number}.xml"
        subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location",
                        "--retry", "3", "--output", str(path),
                        f"https://raw.githubusercontent.com/spellcheck-ko/korean-dict-nikl-krdict/{REVISION}/{number}.xml"], check=True)
        words = set()
        # The upstream export has malformed XML in some definitions. Read only
        # the narrowly delimited Lemma tags, ignoring unrelated definition data.
        for lemma in re.findall(r"<Lemma>(.*?)</Lemma>", path.read_text(encoding="utf-8"), re.S):
            match = re.search(r'<feat\s+att="writtenForm"\s+val="([^"]*)"', lemma)
            if match:
                word = unicodedata.normalize("NFC", html.unescape(match[1]))
                # Punctuation-marked affixes and phrases aren't eojeol lemmas.
                if re.fullmatch(r"[가-힣]+", word):
                    words.add(word)
        return words


if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        words = set().union(*pool.map(extract, [*range(5000, 50001, 5000), 51947]))
    content = ("\n".join(sorted(words)) + "\n").encode("utf-8")
    for relative in ["resources/krdict_lemmas.txt",
                     "client/lingua-read-client/src/resources/krdict_lemmas.txt",
                     "server/LinguaReadApi/Resources/Korean/krdict_lemmas.txt"]:
        destination = ROOT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    print(f"{len(words)} headwords; SHA-256 {hashlib.sha256(content).hexdigest()}")
