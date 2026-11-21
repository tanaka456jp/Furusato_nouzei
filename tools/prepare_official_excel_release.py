"""Stage checksum-verified Excel assets after physical print review; never publish."""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

from verify_excel_release_candidate import verify
from release_readiness import PRODUCT_SCOPE, parse_evidence_json

PRINT_SCHEMA = "furusato-physical-paper-manual/v2"
PRINT_FIELDS = {
    "schema", "candidate_archive_sha256", "printed_workbook_sha256",
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
            record["candidate_archive_sha256"] != archive_sha or
            record["printed_workbook_sha256"] != workbook_sha):
        raise ValueError("PAPER_REVIEW_WRONG_CANDIDATE_SHA256")
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
        "code_lineage_and_integrity": "HUMAN_AUTHENTICITY_REVIEW_REQUIRED",
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
                 "private-manifest", "physical-paper-review", "candidate", "output-folder"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--signature-evidence",
                        help="Optional; supply only when claiming a signed candidate")
    parser.add_argument("--run-id", required=True, type=int)
    a = parser.parse_args()
    try:
        paper_file = Path(a.physical_paper_review)
        report = check_stage(
            a.head, a.run_id, a.version, Path(a.candidate), a.expected_sha256,
            read_private(a.ci_receipt), read_private(a.private_manifest),
            read_private(a.signature_evidence) if a.signature_evidence else None,
            read_private(paper_file),
            digest(paper_file),
        )
        stage(a.candidate, a.output_folder, a.version, report)
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        # Never reveal the contents or path of private source records.
        print("OFFICIAL_STAGING_REFUSED=" +
              (str(error) if isinstance(error, ValueError) else "PRIVATE_IO_ERROR"))
        return 2
    print("CHECKSUM_VERIFIED_CANDIDATE_STAGED_NOT_PUBLISHED RELEASE_HOLD")
    return 0


def build_automated_candidate(head, run_id, run_attempt, jobs, book, reader, excel_dir,
                              display_dir, pdf_dir, reader_report, output):
    from collect_reader_notices import NOTICE_NAME, NOTICE_LIMIT
    from package_ready_to_use_review import package_distribution
    from record_ci_acceptance import digest_file
    from release_readiness import (AUTOMATED_SCHEMA, RELEASE_JOBS, RELEASE_ZIP, VERSION,
                                   read_evidence, require, valid_sha, validate_runner)
    from verify_excel_release_candidate import verify_distribution

    require(type(run_id) is int and run_id > 0 and type(run_attempt) is int and run_attempt > 0,
            "INVALID_CANDIDATE_RUN")
    require(jobs == {job: "success" for job in RELEASE_JOBS if job != "ready_to_use_review"},
            "CANDIDATE_CI_PREREQUISITES_INCOMPLETE")
    book_sha, reader_sha = digest_file(book), digest_file(reader)
    reader_evidence = read_evidence(reader_report)
    notice = reader_report.with_name(NOTICE_NAME)
    require(notice.is_file() and 0 < notice.stat().st_size <= NOTICE_LIMIT,
            "THIRD_PARTY_NOTICES_MISSING")
    notice_sha = digest_file(notice)
    require(notice.read_bytes().startswith(
                f"FurusatoDocumentReader.exe third-party notices\nSource HEAD: {head}\n".encode("ascii")),
            "THIRD_PARTY_NOTICES_HEAD_MISMATCH")
    require(reader_evidence == {
        "schema": "furusato-reader-build/v1", "head_sha": head, "run_id": run_id,
        "run_attempt": run_attempt, "exe_sha256": reader_sha,
        "exe_authenticode": "UNSIGNED", "windows_cli_accepted": True, "pdf_backend": "pypdfium2",
        "third_party_notices_sha256": notice_sha,
    }, "READER_BUILD_OR_AUTHENTICODE_EVIDENCE_MISMATCH")
    names = ("release_runner.json", "excel_acceptance.json", "compile_source.json",
             "compile_final.json", "display_acceptance.json", "audit.json",
             "vbaupdater_bridge.json", "vbaupdater_push.json", "excel_gas_41_comparison.json",
             "release_signing.json")
    folders = (excel_dir, excel_dir, excel_dir, excel_dir, display_dir, pdf_dir,
               excel_dir, excel_dir, excel_dir, excel_dir)
    reports = [read_evidence(folder / name) for name, folder in zip(names, folders)]
    runner = reports[0]
    require(runner.get("run_id") == run_id and runner.get("run_attempt") == run_attempt,
            "EXCEL_RUNNER_WRONG_RUN_ATTEMPT")
    scope = validate_runner(head, book_sha, *reports)
    if scope["signing_state"] == "SIGNED":
        before = read_evidence(excel_dir / "excel_before_signing.json")
        require(before.get("schema") == "furusato-excel-acceptance/v1"
                and before.get("status") == "PASS"
                and isinstance(before.get("workbook_sha256"), str)
                and before["workbook_sha256"].lower() == scope["source_workbook_sha256"],
                "PRE_SIGNING_EXCEL_ACCEPTANCE_INCOMPLETE")
    require(not output.exists(), "CANDIDATE_OUTPUT_ALREADY_EXISTS")
    output.mkdir(parents=True)
    archive = output / RELEASE_ZIP
    package_distribution(book, reader, archive, head_sha=head, version=VERSION,
                         accepted_workbook_sha256=book_sha, accepted_reader_sha256=reader_sha,
                         signing_state=scope["signing_state"], signing_evidence=reports[-1])
    payload = verify_distribution(archive, head, VERSION, book_sha, reader_sha,
                                  scope["signing_state"], reports[-1])
    if scope["signing_state"] == "SIGNED":
        require(payload["vba_project_sha256"] == reports[-1]["signed_vba_project_sha256"],
                "FINAL_VBA_PROJECT_SHA256_MISMATCH")
    require(all(valid_sha(value) for value in payload.values()), "INVALID_CANDIDATE_SHA256")

    shutil.copyfile(notice, output / NOTICE_NAME)
    require(digest_file(output / NOTICE_NAME) == notice_sha, "THIRD_PARTY_NOTICES_SHA256_CHANGED")
    report = {
        "schema": AUTOMATED_SCHEMA, "head_sha": head, "version": VERSION,
        "run_id": run_id, "run_attempt": run_attempt, "prerequisite_jobs": jobs,
        "release_decision": "AWAITING_LIVE_GITHUB_VERIFICATION",
        "reader_authenticode": "UNSIGNED", "signing_evidence": reports[-1],
        "third_party_notices_sha256": notice_sha, **scope, **payload,
    }
    (output / "candidate.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def automated_main(argv):
    from release_readiness import RELEASE_JOBS
    parser = argparse.ArgumentParser(description="Assemble the exact-run release candidate.")
    parser.add_argument("--head", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--run-attempt", type=int, required=True)
    for name in RELEASE_JOBS:
        if name != "ready_to_use_review":
            parser.add_argument("--" + name.replace("_", "-"), required=True)
    for name in ("book", "reader", "excel-dir", "display-dir", "pdf-dir", "reader-report", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    a = parser.parse_args(argv)
    try:
        build_automated_candidate(
            a.head, a.run_id, a.run_attempt,
            {key: getattr(a, key) for key in RELEASE_JOBS if key != "ready_to_use_review"},
            a.book, a.reader, a.excel_dir, a.display_dir, a.pdf_dir, a.reader_report, a.output)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print("AUTOMATED_EXCEL_RELEASE_HOLD", str(exc) if isinstance(exc, ValueError)
              else type(exc).__name__)
        return 2
    print("AUTOMATED_EXCEL_CANDIDATE_VERIFIED_AWAITING_LIVE_CI")
    return 0


if __name__ == "__main__":
    import sys

    is_automated = sys.argv[1:2] == ["--automated"]
    raise SystemExit(automated_main(sys.argv[2:]) if is_automated else main())
