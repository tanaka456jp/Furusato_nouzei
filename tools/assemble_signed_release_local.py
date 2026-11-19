"""Assemble a private, locally signed Excel ZIP for INDEPENDENT review only.

Inputs must be accepted CI binaries and separately signed local copies. Signing
evidence is cross-checked against real bytes but is NOT itself a trust anchor.
Always run verify_signed_release_local.ps1 against the completed archive and
complete independent tax, print, display and publisher review before release.
No signing, GitHub API access, certificate import, or publication occurs here.
"""
import argparse
import hashlib
import io
import json
import re
import stat
import struct
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from make_excel_release_readme import render
from package_ready_to_use_review import _verify_xlsm
from release_candidate_branding import verify_release_readme, verify_workbook_labels
from release_readiness import VERSION, parse_evidence_json

MEMBERS = ("Furusato_nouzei.xlsm", "FurusatoDocumentReader.exe", "README.txt")
SHA_RE = re.compile(r"[0-9a-f]{64}\Z")
HEAD_RE = re.compile(r"[0-9a-f]{40}\Z")
VBA_FIELDS = frozenset({
    "schema", "head_sha", "signing_state", "availability",
    "source_workbook_sha256", "signed_workbook_sha256",
    "accepted_vba_project_sha256", "signed_vba_project_sha256",
    "signing_certificate_eku", "certificate_thumbprint_matched",
    "office_vba_signed_property", "signtool_verified",
    "certificate_chain_verified", "timestamp_verified", "test_only",
    "release_approved",
})
READER_FIELDS = frozenset({
    "schema", "signing_state", "source_exe_sha256", "signed_exe_sha256",
    "signer_certificate_verified", "signer_chain_verified",
    "timestamp_verified", "release_approved",
})


def require(condition, code):
    if not condition:
        raise ValueError(code)


def file_sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as src:
        for data in iter(lambda: src.read(1024 * 1024), b""):
            h.update(data)
    return h.hexdigest()


def read_private_json(path):
    require(path.is_file() and not path.is_symlink() and
            0 < path.stat().st_size <= 32_768, "SIGNING_EVIDENCE_FILE_INVALID")
    return parse_evidence_json(path.read_text(encoding="utf-8-sig"))


def project_sha(workbook_bytes):
    with ZipFile(io.BytesIO(workbook_bytes)) as z:
        items = [x for x in z.infolist()
                 if x.filename.casefold() == "xl/vbaproject.bin"]
        require(len(items) == 1 and 1024 <= items[0].file_size <= 30_000_000
                and items[0].compress_size > 0
                and items[0].file_size <= items[0].compress_size * 1000,
                "VBA_PROJECT_MISSING_OR_UNSAFE")
        project = z.read(items[0])
    require(project.startswith(bytes.fromhex("D0CF11E0A1B11AE1")),
            "VBA_PROJECT_NOT_OLE")
    return hashlib.sha256(project).hexdigest()


def verify_pe(path):
    with path.open("rb") as file:
        header = file.read(64)
        require(len(header) == 64 and header[:2] == b"MZ", "SIGNED_READER_NOT_PE")
        offset = struct.unpack_from("<I", header, 0x3c)[0]
        require(64 <= offset <= 65_536 and offset + 4 <= path.stat().st_size,
                "SIGNED_READER_NOT_PE")
        file.seek(offset)
        require(file.read(4) == b"PE\0\0", "SIGNED_READER_NOT_PE")


def assemble(*, head, run_id, version, accepted_book, signed_book,
             accepted_reader, signed_reader, vba_evidence, reader_evidence,
             target, receipt, accepted_book_sha, accepted_reader_sha):
    inputs = [Path(x) for x in (accepted_book, signed_book, accepted_reader,
                                signed_reader, vba_evidence, reader_evidence)]
    target, receipt = Path(target), Path(receipt)
    repo = Path(__file__).resolve().parents[1]
    require(isinstance(head, str) and HEAD_RE.fullmatch(head)
            and type(run_id) is int and run_id > 0 and version == VERSION,
            "SIGNED_ASSEMBLY_IDENTITY_INVALID")
    require(all(isinstance(sha, str) and SHA_RE.fullmatch(sha)
                for sha in (accepted_book_sha, accepted_reader_sha)),
            "SIGNED_ASSEMBLY_SOURCE_DIGEST_INVALID")
    require(len({x.resolve() for x in inputs + [target, receipt]}) == 8,
            "SIGNED_ASSEMBLY_PATH_COLLISION")
    require(all(x.is_file() and not x.is_symlink() for x in inputs)
            and not target.exists() and not receipt.exists(),
            "SIGNED_ASSEMBLY_INPUT_OR_OUTPUT_INVALID")
    require(all(not (p.resolve() == repo or repo in p.resolve().parents)
                for p in (target, receipt, Path(vba_evidence), Path(reader_evidence))),
            "SIGNED_ASSEMBLY_PRIVATE_EVIDENCE_REQUIRED")
    require(target.parent.is_dir() and receipt.parent.is_dir(),
            "SIGNED_ASSEMBLY_OUTPUT_PARENT_INVALID")
    sizes = [(100_000, 100_000_000), (100_000, 100_000_000),
             (10_000, 120_000_000), (10_000, 120_000_000)]
    require(all(lower <= p.stat().st_size <= upper
                for p, (lower, upper) in zip(inputs[:4], sizes)),
            "SIGNED_ASSEMBLY_INPUT_SIZE_INVALID")
    require(file_sha(accepted_book) == accepted_book_sha
            and file_sha(accepted_reader) == accepted_reader_sha,
            "SIGNED_ASSEMBLY_UNACCEPTED_CI_SOURCES")
    unsigned_book_sha, final_book_sha = file_sha(accepted_book), file_sha(signed_book)
    unsigned_reader_sha, final_reader_sha = file_sha(accepted_reader), file_sha(signed_reader)
    require(unsigned_book_sha != final_book_sha
            and unsigned_reader_sha != final_reader_sha,
            "SIGNED_ASSEMBLY_SOURCE_AND_SIGNED_IDENTICAL")
    vba = read_private_json(Path(vba_evidence))
    reader = read_private_json(Path(reader_evidence))
    require(type(vba) is dict and set(vba) == VBA_FIELDS and
            vba.get("schema") == "furusato-local-vba-signing/v2"
            and vba.get("head_sha") == head
            and vba.get("signing_state") == "SIGNED"
            and vba.get("availability") == "AVAILABLE"
            and vba.get("source_workbook_sha256") == unsigned_book_sha
            and vba.get("signed_workbook_sha256") == final_book_sha
            and vba.get("accepted_vba_project_sha256") == vba.get("signed_vba_project_sha256")
            and vba.get("signing_certificate_eku") == "CODE_SIGNING"
            and vba.get("office_vba_signed_property") == "OFFICE_RECOGNIZED_SIGNED_PROJECT"
            and vba.get("test_only") is False and vba.get("release_approved") is False
            and all(vba.get(key) is True for key in (
                "certificate_thumbprint_matched", "signtool_verified",
                "certificate_chain_verified", "timestamp_verified")),
            "SIGNED_ASSEMBLY_VBA_EVIDENCE_INVALID")
    require(type(reader) is dict and set(reader) == READER_FIELDS
            and reader.get("schema") == "furusato-reader-authenticode-local/v1"
            and reader.get("signing_state") == "SIGNED"
            and reader.get("source_exe_sha256") == unsigned_reader_sha
            and reader.get("signed_exe_sha256") == final_reader_sha
            and reader.get("release_approved") is False
            and all(reader.get(key) is True for key in (
                "signer_certificate_verified", "signer_chain_verified",
                "timestamp_verified")),
            "SIGNED_ASSEMBLY_READER_EVIDENCE_INVALID")
    source_book_bytes = Path(accepted_book).read_bytes()
    final_book_bytes = Path(signed_book).read_bytes()
    original_project = project_sha(source_book_bytes)
    final_project = project_sha(final_book_bytes)
    require(original_project == final_project ==
            vba["accepted_vba_project_sha256"],
            "SIGNED_ASSEMBLY_VBA_PROJECT_CHANGED")
    verify_workbook_labels(final_book_bytes, version)
    require(_verify_xlsm(final_book_bytes, version, "SIGNED", final_project) == final_project,
            "SIGNED_ASSEMBLY_VBA_SIGNATURE_STRUCTURE_INVALID")
    verify_pe(Path(accepted_reader))
    verify_pe(Path(signed_reader))
    readme = render(version, head)
    verify_release_readme(readme, version, head)
    require(sum(p.stat().st_size for p in inputs[:4][1::2]) + len(readme) <= 150_000_000,
            "SIGNED_ASSEMBLY_OUTPUT_OVERSIZED")
    written = False
    try:
        with target.open("xb") as dest:
            written = True
            with ZipFile(dest, "w") as zip_out:
                for data, name in ((final_book_bytes, MEMBERS[0]),
                                   (Path(signed_reader).read_bytes(), MEMBERS[1]),
                                   (readme, MEMBERS[2])):
                    info = ZipInfo(name)
                    info.compress_type = ZIP_DEFLATED
                    info.external_attr = (stat.S_IFREG | 0o644) << 16
                    zip_out.writestr(info, data)
        with ZipFile(target) as final:
            require(final.namelist() == list(MEMBERS) and final.testzip() is None,
                    "SIGNED_ASSEMBLY_ZIP_STRUCTURE_INVALID")
            require(hashlib.sha256(final.read(MEMBERS[0])).hexdigest() == final_book_sha
                    and hashlib.sha256(final.read(MEMBERS[1])).hexdigest() == final_reader_sha
                    and final.read(MEMBERS[2]) == readme,
                    "SIGNED_ASSEMBLY_ZIP_MEMBER_CHANGED")
        require(file_sha(accepted_book) == unsigned_book_sha
                and file_sha(signed_book) == final_book_sha
                and file_sha(accepted_reader) == unsigned_reader_sha
                and file_sha(signed_reader) == final_reader_sha,
                "SIGNED_ASSEMBLY_INPUT_CHANGED")
        record = {
            "schema": "furusato-private-signed-assembly/v1",
            "source_head_sha": head, "ci_run_id": run_id, "version": version,
            "accepted_unsigned_workbook_sha256": unsigned_book_sha,
            "accepted_unsigned_reader_sha256": unsigned_reader_sha,
            "signed_workbook_sha256": final_book_sha,
            "signed_reader_sha256": final_reader_sha,
            "vba_project_sha256": final_project,
            "signed_zip_sha256": file_sha(target),
            "readme_sha256": hashlib.sha256(readme).hexdigest(),
            "local_crypto_signature_reverification": "REQUIRED",
            "independent_tax_print_display_and_publisher_review": "REQUIRED",
            "release_decision": "HOLD",
        }
        with receipt.open("x", encoding="utf-8") as output:
            json.dump(record, output, ensure_ascii=False, indent=2)
            output.write("\n")
        return record
    except BaseException:
        if written:
            target.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--head", required=True)
    parser.add_argument("--run-id", required=True, type=int)
    parser.add_argument("--version", required=True)
    for key in ("accepted-book", "signed-book", "accepted-reader", "signed-reader",
                "vba-evidence", "reader-evidence", "target", "receipt"):
        parser.add_argument("--" + key, required=True, type=Path)
    parser.add_argument("--accepted-book-sha", required=True)
    parser.add_argument("--accepted-reader-sha", required=True)
    a = parser.parse_args()
    try:
        assemble(head=a.head, run_id=a.run_id, version=a.version,
                 accepted_book=a.accepted_book, signed_book=a.signed_book,
                 accepted_reader=a.accepted_reader, signed_reader=a.signed_reader,
                 vba_evidence=a.vba_evidence, reader_evidence=a.reader_evidence,
                 target=a.target, receipt=a.receipt,
                 accepted_book_sha=a.accepted_book_sha,
                 accepted_reader_sha=a.accepted_reader_sha)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print("SIGNED_ASSEMBLY_REFUSED=" +
              (str(exc) if isinstance(exc, ValueError) else "PRIVATE_INPUT_OR_ZIP_ERROR"))
        return 2
    print("SIGNED_LOCAL_ZIP_ASSEMBLED_CRYPTO_REVERIFICATION_REQUIRED_RELEASE_HOLD")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
