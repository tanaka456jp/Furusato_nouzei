"""Collect verbatim license texts from the Windows reader's pinned build environment."""

import argparse
import sys
from importlib.metadata import distribution
from pathlib import Path

RUNTIME_WHEELS = ("pypdfium2", "Pillow", "pytesseract", "packaging")
NOTICE_NAME = "THIRD_PARTY_NOTICES.txt"
NOTICE_LIMIT = 4_000_000


def license_text(path):
    raw = path.read_bytes()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252")


def build_notice(head, output):
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
    sections = [f"FurusatoDocumentReader.exe third-party notices\nSource HEAD: {head}\n",
                f"CPython {sys.version.split()[0]}\n\n" +
                license_text(python_license)]
    for name in RUNTIME_WHEELS:
        wheel = distribution(name)
        entries = sorted(
            part for part in (wheel.files or ())
            if any(segment.endswith(".dist-info") for segment in part.parts)
            and ("licenses" in part.parts or part.name.lower().startswith(
                ("license", "notice", "copying")))
        )
        if not entries or name == "pypdfium2" and not any("BUILD_LICENSES" in e.parts for e in entries):
            raise ValueError("READER_WHEEL_LICENSES_MISSING:" + name)
        sections.append(f"{name} {wheel.version}")
        for entry in entries:
            path = wheel.locate_file(entry)
            if path.is_file():
                relative = "/".join(entry.parts[1:])
                sections.append(f"--- {relative} ---\n" + license_text(path))
    payload = ("\n\n".join(sections) + "\n").encode("utf-8")
    if len(payload) > NOTICE_LIMIT:
        raise ValueError("READER_THIRD_PARTY_NOTICES_TOO_LARGE")
    with output.open("xb") as notice:
        notice.write(payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--head", required=True)
    parser.add_argument("--output", type=Path, required=True)
    a = parser.parse_args()
    build_notice(a.head, a.output)
    print("READER_THIRD_PARTY_NOTICES_WRITTEN")


if __name__ == "__main__":
    main()
