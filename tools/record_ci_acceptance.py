"""Private-data-free CI acceptance receipt. Not legal tax or release approval.

This script executes only after all four prerequisite jobs succeed. It matches
the selected exact-head review ZIP to the packaged XLSM/reader/README checksums.
Never uses the taxpayer's actual source data. Always reports release HOLD.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import BadZipFile, ZipFile

JOBS = ("static", "windows_compat", "excel", "document_reader")
MEMBERS = (
    "Furusato_nouzei.xlsm",
    "FurusatoDocumentReader.exe",
    "README.txt",
    "NOT_FOR_PUBLIC_RELEASE.txt",
)
SHA = re.compile(r"[0-9a-f]{64}\Z")
HEAD = re.compile(r"[0-9a-f]{40}\Z")


def digest_file(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as reader:
        for chunk in iter(lambda: reader.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def digest_member(zipped, name):
    h = hashlib.sha256()
    with zipped.open(name) as reader:
        for chunk in iter(lambda: reader.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def evaluate(head_sha, run_id, jobs, review, archive):
    if not isinstance(head_sha, str) or not HEAD.fullmatch(head_sha):
        raise ValueError("INVALID_HEAD_SHA")
    if type(run_id) is not int or run_id <= 0:
        raise ValueError("INVALID_RUN_ID")
    if not isinstance(jobs, dict) or set(jobs) != set(JOBS) or any(
            jobs[key] != "success" for key in JOBS):
        raise ValueError("PREREQUISITE_CI_JOB_NOT_SUCCESS")
    if not isinstance(review, dict) or (
            review.get("schema") != "furusato-ready-to-use-review/v1"
            or review.get("head_sha") != head_sha
            or review.get("package_class") != "SYNTHETIC_CI_REVIEW_ONLY"
            or review.get("release_decision") != "HOLD"
            or review.get("signing_state") != "NOT_VERIFIED"):
        raise ValueError("REVIEW_EVIDENCE_PROVENANCE_INVALID")
    checksums = {
        "Furusato_nouzei.xlsm": review.get("accepted_workbook_sha256"),
        "FurusatoDocumentReader.exe": review.get("reader_sha256"),
        "README.txt": review.get("review_readme_sha256"),
    }
    reported_zip = review.get("ready_to_use_review_sha256")
    if any(not isinstance(value, str) or SHA.fullmatch(value) is None
           for value in (reported_zip, *checksums.values())):
        raise ValueError("INVALID_REVIEW_DIGEST")
    path = Path(archive)
    if not path.is_file() or not 0 < path.stat().st_size <= 120_000_000:
        raise ValueError("INVALID_REVIEW_ZIP_SIZE")
    actual_zip = digest_file(path)
    if actual_zip != reported_zip:
        raise ValueError("REVIEW_ZIP_SHA256_MISMATCH")
    try:
        with ZipFile(path) as zipped:
            info = zipped.infolist()
            if (len(info) != len(MEMBERS)
                    or set(item.filename for item in info) != set(MEMBERS)
                    or any(item.is_dir() or item.file_size > 120_000_000
                           for item in info)
                    or sum(item.file_size for item in info) > 150_000_000):
                raise ValueError("REVIEW_ZIP_MEMBERS_INVALID")
            if zipped.testzip() is not None:
                raise ValueError("REVIEW_ZIP_CRC_FAILURE")
            for member, expected in checksums.items():
                if digest_member(zipped, member) != expected:
                    raise ValueError("REVIEW_MEMBER_SHA256_MISMATCH")
            marker = zipped.read("NOT_FOR_PUBLIC_RELEASE.txt")
            if b"NOT FOR PUBLIC DISTRIBUTION" not in marker:
                raise ValueError("REVIEW_ZIP_MARKER_MISSING")
            readme = zipped.read("README.txt")
            if (not readme.startswith(
                    "# 次期版 ReadyToUse 実機検証用".encode("utf-8"))
                    or head_sha.encode("ascii") not in readme
                    or "正式配布HOLD".encode("utf-8") not in readme):
                raise ValueError("REVIEW_README_MISLEADING")
    except BadZipFile as error:
        raise ValueError("INVALID_REVIEW_ZIP_FORMAT") from error
    return {
        "schema": "furusato-ci-acceptance/v1",
        "head_sha": head_sha,
        "run_id": run_id,
        "prerequisite_jobs": dict(jobs),
        "ci_exact_head_gate": "PASS",
        "review_zip_sha256": actual_zip,
        "accepted_workbook_sha256": checksums["Furusato_nouzei.xlsm"],
        "reader_sha256": checksums["FurusatoDocumentReader.exe"],
        "review_readme_sha256": checksums["README.txt"],
        "review_only": True,
        "physical_and_tax_review": "NOT_VERIFIED",
        "macro_and_executable_signature": "NOT_VERIFIED",
        "release_decision": "HOLD",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--run-id", required=True, type=int)
    for key in JOBS:
        parser.add_argument("--" + key.replace("_", "-"), required=True)
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve() in (
            args.review.resolve(), args.archive.resolve()):
        raise ValueError("REFUSE_TO_OVERWRITE_CI_EVIDENCE")
    review = json.loads(args.review.read_text(encoding="utf-8-sig"))
    jobs = {key: getattr(args, key) for key in JOBS}
    outcome = evaluate(args.head_sha, args.run_id, jobs, review, args.archive)
    with args.output.open("x", encoding="utf-8") as result:
        json.dump(outcome, result, ensure_ascii=False, indent=2)
        result.write("\n")
    print("CI_EXACT_HEAD_REVIEW_GATE_PASS_RELEASE_HOLD")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
