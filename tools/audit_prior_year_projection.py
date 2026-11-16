"""Independent 2025 withholding-slip -> 2026 resident-tax projection gate.

The source year's G05/G08/G26 are checked as historical evidence, never
treated as a final 2026 tax determination. Target resident deductions are
derived component-by-component, without going through national taxable income.
Public CI must use wholly synthetic amounts and no taxpayer identifiers.
"""
import argparse
import json
from pathlib import Path

from audit_insurance_deductions import calculate_insurance
from audit_salary_donation_limit import (
    independent_salary_ceiling, verified_family_deductions,
)
from audit_withholding_reconciliation import reconcile

SOURCE_FIELDS = frozenset((
    "salary_gross", "salary_reference", "deductions_reference",
    "income_tax_withheld", "social_insurance",
))
TARGET_FIELDS = frozenset(("salary_gross", "salary_income", "social_insurance"))
FAMILY_FIELDS = frozenset((
    "spouse", "general", "special", "elderly", "cohabiting_elderly", "under16",
))
EXPECTED_FIELDS = frozenset((
    "source_deductions_reference", "target_salary_income",
    "national_life", "national_earthquake", "national_deductions",
    "resident_life", "resident_earthquake", "resident_deductions",
    "resident_taxable_income", "resident_income_levy", "donation_limit",
))
CONFIRMATIONS = frozenset((
    "target_pay_and_insurance_reviewed", "family_eligibility_reviewed",
    "municipality_reviewed", "one_stop_filing_confirmed",
    "no_other_income_or_credits", "no_unverified_manual_overrides",
    "source_deductions_not_reused",
))
CASE_FIELDS = frozenset((
    "source_year", "target_year", "source", "target", "insurance",
    "family", "municipality", "confirmations", "workbook",
))


def _money(value):
    return type(value) is int and 0 <= value <= 10**12


def compare_projection(case):
    """Return categorical results only: never leak sensitive numeric inputs."""
    def hold(reason):
        return {"status": "NOT_COMPARABLE", "reason": reason}

    if not isinstance(case, dict) or set(case) != CASE_FIELDS:
        return hold("MISSING_OR_EXTRA_PROJECTION_FIELDS")
    if case["source_year"] != 2025 or case["target_year"] != 2026:
        return hold("UNSUPPORTED_SOURCE_TARGET_YEAR_PAIR")
    confirms = case["confirmations"]
    if not isinstance(confirms, dict) or set(confirms) != CONFIRMATIONS:
        return hold("PROJECTION_CONFIRMATIONS_INCOMPLETE")
    if any(confirms[k] is not True for k in CONFIRMATIONS):
        return hold("UNVERIFIED_TARGET_YEAR_PROJECTION")
    source, target, book = case["source"], case["target"], case["workbook"]
    if (not isinstance(source, dict) or set(source) != SOURCE_FIELDS or
            not all(_money(value) for value in source.values())):
        return hold("UNVERIFIED_SOURCE_YEAR_WITHHOLDING")
    if (not isinstance(target, dict) or set(target) != TARGET_FIELDS or
            not all(_money(value) for value in target.values())):
        return hold("UNVERIFIED_TARGET_YEAR_AMOUNTS")
    if (not isinstance(book, dict) or set(book) != EXPECTED_FIELDS or
            not all(_money(value) for value in book.values())):
        return hold("INCOMPLETE_EXCEL_PROJECTION_EVIDENCE")
    if (not isinstance(case["family"], dict) or
            set(case["family"]) != FAMILY_FIELDS or
            case["municipality"] not in ("standard", "designated")):
        return hold("UNVERIFIED_FAMILY_OR_MUNICIPALITY")
    insurance = case["insurance"]
    if (isinstance(insurance, dict) and
            insurance.get("verified_2026_under23_dependent") is True and
            not any(type(case["family"][kind]) is int and
                    case["family"][kind] > 0
                    for kind in ("under16", "general", "special"))):
        # A flag alone is not proof that a qualifying child is in the
        # independently reviewed current-year family population.
        return hold("UNDER23_DEPENDENT_NOT_IN_TARGET_FAMILY")
    if (source["salary_gross"] < 6_600_000 or
            target["salary_gross"] < 6_600_000 or
            source["salary_gross"] > 20_000_000 or
            target["salary_gross"] > 20_000_000):
        # Smaller gross salaries need the year-specific NTA Fifth Table;
        # larger salaries exceed year-end adjustment eligibility.
        return hold("SALARY_TABLE_OR_YEAR_END_ADJUSTMENT_OUT_OF_SCOPE")
    if (book["source_deductions_reference"] != source["deductions_reference"] or
            book["target_salary_income"] != target["salary_income"]):
        return {"status": "MISMATCH", "reason": "SOURCE_OR_TARGET_PROVENANCE_MISMATCH"}

    def salary_income(gross):
        return (gross * 9 // 10 - 1_100_000 if gross <= 8_500_000
                else gross - 1_950_000)

    if (source["salary_reference"] != salary_income(source["salary_gross"]) or
            target["salary_income"] != salary_income(target["salary_gross"])):
        return hold("SOURCE_OR_TARGET_SALARY_NOT_RECONCILED")

    try:
        if reconcile(2025, source)["source_tax"] != "MATCH":
            return hold("PRIOR_SOURCE_YEAR_END_TAX_NOT_RECONCILED")
        ins = calculate_insurance(year=2026, record=case["insurance"])
        family = verified_family_deductions(
            year=2026, salary_income=target["salary_income"],
            social_insurance=target["social_insurance"], **case["family"])
        if family["resident_income_levy_exempt"]:
            return hold("TARGET_YEAR_RESIDENT_INCOME_LEVY_EXEMPT")
        # Resident deductions: original local statutory components. Neither
        # national taxable income nor national-minus-local deduction gaps
        # enter this total.
        national_deductions = (
            family["national_deductions"] + ins["national_life"]
            + ins["national_earthquake"]
        )
        resident_deductions = (
            family["resident_deductions"] + ins["resident_life"]
            + ins["resident_earthquake"]
        )
        oracle = independent_salary_ceiling(
            year=2026, salary_income=target["salary_income"],
            resident_deductions=resident_deductions,
            personal_difference=family["personal_difference"],
            municipality=case["municipality"],
        )
    except (ValueError, KeyError, TypeError, StopIteration):
        return hold("UNVERIFIED_OR_OUT_OF_SCOPE_TARGET_TAX_RULE")

    expected = {
        "target_salary_income": target["salary_income"],
        "national_life": ins["national_life"],
        "national_earthquake": ins["national_earthquake"],
        "national_deductions": national_deductions,
        "resident_life": ins["resident_life"],
        "resident_earthquake": ins["resident_earthquake"],
        "resident_deductions": resident_deductions,
        "resident_taxable_income": oracle["resident_taxable_income"],
        "resident_income_levy": oracle["resident_income_levy"],
        "donation_limit": oracle["thousand_yen_reference"],
    }
    for key, value in expected.items():
        if book[key] != value:
            return {"status": "MISMATCH", "reason": "INDEPENDENT_" + key.upper()}
    return {"status": "MATCH_REFERENCE", "reason": "SOURCE_YEAR_SEPARATED_TARGET_LOCAL_DEDUCTIONS"}


def evaluate(cases, min_cases=2):
    if (not isinstance(cases, list) or not 1 <= len(cases) <= 100 or
            type(min_cases) is not int or not 1 <= min_cases <= 100):
        raise ValueError("INVALID_PROJECTION_CASES")
    verdicts = [compare_projection(c) for c in cases]
    counts = {s: sum(v["status"] == s for v in verdicts)
              for s in ("MATCH_REFERENCE", "MISMATCH", "NOT_COMPARABLE")}
    accepted = (
        counts["MATCH_REFERENCE"] >= min_cases and
        counts["MISMATCH"] == counts["NOT_COMPARABLE"] == 0
    )
    return {
        "schema": "furusato-prior-year-projection-audit/v1",
        "source_year": 2025, "target_year": 2026,
        "resident_tax_notice_required": False,
        "private_numeric_inputs_in_summary": False,
        "results": [{"index": i+1, **v} for i,v in enumerate(verdicts)],
        "totals": counts,
        "status": "PASS" if accepted else "HOLD",
        "release_decision": "HOLD",  # Real documents/Windows QA not certified here.
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--min-cases", type=int, default=2)
    args = ap.parse_args()
    cases = json.loads(args.input.read_text(encoding="utf-8-sig"))
    outcome = evaluate(cases, min_cases=args.min_cases)
    print("PRIOR_YEAR_PROJECTION=" + outcome["status"]
          + " MATCH=" + str(outcome["totals"]["MATCH_REFERENCE"])
          + " MISMATCH=" + str(outcome["totals"]["MISMATCH"])
          + " OUT_OF_SCOPE=" + str(outcome["totals"]["NOT_COMPARABLE"])
          + " FIRST_REASON=" + next(
              (v["reason"] for v in outcome["results"]
               if v["status"] != "MATCH_REFERENCE"), "NONE")
          + " RELEASE=HOLD")
    return 0 if outcome["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
