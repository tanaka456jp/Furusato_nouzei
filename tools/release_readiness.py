"""Metadata-only next-release evidence inventory. Never authorizes a Release."""
import argparse
import json
import re
from pathlib import Path

SCHEMA = "furusato-release-readiness/v4"
PRODUCT_SCOPE = "EXCEL_STANDALONE_NO_GAS_RUNTIME"
REQUIRED = (
    "ci_exact_commit",
    "salary_only_independent_withholding_reconciliation",
    "prior_year_projection_independent_resident_deductions",
    "mortgage_filing_independent_tax_difference",
    "screen_1920x1080_100pct",
    "screen_1920x1080_125pct",
    "screen_1366x768_150pct",
    "physical_printer_preview_and_output",
    "signed_distribution_and_sha256",
)


# Evidence reviewers must have a role appropriate to the specific acceptance gate.
# These are metadata checks only; a claimed role is not identity verification.
REVIEWER_ROLES = {
    "ci_exact_commit": ("qa_operator", "release_operator"),
    "salary_only_independent_withholding_reconciliation": ("tax_professional", "external_reviewer"),
    "prior_year_projection_independent_resident_deductions": ("tax_professional", "external_reviewer"),
    "mortgage_filing_independent_tax_difference": ("tax_professional", "external_reviewer"),
    "screen_1920x1080_100pct": ("qa_operator", "external_reviewer"),
    "screen_1920x1080_125pct": ("qa_operator", "external_reviewer"),
    "screen_1366x768_150pct": ("qa_operator", "external_reviewer"),
    "physical_printer_preview_and_output": ("qa_operator", "external_reviewer"),
    "signed_distribution_and_sha256": ("release_operator", "external_reviewer"),
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
        "review_stage": ("MANUAL_FINAL_AUDIT_REQUIRED" if not blockers
                         else "EVIDENCE_INCOMPLETE"),
        "checks": states,
        "blockers": sorted(set(blockers)),
        "note": "A year-end-adjusted salary-only withholding slip can support an independently calculated donation ceiling without a resident-tax notice. Evidence of source-year tax, 2025-to-2026 independent resident deductions, independently reviewed tax-return and housing-credit reallocation, verified conditions, current Excel comparison, physical display/printing and trusted code signing remains necessary. Live GAS deployment acceptance belongs to the separate Web/GAS product.",
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--head", required=True)
    p.add_argument("--manifest", type=Path)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    source = json.loads(args.manifest.read_text(encoding="utf-8-sig")) if args.manifest else None
    result = evaluate(args.head, source)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("RELEASE_HOLD", result["review_stage"], "blockers=" + str(len(result["blockers"])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
