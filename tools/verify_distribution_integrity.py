"""Check the complete Windows review ZIP without executing its contents.

Only verifies file structure, CRC and SHA256. An unsigned ZIP/EXE is NOT
authorized for public release; the report is therefore unconditionally HOLD.
No uploaded taxpayer files are read or included in evidence.
"""
import argparse
import hashlib
import json
import re
import stat
import zipfile
from pathlib import Path

SCHEMA = "furusato-distribution-integrity/v1"
REQUIRED = frozenset({
    "Furusato_nouzei.xlsx",
    "START_SETUP.cmd",
    "setup.ps1",
    "TaxLawUpdater.bas",
    "README.txt",
    "FurusatoDocumentReader.exe",
})
MAX_PACKAGE_BYTES = 250 * 1024 * 1024
MAX_ENTRY_BYTES = 120 * 1024 * 1024


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inspect_package(path, expected_sha256=None):
    path = Path(path)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_PACKAGE_BYTES:
        raise ValueError("INVALID_PACKAGE_SIZE_OR_PATH")
    if expected_sha256 is not None and (
        not isinstance(expected_sha256, str) or
        re.fullmatch(r"[0-9a-f]{64}", expected_sha256) is None
    ):
        raise ValueError("INVALID_EXPECTED_SHA256")
    digest = sha256_file(path)
    if expected_sha256 is not None and digest != expected_sha256:
        raise ValueError("PACKAGE_SHA256_MISMATCH")
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [item.filename for item in entries]
        if len(entries) != len(REQUIRED) or len(set(names)) != len(names):
            raise ValueError("ZIP_MISSING_EXTRA_OR_DUPLICATE_ENTRY")
        if set(names) != REQUIRED:
            raise ValueError("ZIP_UNEXPECTED_FILE_SET")
        if any(
            item.is_dir() or item.flag_bits & 1 or
            stat.S_IFMT((item.external_attr >> 16) & 0xFFFF) == stat.S_IFLNK or
            item.file_size < 1 or item.file_size > MAX_ENTRY_BYTES or
            (item.compress_size == 0 and item.file_size > 0) or
            (item.compress_size > 0 and item.file_size > item.compress_size * 1000)
            for item in entries
        ):
            raise ValueError("ZIP_UNSAFE_ENTRY")
        if archive.testzip() is not None:
            raise ValueError("ZIP_CRC_INVALID")
        file_digests = {}
        for name in sorted(REQUIRED):
            member = archive.getinfo(name)
            digest_member = hashlib.sha256()
            size = 0
            with archive.open(member) as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    size += len(block)
                    digest_member.update(block)
            if size != member.file_size:
                raise ValueError("ZIP_EXTRACTED_SIZE_MISMATCH")
            file_digests[name] = digest_member.hexdigest()
    return {
        "schema": SCHEMA,
        "release_decision": "HOLD",
        "archive_integrity": "STRUCTURE_CRC_AND_SHA256_VERIFIED",
        "archive_sha256": digest,
        "member_sha256": file_digests,
        "authenticode": "NOT_VERIFIED_BY_THIS_TOOL",
        "operator_release_approval": "NOT_PROVIDED",
        "note": "Archive integrity is not code signing, human tax approval or authorization to distribute.",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--expected-sha256")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = inspect_package(args.package, args.expected_sha256)
    if args.output:
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
    print("DISTRIBUTION_INTEGRITY_CHECKED_RELEASE_HOLD")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
