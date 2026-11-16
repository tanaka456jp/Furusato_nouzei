"""Bundle two already-verified same-run CI artifacts for REVIEW ONLY.

This never builds new VBA, re-signs a binary, or authorizes a release. It
validates the Excel acceptance digest and preserves the generated XLSM bytes.
Customer/taxpayer documents must never be supplied as inputs.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

MARKER = (
    "REVIEW BUILD - NOT FOR PUBLIC DISTRIBUTION\n"
    "Unsigned / release gates incomplete. Never use this package as a formal release.\n"
)
EXPECTED_NAMES = {
    "Furusato_nouzei.xlsm",
    "FurusatoDocumentReader.exe",
    "README.txt",
    "NOT_FOR_PUBLIC_RELEASE.txt",
}
SCHEMA = "furusato-ready-to-use-review/v1"


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        for piece in iter(lambda: source.read(1024 * 1024), b""):
            h.update(piece)
    return h.hexdigest()


def package_review(book, reader, acceptance, guide, target, *, head_sha):
    paths = [Path(x) for x in (book, reader, acceptance, guide)]
    target = Path(target)
    if not isinstance(head_sha, str) or re.fullmatch(r"[0-9a-f]{40}", head_sha) is None:
        raise ValueError("INVALID_HEAD_SHA")
    if len({p.resolve() for p in paths + [target.resolve()]}) != 5:
        raise ValueError("INPUT_OUTPUT_PATH_COLLISION")
    if not all(p.is_file() for p in paths):
        raise ValueError("MISSING_ACCEPTANCE_ARTIFACT")
    if paths[0].name != "Furusato_nouzei.xlsm" or paths[1].name != "FurusatoDocumentReader.exe":
        raise ValueError("UNEXPECTED_BINARY_FILENAMES")
    if not 100000 <= paths[0].stat().st_size <= 100000000:
        raise ValueError("INVALID_REVIEW_WORKBOOK_SIZE")
    if not 10000 <= paths[1].stat().st_size <= 100000000:
        raise ValueError("INVALID_READER_EXE_SIZE")
    if paths[3].stat().st_size > 1024 * 1024:
        raise ValueError("OVERSIZED_USER_GUIDE")
    report = json.loads(paths[2].read_text(encoding="utf-8-sig"))
    if not isinstance(report, dict) or report.get("status") != "PASS":
        raise ValueError("EXCEL_ACCEPTANCE_NOT_PASSED")
    expected = report.get("workbook_sha256")
    if not isinstance(expected, str) or re.fullmatch(r"[0-9a-fA-F]{64}", expected) is None:
        raise ValueError("INVALID_EXCEL_ACCEPTANCE_CHECKSUM")
    workbook_sha = digest(paths[0])
    if expected.lower() != workbook_sha:
        raise ValueError("ACCEPTED_XLSM_SHA256_MISMATCH")
    if target.exists():
        raise ValueError("REFUSE_TO_OVERWRITE_REVIEW_ZIP")
    sources = {
        "Furusato_nouzei.xlsm": paths[0],
        "FurusatoDocumentReader.exe": paths[1],
        "README.txt": paths[3],
    }
    with ZipFile(target, "x", ZIP_DEFLATED) as zipped:
        for name, source in sources.items():
            zipped.write(source, name)
        zipped.writestr("NOT_FOR_PUBLIC_RELEASE.txt", MARKER)
    with ZipFile(target) as zipped:
        if set(zipped.namelist()) != EXPECTED_NAMES or zipped.testzip() is not None:
            raise ValueError("INVALID_REVIEW_ZIP")
        for name, source in sources.items():
            with zipped.open(name) as contents:
                extracted = hashlib.sha256()
                for chunk in iter(lambda: contents.read(1024 * 1024), b""):
                    extracted.update(chunk)
            if extracted.hexdigest() != digest(source):
                raise ValueError("REVIEW_ZIP_MEMBER_SHA256_MISMATCH")
    return {
        "schema": SCHEMA,
        "head_sha": head_sha,
        "release_decision": "HOLD",
        "package_class": "SYNTHETIC_CI_REVIEW_ONLY",
        "ready_to_use_review_sha256": digest(target),
        "accepted_workbook_sha256": workbook_sha,
        "reader_sha256": digest(paths[1]),
        "signing_state": "NOT_VERIFIED",
        "note": "Review only. Physical printer, legal tax cases, live GAS, signatures and release approval are not satisfied.",
    }


def main():
    ap = argparse.ArgumentParser()
    for name in ("book", "reader", "acceptance", "guide", "target", "evidence"):
        ap.add_argument("--" + name, required=True, type=Path)
    ap.add_argument("--head-sha", required=True)
    a = ap.parse_args()
    if a.evidence.exists():
        raise ValueError("REFUSE_TO_OVERWRITE_EVIDENCE")
    result = package_review(a.book, a.reader, a.acceptance, a.guide,
                            a.target, head_sha=a.head_sha)
    a.evidence.write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n",
                          encoding="utf-8")
    print("READY_TO_USE_REVIEW_CREATED_RELEASE_HOLD")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
