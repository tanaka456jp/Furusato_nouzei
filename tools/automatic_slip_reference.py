"""Automatic *hypothetical* amount from one withholding slip, no user attestation.

Never converts a source slip to a VERIFIED contribution ceiling. This estimate
assumes one salary only, no independent income, unchanged annual employment
conditions, source national non-basic deductions carried unchanged, resident
basic deduction of JPY 430,000, and no resident-tax/filing tax credits.
For a preceding-year slip, the target tax year's salary table and national
basic are applied, but no future employment/family fact is asserted.
"""
from audit_salary_donation_limit import (
    BASIC, independent_nta_fifth_table_salary_income, independent_salary_ceiling,
)

REQUIRED = ("salary_gross", "salary_reference", "deductions_reference",
            "social_insurance", "income_tax_withheld")
FATAL_WARNINGS = ("INVALID_", "CONFLICT_", "AMBIGUOUS_", "UNSUPPORTED_",
                  "YEAR_NOT_APPROVED", "BLANK_SOCIAL_INSURANCE")


def make_automatic_reference(extracted, target_year):
    """Return only a safe numeric hypothetical or a no-number HOLD code."""
    def hold(reason):
        return {"status": "HOLD", "reason": reason}
    if type(target_year) is not int or target_year not in BASIC:
        return hold("TARGET_YEAR_UNAPPROVED")
    source_year = extracted.get("year")
    if type(source_year) is not int or source_year not in BASIC:
        return hold("SOURCE_YEAR_UNAPPROVED")
    if source_year > target_year or target_year - source_year > 1:
        return hold("SOURCE_TARGET_UNAPPROVED")
    fields = extracted.get("fields") or {}
    if not isinstance(fields, dict):
        return hold("FIELDS_MISSING")
    if any(key not in fields or type(fields[key]) is not int
           for key in REQUIRED):
        return hold("REQUIRED_FIELDS_MISSING")
    warnings = extracted.get("warnings") or []
    if not isinstance(warnings, list) or any(
            not isinstance(w, str) for w in warnings):
        return hold("WARNINGS_INVALID")
    if any(w.startswith(FATAL_WARNINGS) for w in warnings):
        return hold("DOCUMENT_UNRELIABLE")
    if extracted.get("format") not in (
            "PDF_TEXT", "PDF_PAGE_SELECTED", "STRUCTURED_JSON",
            "STRUCTURED_TEXT", "TEXT_LABELS"):
        return hold("OCR_OR_UNSUPPORTED_SOURCE")
    gross = fields["salary_gross"]
    gross_source_income = fields["salary_reference"]
    gross_deductions = fields["deductions_reference"]
    social = fields["social_insurance"]
    if (not 0 <= gross <= 20_000_000
            or not 0 <= gross_source_income <= gross
            or not 0 <= gross_deductions <= 10**12
            or not 0 <= social <= gross_deductions
            or not 0 <= fields["income_tax_withheld"] <= gross):
        return hold("INVALID_INCOME_OR_DEDUCTIONS")
    source_basic = fields.get("basic_reference")
    if source_basic is None:
        source_basic = next((v for upper, v in BASIC[source_year]
                             if gross_source_income <= upper), None)
    if type(source_basic) is not int or source_basic < 0:
        return hold("BASIC_DEDUCTION_UNKNOWN")
    nonbasic = gross_deductions - source_basic
    if nonbasic < social:
        return hold("SOURCE_DEDUCTIONS_INCONSISTENT")
    try:
        # Even when estimating a future year, keep source income-adjustment
        # as an explicit hypothesis and do not claim it was re-verified.
        adjustment = fields.get("income_adjustment", 0)
        if type(adjustment) is not int or adjustment < 0 or adjustment > 150_000:
            return hold("SALARY_ADJUSTMENT_UNSUPPORTED")
        projected_salary = (gross_source_income if target_year == source_year
                            else independent_nta_fifth_table_salary_income(
                                target_year, gross) - adjustment)
        if projected_salary < 0 or projected_salary > gross:
            return hold("PROJECTED_SALARY_INVALID")
        resident_deductions = nonbasic + 430_000
        if projected_salary <= 450_000:
            amount = 0
        elif resident_deductions >= projected_salary:
            amount = 0
        else:
            estimates = [independent_salary_ceiling(
                year=target_year, salary_income=projected_salary,
                resident_deductions=resident_deductions,
                personal_difference=50_000, municipality=place,
            )["thousand_yen_reference"]
                for place in ("standard", "designated")]
            amount = min(estimates)
    except (TypeError, ValueError, KeyError):
        return hold("MODEL_OUTSIDE_SCOPE")
    if type(amount) is not int or not 0 <= amount <= 10**9:
        return hold("ESTIMATE_INVALID")
    caveats = ["SALARY_ONLY_ASSUMED", "LOCAL_TAX_RESIDENCE_UNCONFIRMED",
               "NATIONAL_TO_LOCAL_DEDUCTIONS_ASSUMED",
               "NO_OTHER_CREDITS_ASSUMED"]
    if source_year != target_year:
        caveats.append("PRIOR_YEAR_CONDITIONS_CARRIED_FORWARD")
    if fields.get("mortgage_credit", 0) or fields.get("mortgage_possible_credit", 0):
        caveats.append("MORTGAGE_CREDIT_NOT_MODELLED")
    if any(fields.get(k, 0) for k in ("special_relative_count",
                                         "special_relative_deduction_reference",
                                         "spouse_income_reference")):
        caveats.append("FAMILY_DETAILS_UNVERIFIED")
    return {"status": "AUTO_REFERENCE", "limit": amount, "target_year": target_year,
            "reason": ";".join(caveats)}
