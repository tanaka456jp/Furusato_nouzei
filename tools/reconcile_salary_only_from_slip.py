"""Local-only independent reconciliation for year-end-adjusted salary-only slips.

NO residential-tax decision notice. No PDF/PII is uploaded. Salary source
figures and separately confirmed family/filing facts are required. The
calculation uses independently maintained Fraction-based statutory oracles,
NOT formulas imported from the distributed workbook.

This strict v2 supports independently confirmed life/earthquake insurance
premiums when the optional `insurance` record is supplied. Income adjustments,
mortgage and other tax credits remain NOT COMPARABLE. No real identifiers.
"""
import argparse
import json
from pathlib import Path

from audit_withholding_reconciliation import reconcile
from audit_insurance_deductions import calculate_insurance
from audit_salary_donation_limit import (
    independent_salary_ceiling,
    independent_nta_fifth_table_salary_income,
    verified_family_deductions,
)

REQUIRED_CONFIRMATIONS = (
    "year_end_adjusted",
    "one_salary_source",
    "no_other_income",
    "no_unmodelled_deductions",
    "no_tax_credits",
    "no_salary_income_adjustment",
    "nta_fifth_table_rechecked",
    "family_eligibility_confirmed",
    "resident_municipality_confirmed",
    "donation_filing_method_confirmed",
    "no_post_adjustment_changes",
)
FAMILY_KEYS = (
    "spouse", "general", "special", "elderly", "cohabiting_elderly", "under16",
)
SOURCE_KEYS = (
    "salary_gross", "salary_reference", "deductions_reference",
    "income_tax_withheld", "social_insurance",
)
WORKBOOK_KEYS = ("year", "donation_limit", "resident_income_levy")
ROOT_KEYS = ("year", "confirmations", "family", "source", "workbook", "municipality")


def _int(value):
    return type(value) is int and 0 <= value <= 10**12


def compare_case(case):
    """Return categorical findings only. Do not expose tax values or IDs."""
    def hold(reason):
        return {"status": "NOT_COMPARABLE", "reason": reason}
    if not isinstance(case, dict) or set(case) not in (set(ROOT_KEYS), set(ROOT_KEYS) | {"insurance"}):
        return hold("UNEXPECTED_CASE_FIELDS")
    year = case["year"]
    if type(year) is not int or year not in (2025, 2026):
        return hold("UNAPPROVED_OR_MISSING_YEAR")
    conf = case["confirmations"]
    if (not isinstance(conf, dict) or set(conf) != set(REQUIRED_CONFIRMATIONS)
            or any(conf[k] is not True for k in REQUIRED_CONFIRMATIONS)):
        return hold("SALARY_ONLY_OR_DEDUCTIONS_NOT_CONFIRMED")
    source = case["source"]
    workbook = case["workbook"]
    family = case["family"]
    if (not isinstance(source, dict) or set(source) != set(SOURCE_KEYS)
            or any(not _int(source[k]) for k in SOURCE_KEYS)):
        return hold("SOURCE_FIELDS_INCOMPLETE_OR_INVALID")
    if (not isinstance(workbook, dict) or set(workbook) != set(WORKBOOK_KEYS)
            or type(workbook["year"]) is not int
            or any(not _int(workbook[k]) for k in ("donation_limit",
                                                   "resident_income_levy"))):
        return hold("WORKBOOK_RESULTS_INCOMPLETE_OR_INVALID")
    if workbook["year"] != year:
        return hold("SOURCE_AND_TARGET_YEAR_MISMATCH")
    if (not isinstance(family, dict) or set(family) != set(FAMILY_KEYS)
            or case["municipality"] not in ("standard", "designated")):
        return hold("UNVERIFIED_FAMILY_OR_MUNICIPALITY")
    if ("insurance" in case and
            case["insurance"] is not None and
            isinstance(case["insurance"], dict) and
            case["insurance"].get("verified_2026_under23_dependent") is True and
            not any(type(family[k]) is int and family[k] > 0
                    for k in ("under16", "general", "special"))):
        # Spouse/elderly relatives alone cannot prove an eligible under-23
        # dependent. Age within the general class still needs separate proof.
        return hold("UNDER23_DEPENDENT_NOT_IN_VERIFIED_FAMILY")
    if source["salary_gross"] > 20_000_000:
        return hold("NOT_YEAR_END_ADJUSTMENT_ELIGIBLE")
    if source["salary_gross"] <= 0 or source["salary_reference"] > source["salary_gross"]:
        return hold("INVALID_SOURCE_SALARY")
    # Independently verify the NTA Fifth Table including the 4,000-yen
    # salary bands. Keep special low-salary rows outside this formula-only
    # crosscheck; the operator must examine those exact government rows.
    gross, income = source["salary_gross"], source["salary_reference"]
    try:
        expected = independent_nta_fifth_table_salary_income(year, gross)
    except ValueError:
        return hold("SOURCE_SALARY_TABLE_REVIEW_REQUIRED")
    if income != expected:
        return hold("SOURCE_SALARY_NOT_RECONCILED_TO_NTA_TABLE")
    try:
        ins = (calculate_insurance(year=year, record=case["insurance"])
               if "insurance" in case else
               {"national_life": 0, "resident_life": 0,
                "national_earthquake": 0, "resident_earthquake": 0})
        deductions = verified_family_deductions(
            year=year, salary_income=income,
            social_insurance=source["social_insurance"], **family)
        if deductions["resident_income_levy_exempt"]:
            return hold("RESIDENT_INCOME_LEVY_EXEMPT")
        if (deductions["national_deductions"] + ins["national_life"]
                + ins["national_earthquake"] != source["deductions_reference"]):
            return hold("SOURCE_DEDUCTIONS_INCLUDE_UNMODELLED_CREDITS_OR_DEDUCTIONS")
        source_check = reconcile(year, source)
        if source_check["source_tax"] != "MATCH":
            return hold("SOURCE_YEAR_END_TAX_NOT_RECONCILED")
        independent = independent_salary_ceiling(
            year=year, salary_income=income,
            resident_deductions=(deductions["resident_deductions"]
                                 + ins["resident_life"]
                                 + ins["resident_earthquake"]),
            personal_difference=deductions["personal_difference"],
            municipality=case["municipality"])
    except (ValueError, KeyError, StopIteration, TypeError):
        return hold("OUT_OF_SCOPE_TAX_RULE_OR_UNVERIFIED_FAMILY")
    if (independent["thousand_yen_reference"] != workbook["donation_limit"]
            or independent["resident_income_levy"] !=
            workbook["resident_income_levy"]):
        return {"status": "MISMATCH", "reason": "INDEPENDENT_SALARY_OR_RESIDENT_TAX_DIFFERENCE"}
    return {"status": "MATCH_REFERENCE", "reason": "INDEPENDENT_1000_YEN_SALARY_ONLY_REFERENCE"}


def evaluate(cases, min_cases=5):
    if not isinstance(cases, list) or not 1 <= len(cases) <= 100:
        raise ValueError("INVALID_CASE_LIST")
    if type(min_cases) is not int or not 1 <= min_cases <= 100:
        raise ValueError("INVALID_MIN_CASE_COUNT")
    results = [compare_case(case) for case in cases]
    counts = {status: sum(x["status"] == status for x in results)
              for status in ("MATCH_REFERENCE", "MISMATCH", "NOT_COMPARABLE")}
    return {
        "schema": "furusato-salary-only-independent-review/v1",
        "resident_tax_notice_used": False,
        "private_input_stored_in_report": False,
        "cases_checked": len(results),
        "results": [{"index": i+1, **entry} for i,entry in enumerate(results)],
        "totals": counts,
        "review_stage": ("INDEPENDENT_SALARY_ONLY_REFERENCE_MATCHED"
                         if counts["MATCH_REFERENCE"] >= min_cases
                         and counts["MISMATCH"] == counts["NOT_COMPARABLE"] == 0
                         else "INDEPENDENT_REVIEW_INCOMPLETE"),
        "release_decision": "HOLD",
        "limitation": ("In-scope statutory thousand-yen reference only. "
                       "No real taxpayer source data included; official final "
                       "tax treatment and manual release review still required."),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True,
                        help="Private local numeric-only JSON; NEVER upload to public CI")
    parser.add_argument("--summary", type=Path,
                        help="Optional anonymous categorical report, no source values")
    parser.add_argument("--min-cases", type=int, default=5)
    args = parser.parse_args()
    if args.summary is not None and args.input.resolve() == args.summary.resolve():
        raise ValueError("OUTPUT_MUST_NOT_OVERWRITE_PRIVATE_SOURCE")
    cases = json.loads(args.input.read_text(encoding="utf-8-sig"))
    result = evaluate(cases, min_cases=args.min_cases)
    if args.summary:
        if args.summary.exists():
            raise ValueError("REFUSE_TO_OVERWRITE_EXISTING_REPORT")
        args.summary.write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n",
                                encoding="utf-8")
    print("SALARY_ONLY_REFERENCE="+result["review_stage"]+
          " MATCH="+str(result["totals"]["MATCH_REFERENCE"])+
          " MISMATCH="+str(result["totals"]["MISMATCH"])+
          " OUT_OF_SCOPE="+str(result["totals"]["NOT_COMPARABLE"])+
          " RELEASE=HOLD")
    return 0 if result["review_stage"] == "INDEPENDENT_SALARY_ONLY_REFERENCE_MATCHED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
