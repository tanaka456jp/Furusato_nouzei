"""Read-only offline prepublication check; never signs, approves or publishes."""
import argparse
import hashlib
import io
import json
import re
import sys
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from record_ci_acceptance import JOBS
from release_candidate_branding import verify_workbook_labels, verify_release_readme
from release_readiness import PRODUCT_SCOPE, REQUIRED, SCHEMA, evaluate, parse_evidence_json

HEAD_RE = re.compile(r"[0-9a-f]{40}\Z")
HASH_RE = re.compile(r"[0-9a-f]{64}\Z")
VERSION_RE = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+\Z")
MEMBERS = {"Furusato_nouzei.xlsm", "FurusatoDocumentReader.exe", "README.txt"}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _require(condition, reason):
    if not condition:
        raise ValueError(reason)


def verify(head, run_id, version, archive, expected_hash, ci, manifest, signature, *, preprint_only=False):
    """Check publicly safe metadata plus actual signed-package bytes; always HOLD.

    Signing changes EXE/XLSM hashes: the unsigned CI-review member digests
    must NEVER be falsely compared with the finally signed member digests.
    Human-controlled source-lineage and Office/VBE review remains necessary.
    """
    _require(isinstance(head, str) and HEAD_RE.fullmatch(head), "INVALID_SOURCE_HEAD")
    _require(type(run_id) is int and run_id > 0, "INVALID_CI_RUN_ID")
    _require(isinstance(version, str) and VERSION_RE.fullmatch(version) and
             version != "v4.18.2", "INVALID_NEXT_RELEASE_VERSION")
    _require(isinstance(expected_hash, str) and HASH_RE.fullmatch(expected_hash) and
             expected_hash != "0" * 64, "INVALID_INDEPENDENT_ARCHIVE_HASH")
    archive = Path(archive)
    _require(archive.is_file() and 0 < archive.stat().st_size <= 150_000_000,
             "INVALID_RELEASE_ARCHIVE")
    actual_hash = sha256(archive)
    _require(actual_hash == expected_hash, "INDEPENDENT_ARCHIVE_SHA256_MISMATCH")
    try:
        with ZipFile(archive) as z:
            infos = z.infolist()
            _require(len(infos) == 3 and {info.filename for info in infos} == MEMBERS and
                     all(not info.is_dir() and 0 < info.file_size <= 125_000_000
                         and ((info.external_attr >> 16) & 0o170000) != 0o120000
                         for info in infos) and
                     sum(info.file_size for info in infos) <= 150_000_000,
                     "INVALID_RELEASE_ZIP_ENTRIES")
            _require(z.testzip() is None, "RELEASE_ZIP_CRC_FAILURE")
            reader_sha = hashlib.sha256(z.read("FurusatoDocumentReader.exe")).hexdigest()
            workbook_sha = hashlib.sha256(z.read("Furusato_nouzei.xlsm")).hexdigest()
            workbook_bytes = z.read("Furusato_nouzei.xlsm")
            readme = z.read("README.txt")
            _require(version.encode("ascii") in readme and
                     b"NOT FOR PUBLIC DISTRIBUTION" not in readme and
                     "正式配布HOLD".encode("utf-8") not in readme and
                     "v4.18.2".encode("utf-8") not in readme,
                     "REVIEW_OR_WRONG_VERSION_README")
            verify_workbook_labels(workbook_bytes, version)
            verify_release_readme(readme, version, head)
    except BadZipFile as exc:
        raise ValueError("INVALID_RELEASE_ZIP_FORMAT") from exc

    _require(isinstance(ci, dict) and
             ci.get("schema") == "furusato-ci-acceptance/v1" and
             ci.get("head_sha") == head and ci.get("run_id") == run_id and
             ci.get("ci_exact_head_gate") == "PASS" and
             ci.get("review_only") is True and
             ci.get("release_decision") == "HOLD" and
             ci.get("prerequisite_jobs") == {key: "success" for key in JOBS} and
             all(isinstance(ci.get(key), str) and HASH_RE.fullmatch(ci[key])
                 for key in ("review_zip_sha256", "accepted_workbook_sha256",
                             "reader_sha256", "review_readme_sha256")),
             "CI_EXACT_SOURCE_PROVENANCE_INVALID")
    _require(isinstance(manifest, dict) and
             manifest.get("schema") == SCHEMA and
             manifest.get("head_sha") == head, "EXCEL_SCOPE_MANIFEST_INVALID")
    assessment = evaluate(head, manifest)
    paper_gate = "physical_printer_preview_and_output"
    paper_blocker = "MISSING_PHYSICAL_PRINTER_PREVIEW_AND_OUTPUT"
    if preprint_only:
        # Explicitly the ONLY missing gate is the not-yet-performed physical
        # A4 paper review. A failed or fabricated paper record is never waived.
        _require(assessment["product_scope"] == PRODUCT_SCOPE and
                 assessment["blockers"] == [paper_blocker] and
                 assessment["checks"][paper_gate] == "MISSING" and
                 all(value == "REVIEW_RECORDED_NOT_INDEPENDENTLY_VERIFIED"
                     for key, value in assessment["checks"].items()
                     if key != paper_gate),
                 "PREPRINT_REQUIRES_ALL_EIGHT_NONPHYSICAL_REVIEWS")
    else:
        _require(assessment["product_scope"] == PRODUCT_SCOPE and
                 not assessment["blockers"] and
                 len(assessment["checks"]) == len(REQUIRED) and
                 assessment["review_stage"] == "MANUAL_FINAL_AUDIT_REQUIRED",
                 "EXCEL_PRIVATE_REVIEWS_INCOMPLETE")
    # The Windows Office SIP/Authenticode verifier emits v2, not the old
    # v1 marker that explicitly *did not* validate signature cryptography.
    # Bind its asserted digests to the actual signed ZIP members, including
    # the VBA binary inside the signed XLSM. These checks validate evidence
    # consistency, NOT the provenance of a local report or human approval.
    signed_fields = {
        "schema", "archive_sha256", "signed_workbook_sha256",
        "signed_vba_project_sha256", "reader_exe_sha256",
        "reader_authenticode", "vba_certificate_thumbprint_verified",
        "macro_workbook_signature", "office_vba_signed_property",
        "timestamp_verified", "exact_release_members", "signature_gate",
    }
    _require(isinstance(signature, dict) and set(signature) == signed_fields and
             signature.get("schema") == "furusato-signed-distribution-local/v2" and
             signature.get("archive_sha256") == actual_hash and
             signature.get("signed_workbook_sha256") == workbook_sha and
             signature.get("reader_exe_sha256") == reader_sha and
             signature.get("reader_authenticode") == "VALID_TRUSTED_EXPECTED_SIGNER" and
             signature.get("vba_certificate_thumbprint_verified") is True and
             signature.get("macro_workbook_signature") ==
                 "OFFICE_SIP_CRYPTOGRAPHICALLY_VERIFIED" and
             signature.get("office_vba_signed_property") ==
                 "OFFICE_RECOGNIZED_SIGNED_PROJECT" and
             signature.get("timestamp_verified") is True and
             signature.get("exact_release_members") == "THREE_EXPECTED_FILES_ONLY" and
             signature.get("signature_gate") == "PASS",
             "SIGNED_ARCHIVE_LOCAL_EVIDENCE_INVALID")
    try:
        with ZipFile(io.BytesIO(workbook_bytes)) as signed_xlsm:
            parts = [p for p in signed_xlsm.infolist()
                     if p.filename.casefold() == "xl/vbaproject.bin"]
            _require(len(parts) == 1 and 1024 <= parts[0].file_size <= 30_000_000
                     and parts[0].compress_size > 0
                     and parts[0].file_size <= parts[0].compress_size * 1000,
                     "SIGNED_ARCHIVE_VBA_PROJECT_MISSING_OR_UNSAFE")
            vba_data = signed_xlsm.read(parts[0])
            _require(vba_data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")),
                     "SIGNED_ARCHIVE_VBA_PROJECT_NOT_OLE")
    except (BadZipFile, KeyError) as exc:
        raise ValueError("SIGNED_ARCHIVE_VBA_PROJECT_INVALID") from exc
    _require(isinstance(signature["signed_vba_project_sha256"], str) and
             HASH_RE.fullmatch(signature["signed_vba_project_sha256"]) and
             hashlib.sha256(vba_data).hexdigest() ==
                 signature["signed_vba_project_sha256"],
             "SIGNED_ARCHIVE_VBA_PROJECT_HASH_MISMATCH")
    return {
        "schema": "furusato-excel-candidate-prepublication/v1",
        "product_scope": PRODUCT_SCOPE,
        "source_head_sha": head,
        "ci_run_id": run_id,
        "version": version,
        "candidate_gate": ("EIGHT_NONPHYSICAL_GATES_RECORDED_PREPRINT_HOLD"
                           if preprint_only else "METADATA_AND_ARCHIVE_CHECKED"),
        "physical_paper_gate": "PENDING" if preprint_only else "RECORDED_NOT_VERIFIED",
        "candidate_archive_sha256": actual_hash,
        "candidate_workbook_sha256": workbook_sha,
        "candidate_reader_sha256": reader_sha,
        "ci_review_zip_sha256": ci["review_zip_sha256"],
        "ci_review_only_not_signed_payload": True,
        "private_review_records": len(REQUIRED) - int(preprint_only),
        "source_lineage_after_signing": "REQUIRES_HUMAN_REVIEW",
        "office_vba_signed_property": "OFFICE_RECOGNIZED_SIGNED_PROJECT",
        "office_vbe_signature": "LOCAL_SIP_CRYPTOGRAPHY_RECORDED_HUMAN_PROVENANCE_REVIEW_REQUIRED",
        "physical_tax_and_print_evidence": "REQUIRES_HUMAN_AUTHENTICITY_REVIEW",
        "release_authorization": "REQUIRES_EXPLICIT_FINAL_HUMAN_APPROVAL",
        "release_decision": "HOLD",
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--head", required=True)
    p.add_argument("--run-id", type=int, required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--archive", type=Path, required=True)
    p.add_argument("--expected-archive-sha256", required=True)
    p.add_argument("--ci-receipt", type=Path, required=True)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--signature-evidence", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--preprint-only", action="store_true",
                   help="Allow ONLY the physical print gate to remain missing; still HOLD")
    a = p.parse_args()
    try:
        root = Path(__file__).resolve().parents[1]
        output = a.output.resolve()
        _require(root not in output.parents and output != root,
                 "PRIVATE_RELEASE_EVIDENCE_MUST_STAY_OUTSIDE_REPOSITORY")
        _require(not a.output.exists(), "REFUSE_TO_OVERWRITE_CANDIDATE_EVIDENCE")
        def read(path):
            _require(path.is_file() and 0 < path.stat().st_size <= 512_000,
                     "INVALID_EVIDENCE_FILE_SIZE")
            return parse_evidence_json(path.read_text(encoding="utf-8-sig"))
        report = verify(a.head, a.run_id, a.version, a.archive,
                        a.expected_archive_sha256, read(a.ci_receipt),
                        read(a.manifest), read(a.signature_evidence),
                        preprint_only=a.preprint_only)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf-8") as result:
            json.dump(report, result, ensure_ascii=False, indent=2)
            result.write("\n")
        print("CANDIDATE_METADATA_AND_ARCHIVE_CHECKED_RELEASE_HOLD")
        return 0
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print("CANDIDATE_REJECTED=" + (
            str(error) if isinstance(error, ValueError) else "PRIVATE_LOCAL_IO_OR_JSON_ERROR"))
        return 2



def verify_distribution(archive, head, version, book_sha, reader_sha, signing_state, signing_evidence):
    """Verify the canonical distribution and return only publishable digest fields."""
    from package_ready_to_use_review import verify_distribution_archive

    report = verify_distribution_archive(
        archive, head_sha=head, version=version, accepted_workbook_sha256=book_sha,
        accepted_reader_sha256=reader_sha, signing_state=signing_state, signing_evidence=signing_evidence)
    return {key: report[key] for key in (
        "archive_sha256", "workbook_sha256", "reader_sha256", "readme_sha256", "vba_project_sha256"
    )}


if __name__ == "__main__":
    sys.exit(main())
