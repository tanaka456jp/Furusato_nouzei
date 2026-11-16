"""Synthetic-only independent mortgage + tax-return donation relief oracle.

Recomputes national income tax *after the donation income deduction*, then
reallocates unused housing credit into resident tax, and finally applies the
resident basic/special donation credits. The output is a reviewed-model
reference, NEVER an approved personal donation limit. No source documents,
personal identifiers, OCR fields or private amounts may enter public CI.

Sources: NTA No.1155, city resident-tax housing-credit rules (2025/2026).
"""
from fractions import Fraction

from audit_salary_donation_limit import independent_salary_ceiling
from audit_withholding_reconciliation import progressive_income_tax


def _yen(value):
    return type(value) is int and 0 <= value <= 10**12


def calculate_mortgage_filing_case(
    *, year, salary_income, national_deductions, resident_deductions,
    mortgage_possible, occupancy_year, donation, personal_difference=50_000,
    municipality="standard", housing_class="ordinary_5pct",
):
    """Reconcile a synthetic tax-return case before/after one donation.

    A first-year mortgage is allowed (and indeed requires a tax return).
    Other income, special credits, rental-house interest allocation, multiple
    mortgages and real-taxpayer 1-yen tax-return rounding are not established.
    """
    for value in (salary_income, national_deductions, resident_deductions,
                  mortgage_possible, donation, personal_difference):
        if not _yen(value):
            raise ValueError("UNVERIFIED_TAX_RETURN_INPUT")
    if type(year) is not int or year not in (2025, 2026):
        raise ValueError("UNAPPROVED_YEAR")
    if type(occupancy_year) is not int or not 2022 <= occupancy_year <= year:
        raise ValueError("UNVERIFIED_HOUSING_OCCUPANCY")
    if mortgage_possible <= 0:
        raise ValueError("HOUSING_CREDIT_NOT_PRESENT")
    if housing_class not in ("ordinary_5pct", "transitional_7pct"):
        raise ValueError("UNVERIFIED_HOUSING_CLASS")
    if (housing_class == "transitional_7pct" and occupancy_year != 2022):
        raise ValueError("INELIGIBLE_TRANSITION_CLASS")
    if (housing_class == "ordinary_5pct" and occupancy_year == 2022):
        # 2022 occupancy requires independently reviewed 5% / 7% class.
        raise ValueError("UNVERIFIED_2022_HOUSING_CLASS")
    if (salary_income <= 0 or national_deductions > salary_income or
            donation < 2000 or donation > salary_income * 3 // 10):
        raise ValueError("UNSUPPORTED_TAX_RETURN_BASIS")
    # Mortgage and donation are computed independently of the Excel/GAS
    # tax masters. Resident tax is computed directly from local deductions.
    base = independent_salary_ceiling(
        year=year, salary_income=salary_income,
        resident_deductions=resident_deductions,
        personal_difference=personal_difference,
        municipality=municipality)
    levy = base["resident_income_levy"]
    ratio = base["special_ratio"]
    basic = base["national_basic_deduction"]
    cap_rate, cap_max = ((7, 136500) if housing_class == "transitional_7pct"
                         else (5, 97500))
    base_taxable = (salary_income - national_deductions) // 1000 * 1000
    # The 2025/2026 40%-income cap applies to the *donation amount*.
    donation_deductible = max(
        0, min(donation, salary_income * 4 // 10) - 2000)
    after_taxable = max(
        0, salary_income - national_deductions - donation_deductible
    ) // 1000 * 1000
    if base_taxable < 0 or after_taxable < 0:
        raise ValueError("UNSUPPORTED_NATIONAL_TAX_BASIS")
    income_before = progressive_income_tax(base_taxable)
    income_after = progressive_income_tax(after_taxable)
    # Housing credit is applied AFTER the national donation deduction.
    applied_before = min(mortgage_possible, income_before)
    applied_after = min(mortgage_possible, income_after)
    basic_delta = (
        max(0, basic - 480_000) if occupancy_year <= 2025 else 0)
    basis_before = (base_taxable + basic_delta) // 1000 * 1000
    basis_after = (after_taxable + basic_delta) // 1000 * 1000
    housing_before = min(
        mortgage_possible - applied_before, cap_max,
        basis_before * cap_rate // 100)
    housing_after = min(
        mortgage_possible - applied_after, cap_max,
        basis_after * cap_rate // 100)
    # Reconstruction surtax is computed on national tax remaining after
    # national housing credit. Integer truncation is conservatively reviewed.
    national_paid_before = ((income_before - applied_before) * 1021) // 1000
    national_paid_after = ((income_after - applied_after) * 1021) // 1000
    resident_donation_base = min(donation, salary_income * 3 // 10) - 2000
    resident_basic = resident_donation_base // 10
    resident_special = min(
        base["special_20pct_cap"],
        Fraction(resident_donation_base) * ratio)
    resident_special = int(resident_special)
    resident_after_housing = max(0, levy - housing_after)
    resident_donation_applied = min(
        resident_after_housing, resident_basic + resident_special)
    resident_paid_before = max(0, levy - housing_before)
    resident_paid_after = resident_after_housing - resident_donation_applied
    savings = (national_paid_before - national_paid_after +
               resident_paid_before - resident_paid_after)
    return {
        "scope": "SYNTHETIC_ONLY",
        "donation_limit": "NOT_VERIFIED",
        "income_tax_before_housing_and_donation": income_before,
        "income_tax_after_donation_before_housing": income_after,
        "national_housing_applied_before": applied_before,
        "national_housing_applied_after": applied_after,
        "resident_housing_before": housing_before,
        "resident_housing_after": housing_after,
        "resident_donation_applied": resident_donation_applied,
        "national_tax_saving": national_paid_before - national_paid_after,
        "resident_tax_saving": resident_paid_before - resident_paid_after,
        "total_tax_saving": savings,
        "estimated_personal_burden": max(0, donation - savings),
        "within_2000_yen_reference": donation <= 2000 or savings + 1 >= donation-2000,
        "resident_income_levy": levy,
        "statutory_special_cap": base["special_20pct_cap"],
        "statutory_special_ratio": ratio,
    }


def independent_mortgage_filing_ceiling(
    *, year, salary_income, national_deductions, resident_deductions,
    mortgage_possible, occupancy_year, personal_difference=50_000,
    municipality="standard", housing_class="ordinary_5pct",
):
    """Safe-prefix reference at ¥1,000 intervals.

    Search stops at the first failed step; unlike a binary search, this
    does not assume monotonic success across tax-table rounding boundaries.
    """
    ceiling = 0
    last = None
    for amount in range(2_000, salary_income * 3 // 10 + 1, 1_000):
        probe = calculate_mortgage_filing_case(
            year=year, salary_income=salary_income,
            national_deductions=national_deductions,
            resident_deductions=resident_deductions,
            mortgage_possible=mortgage_possible,
            occupancy_year=occupancy_year, donation=amount,
            personal_difference=personal_difference,
            municipality=municipality, housing_class=housing_class)
        last = probe
        if not probe["within_2000_yen_reference"]:
            break
        ceiling = amount
    if last is None:
        raise ValueError("NO_DONATION_CAP_REFERENCE")
    return {
        "scope": "SYNTHETIC_ONLY",
        "donation_limit": "NOT_VERIFIED",
        "tax_return_thousand_yen_reference": ceiling,
        "stop_on_first_failure": True,
        "statutory_special_cap": last["statutory_special_cap"],
    }
