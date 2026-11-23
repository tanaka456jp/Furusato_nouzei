"""Metadata-only next-release evidence inventory. Never authorizes a Release."""
import argparse
import json
import re
from pathlib import Path

SCHEMA = "furusato-release-readiness/v6"
PRODUCT_SCOPE = "EXCEL_STANDALONE_NO_GAS_RUNTIME"
REQUIRED = (
    "ci_exact_commit",
    "screen_1920x1080_100pct",
    "screen_1920x1080_125pct",
    "screen_1366x768_150pct",
    "distribution_integrity_and_sha256",
)

# Evidence reviewers must have a role appropriate to the specific acceptance gate.
# These are metadata checks only; a claimed role is not identity verification.
def parse_evidence_json(raw):
    """Fail closed on conflicting or non-JSON private review evidence.

    Python's default json.loads silently keeps the last duplicate key and
    accepts NaN/Infinity. Neither is safe for release acceptance records.
    """
    def unique_members(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("DUPLICATE_RELEASE_EVIDENCE_JSON_KEY")
            result[key] = value
        return result

    def reject_nonfinite(token):
        raise ValueError("NONFINITE_RELEASE_EVIDENCE_JSON")

    return json.loads(raw, object_pairs_hook=unique_members,
                      parse_constant=reject_nonfinite)


REVIEWER_ROLES = {
    "ci_exact_commit": ("qa_operator", "release_operator"),
    "screen_1920x1080_100pct": ("qa_operator", "external_reviewer"),
    "screen_1920x1080_125pct": ("qa_operator", "external_reviewer"),
    "screen_1366x768_150pct": ("qa_operator", "external_reviewer"),
    "distribution_integrity_and_sha256": ("release_operator", "external_reviewer"),
}


def evaluate(head_sha, manifest=None):
    """Inventory a safe metadata manifest; HOLD is unconditional."""
    if not isinstance(head_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", head_sha):
        raise ValueError("INVALID_HEAD_SHA")
    manifest = {} if manifest is None else manifest
    if not isinstance(manifest, dict):
        raise ValueError("INVALID_MANIFEST")
    blockers = []
    if manifest.get("schema") != SCHEMA:
        blockers.append("SCHEMA_MISSING_OR_UNSUPPORTED")
    if manifest.get("head_sha") != head_sha:
        blockers.append("EVIDENCE_SHA_NOT_CURRENT")
    if set(manifest) - {"schema", "head_sha", "checks"}:
        blockers.append("MANIFEST_EXTRA_FIELDS")
    entries = manifest.get("checks", {})
    if not isinstance(entries, dict):
        blockers.append("INVALID_CHECKS_OBJECT")
        entries = {}
    if set(entries) - set(REQUIRED):
        blockers.append("UNKNOWN_CHECK_KEYS")
    states = {}
    for key in REQUIRED:
        entry = entries.get(key)
        if entry is None:
            states[key] = "MISSING"
            blockers.append("MISSING_" + key.upper())
            continue
        valid = (
            isinstance(entry, dict)
            and set(entry) == {"status", "sha256", "reviewer_role", "head_sha"}
            and entry.get("status") == "REVIEWED"
            and isinstance(entry.get("sha256"), str)
            and re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) is not None
            and entry["sha256"] != "0" * 64
            and entry.get("head_sha") == head_sha
            and entry.get("reviewer_role") in REVIEWER_ROLES[key]
        )
        if valid:
            states[key] = "REVIEW_RECORDED_NOT_INDEPENDENTLY_VERIFIED"
        else:
            states[key] = "INVALID"
            blockers.append("INVALID_" + key.upper())
    return {
        "schema": SCHEMA,
        "product_scope": PRODUCT_SCOPE,
        "head_sha": head_sha,
        "release_decision": "HOLD",
        "review_stage": ("FINAL_RELEASE_AUTHORIZATION_REQUIRED" if not blockers
                         else "EVIDENCE_INCOMPLETE"),
        "checks": states,
        "blockers": sorted(set(blockers)),
        "note": "Manual physical paper printing and independent human tax review are NOT release prerequisites. Automated 2025/2026 statutory tax checks, Excel COM acceptance, PDF layout, exact-run hashes, required display observations, and explicit publisher authorization remain. Unconfirmed taxpayer circumstances stay HOLD in individual calculations.",
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--head", required=True)
    p.add_argument("--manifest", type=Path)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    source = parse_evidence_json(args.manifest.read_text(encoding="utf-8-sig")) if args.manifest else None
    result = evaluate(args.head, source)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("RELEASE_HOLD", result["review_stage"], "blockers=" + str(len(result["blockers"])))
    return 0



# Active Excel distribution gate. The v4 reader above remains available for
# historical evidence and its callers, but cannot authorize a distribution.
AUTOMATED_SCHEMA = "furusato-excel-release-readiness/v5"
REPOSITORY = "tanaka456jp/Furusato_nouzei"
BRANCH = "fix/excel-2026-salary-nta-20261107"
VERSION = "v4.18.36"
RELEASE_PR = 5
RELEASE_JOBS = ("static", "windows_compat", "document_reader", "excel", "ready_to_use_review")
# Require actual success of the security approval step and all final Excel
# acceptance steps. A job-level success cannot replace skipped validation.
EXCEL_RELEASE_STEPS = (
    "Build, install and verify stale-results safety (isolated Excel)",
    "Compile the source project and select a verified VBA signing route",
    "Independent PC1 source-only full Excel acceptance (HOLD)",
    "Independent VBAUpdater sandbox project push (HOLD diagnostic)",
    "Compare independent 41 Excel / GAS synthetic cases (HOLD diagnostic)",
    "Apex One operator confirmation gate (reader EXE not started)",
    "Notify PC1 operator and require fresh pre-EXE readiness acknowledgment",
    "Complete Excel functional and tax update acceptance",
    "Capture isolated desktop Excel window and observed DPI",
    "Verify synthetic Excel PDF layout and render evidence",
    "VBAUpdater isolated read-only preflight and diff",
    "VBAUpdater staged project-push (mandatory acceptance)",
    "Compare 41 synthetic cases in actual Excel vs pinned GAS engine",
)
PC1 = "PC1-Furusato-Excel"
VERIFIED_DISPLAY_MODES = ["1920x1080@125"]
UNVERIFIED_DISPLAY_MODES = ["1920x1080@100", "1366x768@150"]
SIGNING_UNAVAILABLE = {
    "SIGNING_NOT_CONFIGURED",
    "CODE_SIGNING_CERTIFICATE_NOT_FOUND_IN_CURRENT_USER_MY",
    "SIGNING_PRIVATE_KEY_NOT_ACCESSIBLE",
    "X86_WINDOWS_SDK_NOT_FOUND",
    "X86_SIGNTOOL_NOT_FOUND",
    "X86_OFFICE_SIP_NOT_REGISTERED",
}
RELEASE_ARTIFACT = "Furusato_ReadyToUse_CANDIDATE"
RELEASE_ZIP = f"Furusato_nouzei_{VERSION}_ReadyToUse.zip"


def require(condition, code):
    if not condition:
        raise ValueError(code)


def valid_sha(value, length=64):
    return (isinstance(value, str)
            and re.fullmatch(r"[a-f0-9]{" + str(length) + r"}", value) is not None
            and value != "0" * length)


def equal_sha(value, expected):
    return isinstance(value, str) and value.lower() == expected


def validate_runner(head, book_sha, runner, functional, compile_original, compile_final,
                    display, pdf, update, push, parity, signing):
    """Verify the existing, structured outputs of each mandatory PC1 step."""
    require(valid_sha(head, 40) and valid_sha(book_sha), "INVALID_EXCEL_BUILD_IDENTITY")
    require(runner.get("schema") == "furusato-excel-runner/v1"
            and runner.get("head_sha") == head and runner.get("name") == PC1
            and runner.get("environment") == "self-hosted"
            and equal_sha(runner.get("workbook_sha256"), book_sha),
            "EXCEL_RUNNER_NOT_PC1_OR_WRONG_BUILD")
    require(functional.get("schema") == "furusato-excel-acceptance/v1"
            and functional.get("status") == "PASS" and functional.get("excel_version")
            and equal_sha(functional.get("workbook_sha256"), book_sha),
            "EXCEL_FUNCTIONAL_TESTS_INCOMPLETE")
    require(signing.get("schema") == "furusato-local-vba-signing/v2"
            and signing.get("head_sha") == head, "SIGNING_EVIDENCE_WRONG_BUILD")
    mode = signing.get("signing_state")
    original_sha = signing.get("source_workbook_sha256")
    require(valid_sha(original_sha), "SIGNING_SOURCE_HASH_INVALID")
    if mode == "UNSIGNED":
        require(original_sha == book_sha and signing.get("signed_workbook_sha256") is None
                and signing.get("availability") in SIGNING_UNAVAILABLE,
                "UNSIGNED_FALLBACK_NOT_JUSTIFIED")
    else:
        actual_vba = signing.get("accepted_vba_project_sha256")
        require(mode == "SIGNED" and signing.get("availability") == "AVAILABLE"
                and signing.get("signed_workbook_sha256") == book_sha and original_sha != book_sha
                and valid_sha(actual_vba) and signing.get("signed_vba_project_sha256") == actual_vba
                and signing.get("office_vba_signed_property") == "OFFICE_RECOGNIZED_SIGNED_PROJECT"
                and signing.get("signing_certificate_eku") == "CODE_SIGNING"
                and all(signing.get(key) is True for key in (
                    "signtool_verified", "certificate_thumbprint_matched",
                    "certificate_chain_verified", "timestamp_verified"))
                and signing.get("test_only") is False,
                "VBA_SIGNING_EVIDENCE_INVALID")
    for report, expected_hash in ((compile_original, original_sha), (compile_final, book_sha)):
        require(report.get("schema") == "furusato-vbe-compile/v1"
                and report.get("command_id") == 578
                and equal_sha(report.get("workbook_sha256"), expected_hash)
                and report.get("status") in ("VBE_COMPILE_EXECUTED", "VBE_ALREADY_COMPILED")
                and report.get("command_enabled_after") is False, "VBE_COMPILE_INCOMPLETE")
    require(display.get("schema") == "furusato-excel-display-acceptance/v2"
            and display.get("status") == "PASS" and display.get("source_head") == head
            and display.get("workbook_sha256") == book_sha
            and display.get("verified_modes") == VERIFIED_DISPLAY_MODES
            and display.get("unverified_modes") == UNVERIFIED_DISPLAY_MODES
            and display.get("image_count") == 4
            and set(display.get("checks", ())) == {
                "command_bounds", "command_captions", "no_command_overlap",
                "focus_and_scroll", "visible_content_bounds", "rendered_worksheet",
            }, "EXCEL_DISPLAY_SCOPE_INCOMPLETE")
    require(pdf.get("schema") == "furusato-excel-pdf-acceptance/v2"
            and pdf.get("status") == "PASS" and pdf.get("source_head") == head
            and pdf.get("workbook_sha256") == book_sha and pdf.get("revision") == VERSION
            and pdf.get("page_count") == 5 and pdf.get("physical_printer_tested") is False,
            "EXCEL_SYNTHETIC_PDF_INCOMPLETE")
    require(update.get("schema") == "furusato-vbaupdater-readonly/v1"
            and update.get("status") == "READONLY_PREFLIGHT_DIFF_PASS"
            and update.get("original_preserved") is True
            and equal_sha(update.get("original_workbook_sha256"), book_sha),
            "VBAUPDATER_PREFLIGHT_INCOMPLETE")
    require(push.get("schema") == "furusato-vbaupdater-readonly/v1"
            and push.get("status") == "STAGED_PUSH_EXCEL_PASS"
            and push.get("original_preserved") is True and push.get("synthetic_source_verified") is True
            and push.get("synthetic_source_delta") == "MARKER_COMMENT_IN_STAGE_ONLY"
            and all(push.get(field) == "PASS" for field in
                    ("project_push", "post_push_diff", "post_push_excel"))
            and equal_sha(push.get("original_workbook_sha256"), book_sha),
            "VBAUPDATER_STAGED_UPDATE_INCOMPLETE")
    require(parity.get("actualExcelCOM") is True and parity.get("matched") == 41
            and parity.get("workbookSha256") == book_sha
            and parity.get("levyComparisonBasis") == "POOLED_BEFORE_MUNICIPAL_SPLIT"
            and parity.get("mismatchCount") == 0
            and parity.get("calculationStateVerdict") == "DONE_41_OF_41",
            "EXCEL_PARITY_INCOMPLETE")
    return {"signing_state": mode, "signing_availability": signing["availability"],
            "workbook_sha256": book_sha, "source_workbook_sha256": original_sha,
            "display_modes": VERIFIED_DISPLAY_MODES,
            "unverified_display_modes": UNVERIFIED_DISPLAY_MODES,
            "physical_printer_tested": False, "tax_evidence_scope": "SYNTHETIC_2025_2026"}


def validate_github(run, jobs, head, run_id):
    """Use live GitHub Actions metadata. A candidate receipt cannot certify its own job."""
    require(valid_sha(head, 40) and type(run_id) is int and run_id > 0,
            "INVALID_RELEASE_REFERENCE")
    # PR CI must fail at the Apex One gate before running an unsigned EXE.
    # Only the intentionally operator-dispatched run can finish all five jobs.
    require(run.get("id") == run_id and run.get("head_sha") == head
            and run.get("head_branch") == BRANCH
            and run.get("event") == "workflow_dispatch"
            and run.get("path") == ".github/workflows/workbook.yml"
            and run.get("status") == "completed" and run.get("conclusion") == "success"
            and (run.get("repository") or {}).get("full_name") == REPOSITORY
            and (run.get("head_repository") or {}).get("full_name") == REPOSITORY,
            "GITHUB_RUN_NOT_MANUAL_DISPATCH_SUCCESS_FOR_EXACT_HEAD")
    actor = run.get("actor") or {}
    triggering_actor = run.get("triggering_actor") or {}
    require(actor.get("type") == "User" and triggering_actor.get("type") == "User"
            and isinstance(actor.get("login"), str) and actor["login"]
            and isinstance(triggering_actor.get("login"), str) and triggering_actor["login"],
            "GITHUB_MANUAL_OPERATOR_IDENTITY_MISSING")
    require(any(pr.get("number") == RELEASE_PR
                and (pr.get("head") or {}).get("ref") == BRANCH
                and ((pr.get("head") or {}).get("repo") or {}).get("name") == "Furusato_nouzei"
                for pr in run.get("pull_requests", [])), "GITHUB_RUN_NOT_FROM_PR5")
    require(len(jobs) == len(RELEASE_JOBS)
            and {job.get("name") for job in jobs} == set(RELEASE_JOBS)
            and type(run.get("run_attempt")) is int
            and all(job.get("run_id") == run_id and job.get("head_sha") == head
                    and job.get("run_attempt") == run["run_attempt"]
                    and job.get("conclusion") == "success" for job in jobs),
            "GITHUB_REQUIRED_FIVE_JOBS_NOT_SUCCESSFUL")
    excel = next(job for job in jobs if job["name"] == "excel")
    require(excel.get("runner_name") == PC1
            and set(excel.get("labels", ())) == {"self-hosted", "Windows", "furusato-excel"},
            "GITHUB_EXCEL_JOB_NOT_ON_PC1")
    steps = excel.get("steps")
    require(isinstance(steps, list) and
            all(sum(step.get("name") == name and
                    step.get("status") == "completed" and
                    step.get("conclusion") == "success"
                    for step in steps if isinstance(step, dict)) == 1
                for name in EXCEL_RELEASE_STEPS),
            "GITHUB_MANUAL_OPERATOR_OR_EXCEL_MANDATORY_STEP_INCOMPLETE")
    return {job: "success" for job in RELEASE_JOBS}

def read_evidence(path):
    require(path.is_file() and 0 < path.stat().st_size <= 2_000_000,
            "RELEASE_EVIDENCE_FILE_MISSING_OR_OVERSIZED")
    data = parse_evidence_json(path.read_text(encoding="utf-8-sig"))
    require(isinstance(data, dict), "RELEASE_EVIDENCE_OBJECT_REQUIRED")
    return data


def validate_candidate_report(candidate, expected_head, run_id, run_attempt):
    require(candidate.get("schema") == AUTOMATED_SCHEMA
            and candidate.get("head_sha") == expected_head
            and candidate.get("version") == VERSION
            and candidate.get("run_id") == run_id
            and candidate.get("run_attempt") == run_attempt
            and candidate.get("release_decision") == "AWAITING_LIVE_GITHUB_VERIFICATION"
            and candidate.get("prerequisite_jobs") == {
                job: "success" for job in RELEASE_JOBS if job != "ready_to_use_review"
            }, "CI_CANDIDATE_WRONG_BUILD_OR_INCOMPLETE")
    require(candidate.get("display_modes") == VERIFIED_DISPLAY_MODES
            and candidate.get("unverified_display_modes") == UNVERIFIED_DISPLAY_MODES
            and candidate.get("physical_printer_tested") is False
            and candidate.get("tax_evidence_scope") == "SYNTHETIC_2025_2026"
            and candidate.get("reader_authenticode") == "UNSIGNED"
            and candidate.get("signing_state") in ("SIGNED", "UNSIGNED"),
            "CANDIDATE_SCOPE_OR_SIGNATURE_INVALID")
    return candidate


if __name__ == "__main__":
    raise SystemExit(main())
