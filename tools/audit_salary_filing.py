"""Synthetic-only independent salary tax-return donation ceiling (no housing).

Computes national income tax change, reconstruction surtax, and local basic
and special credits at each candidate donation. No person's true eligibility
is inferred. Sources: NTA No.1155 and Kyoto City donation tax-credit rules.
"""
from fractions import Fraction
from audit_salary_donation_limit import independent_salary_ceiling
from audit_withholding_reconciliation import progressive_income_tax


def calculate_salary_filing_case(*, year, salary_income, national_deductions,
                                 resident_deductions, donation,
                                 municipality="standard",
                                 personal_difference=50_000):
    if type(year) is not int or year not in (2025, 2026):
        raise ValueError("UNAPPROVED_FILING_YEAR")
    if any(type(v) is not int or v < 0 or v > 10**12 for v in
           (salary_income, national_deductions, resident_deductions,
            donation, personal_difference)):
        raise ValueError("INVALID_FILING_INPUT")
    if (salary_income <= 450_000 or national_deductions >= salary_income
            or resident_deductions >= salary_income or
            not 2_000 <= donation <= salary_income * 3 // 10):
        raise ValueError("FILING_OUTSIDE_SUPPORTED_SCOPE")
    base = independent_salary_ceiling(
        year=year, salary_income=salary_income,
        resident_deductions=resident_deductions,
        personal_difference=personal_difference, municipality=municipality)
    national_before = (salary_income - national_deductions) // 1000 * 1000
    deductible = min(donation, salary_income * 4 // 10) - 2_000
    national_after = max(
        0, salary_income - national_deductions - deductible) // 1000 * 1000
    tax_before = progressive_income_tax(national_before)
    tax_after = progressive_income_tax(national_after)
    # Income-tax return uses exact-yen amounts, not withholding's 100-yen floor.
    national_saving = tax_before * 1021 // 1000 - tax_after * 1021 // 1000
    local_base = min(donation, salary_income * 3 // 10) - 2_000
    resident_saving = min(
        base["resident_income_levy"],
        local_base // 10 + min(base["resident_income_levy"] // 5,
                              int(Fraction(local_base) * base["special_ratio"])))
    total = national_saving + resident_saving
    return {"scope": "SYNTHETIC_ONLY", "donation_limit": "NOT_VERIFIED",
            "national_tax_saving": national_saving,
            "resident_tax_saving": resident_saving,
            "total_saving": total,
            "within_2000_yen_reference": total + 1 >= donation - 2_000}


def independent_salary_filing_ceiling(*, year, salary_income,
                                     national_deductions, resident_deductions,
                                     municipality="standard",
                                     personal_difference=50_000):
    """Conservative safe prefix on a ¥1,000 grid; no monotonicity assumption."""
    ceiling = 0
    for donation in range(2_000, salary_income * 3 // 10 + 1, 1_000):
        case = calculate_salary_filing_case(
            year=year, salary_income=salary_income,
            national_deductions=national_deductions,
            resident_deductions=resident_deductions, donation=donation,
            municipality=municipality,
            personal_difference=personal_difference)
        if not case["within_2000_yen_reference"]:
            break
        ceiling = donation
    return {"scope": "SYNTHETIC_ONLY", "donation_limit": "NOT_VERIFIED",
            "tax_return_thousand_yen_reference": ceiling,
            "stop_on_first_failure": True}
