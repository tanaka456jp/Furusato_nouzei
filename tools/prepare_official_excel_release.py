"""Stage validated signed Excel release assets AFTER physical print review; never publish."""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

from verify_excel_release_candidate import verify
from release_readiness import PRODUCT_SCOPE, parse_evidence_json

PRINT_SCHEMA = "furusato-physical-paper-manual/v1"
PRINT_FIELDS = {
    "schema", "signed_candidate_archive_sha256", "printed_workbook_sha256",
    "tax_year", "expected_limit_yen", "observed_limit_yen",
    "physical_printer_confirmed", "one_page_a4_checked",
    "paper_physically_observed", "paper_readability_reviewed",
    "tax_amounts_cross_checked", "only_synthetic_data",
    "reviewer_role", "manual_human_review", "release_decision",
}

def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def read_private(path):
    path = Path(path)
    if not path.is_file() or not 0 < path.stat().st_size <= 512000:
        raise ValueError("INVALID_LOCAL_REVIEW_EVIDENCE")
    return parse_evidence_json(path.read_text(encoding="utf-8-sig"))

def check_paper(record, archive_sha, workbook_sha):
    if not isinstance(record, dict) or set(record) != PRINT_FIELDS:
        raise ValueError("PAPER_REVIEW_FIELDS_INVALID")
    if (record["schema"] != PRINT_SCHEMA or
            record["signed_candidate_archive_sha256"] != archive_sha or
            record["printed_workbook_sha256"] != workbook_sha):
        raise ValueError("PAPER_REVIEW_WRONG_SIGNED_CANDIDATE")
    if type(record["tax_year"]) is not int or record["tax_year"] not in (2025, 2026):
        raise ValueError("PAPER_REVIEW_TAX_YEAR_INVALID")
    if (type(record["expected_limit_yen"]) is not int or
            type(record["observed_limit_yen"]) is not int or
            not 0 <= record["expected_limit_yen"] <= 100000000 or
            record["observed_limit_yen"] != record["expected_limit_yen"]):
        raise ValueError("PAPER_REVIEW_TAX_AMOUNT_MISMATCH")
    for flag in (
        "physical_printer_confirmed", "one_page_a4_checked",
        "paper_physically_observed", "paper_readability_reviewed",
        "tax_amounts_cross_checked", "only_synthetic_data",
        "manual_human_review",
    ):
        if record[flag] is not True:
            raise ValueError("PAPER_NOT_PHYSICALLY_ACCEPTED")
    if (record["reviewer_role"] not in ("qa_operator", "external_reviewer") or
            record["release_decision"] != "HOLD"):
        raise ValueError("INVALID_PAPER_REVIEW_ROLE_OR_DECISION")

def check_stage(head, run_id, version, candidate, expected_sha,
                receipt, manifest, signature, paper, paper_digest):
    preflight = verify(head, run_id, version, candidate, expected_sha,
                       receipt, manifest, signature)
    if (not isinstance(paper_digest, str) or
            re.fullmatch(r"[a-f0-9]{64}", paper_digest) is None or
            manifest["checks"]["physical_printer_preview_and_output"]["sha256"]
                != paper_digest):
        raise ValueError("PAPER_EVIDENCE_NOT_BOUND_TO_PRIVATE_MANIFEST")
    check_paper(paper, preflight["candidate_archive_sha256"],
                preflight["candidate_workbook_sha256"])
    return {
        "schema": "furusato-excel-official-staging/v1",
        "product_scope": PRODUCT_SCOPE,
        "version": version,
        "head_sha": head,
        "ci_run_id": run_id,
        "candidate_archive_sha256": preflight["candidate_archive_sha256"],
        "candidate_workbook_sha256": preflight["candidate_workbook_sha256"],
        "candidate_reader_sha256": preflight["candidate_reader_sha256"],
        "print_report_sha256": paper_digest,
        "private_gate_records": preflight["private_review_records"],
        "code_lineage_and_office_vbe_signature": "HUMAN_AUTHENTICITY_REVIEW_REQUIRED",
        "publisher_authority_and_public_asset": "HUMAN_FINAL_APPROVAL_REQUIRED",
        "state": "STAGED_NOT_PUBLISHED",
        "release_decision": "HOLD",
    }

def stage(candidate, output, version, report):
    candidate, output = Path(candidate), Path(output)
    repository = Path(__file__).resolve().parents[1]
    target_dir = output.resolve()
    if target_dir == repository or repository in target_dir.parents:
        raise ValueError("PUBLIC_REPOSITORY_STAGING_FORBIDDEN")
    if output.exists():
        raise ValueError("STAGING_OUTPUT_ALREADY_EXISTS")
    if (report.get("release_decision") != "HOLD" or
            report.get("version") != version or
            report.get("candidate_archive_sha256") != digest(candidate)):
        raise ValueError("STAGING_SOURCE_CHANGED")
    output.mkdir(parents=True, exist_ok=False)
    filename = "Furusato_nouzei_" + version + "_ReadyToUse.zip"
    try:
        target = output / filename
        shutil.copyfile(candidate, target)
        if digest(target) != report["candidate_archive_sha256"]:
            raise ValueError("STAGING_COPY_SHA256_MISMATCH")
        (output / "SHA256SUMS.txt").write_text(
            report["candidate_archive_sha256"] + "  " + filename + "\n",
            encoding="utf-8",
        )
        (output / ("release-preflight-" + version + ".json")).write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return target
    except BaseException:
        shutil.rmtree(output)
        raise

def main():
    parser = argparse.ArgumentParser()
    for name in ("head", "version", "expected-sha256", "ci-receipt",
                 "private-manifest", "signature-evidence",
                 "physical-paper-review", "candidate", "output-folder"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--run-id", required=True, type=int)
    a = parser.parse_args()
    try:
        paper_file = Path(a.physical_paper_review)
        report = check_stage(
            a.head, a.run_id, a.version, Path(a.candidate), a.expected_sha256,
            read_private(a.ci_receipt), read_private(a.private_manifest),
            read_private(a.signature_evidence), read_private(paper_file),
            digest(paper_file),
        )
        stage(a.candidate, a.output_folder, a.version, report)
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        # Never reveal the contents or path of private source records.
        print("OFFICIAL_STAGING_REFUSED=" +
              (str(error) if isinstance(error, ValueError) else "PRIVATE_IO_ERROR"))
        return 2
    print("SIGNED_CANDIDATE_STAGED_NOT_PUBLISHED RELEASE_HOLD")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
