"""Conservative salary-only mortgage one-stop estimate and filing comparison.

All outputs are provisional model references, not verified personal taxes.
Use only same-year year-end-adjusted wages, a single 2023+ mortgage claim,
ordinary 5% resident-housing transfer, and fully reconciled withholding.
Missing acquisition eligibility, additional deductions, or residency must not
be silently represented as an exact homeowner filing benefit.
"""
from audit_salary_donation_limit import (
    independent_salary_ceiling, independent_one_stop_after_housing,
    independent_nta_fifth_table_salary_income,
)
from audit_mortgage_filing import independent_mortgage_filing_ceiling
from audit_withholding_reconciliation import progressive_income_tax, reconcile
from fractions import Fraction


class MortgageBatchScopeError(ValueError):
    """A one-stop reference cannot safely be inferred from this slip."""


def compare_mortgage_modes(*, evidence, source_year, target_year,
                           salary_income, national_deductions,
                           resident_deductions, national_basic,
                           municipality_class):
    """Return conservative per-mode references; no filing recommendation.

    Filing comparison is emitted only if every tested resident-tax split
    independently gives an identical filing ceiling strictly above the
    *maximum* one-stop amount across the same splits.
    """
    fields = evidence.get("fields") or {}
    if source_year != target_year:
        raise MortgageBatchScopeError("MORTGAGE_NEXT_YEAR_NOT_VERIFIED")
    if type(source_year) is not int or source_year not in (2025, 2026):
        raise MortgageBatchScopeError("MORTGAGE_TAX_YEAR_UNSUPPORTED")
    if not all(type(value) is int for value in
               (salary_income, national_deductions, resident_deductions,
                national_basic)):
        raise MortgageBatchScopeError("MORTGAGE_DEDUCTIONS_NOT_RECONCILED")
    if (type(fields.get("salary_gross")) is not int or
            fields.get("income_adjustment", 0) != 0 or
            fields.get("under16_count", 0) != 0 or
            salary_income != independent_nta_fifth_table_salary_income(
                source_year, fields["salary_gross"])):
        raise MortgageBatchScopeError("MORTGAGE_SALARY_OR_FAMILY_UNVERIFIED")
    if national_deductions != fields.get("social_insurance", -1) + national_basic:
        # Resident and national life/earthquake/family allowances differ.
        raise MortgageBatchScopeError("MORTGAGE_NONBASIC_DEDUCTIONS_UNVERIFIED")
    if any(type(fields.get(key, 0)) is not int or fields.get(key, 0) != 0
           for key in ("life_new", "life_old", "medical_care", "annuity_new",
                       "annuity_old", "earthquake_paid",
                       "earthquake_deduction_reference",
                       "spouse_income_reference", "special_relative_count",
                       "special_relative_deduction_reference")):
        raise MortgageBatchScopeError("MORTGAGE_OTHER_DEDUCTIONS_UNVERIFIED")
    if fields.get("mortgage_claim_count", 1) != 1:
        raise MortgageBatchScopeError("MORTGAGE_MULTIPLE_CLAIMS_UNVERIFIED")
    occupancy = fields.get("mortgage_occupancy_year")
    if type(occupancy) is not int or not 2023 <= occupancy < source_year:
        # 2022 may be a 5% or 7% transition; first-year needs a tax return.
        raise MortgageBatchScopeError("MORTGAGE_OCCUPANCY_OR_CLASS_UNVERIFIED")
    used = fields.get("mortgage_credit")
    possible = fields.get("mortgage_possible_credit", used)
    if (type(used) is not int or type(possible) is not int or
            possible <= 0 or used < 0 or used > possible):
        raise MortgageBatchScopeError("MORTGAGE_CREDIT_NOT_RECONCILED")
    national_taxable = max(0, salary_income - national_deductions)//1000*1000
    national_tax = progressive_income_tax(national_taxable)
    # In the NTA slip the "possible" amount can be omitted when the full
    # credit is consumed by income tax. But if the national liability is
    # *fully* used, an omitted possible amount leaves the resident carryover
    # unknown. Do not equate actual applied with total allowable credit.
    if "mortgage_possible_credit" not in fields and used >= national_tax:
        raise MortgageBatchScopeError("MORTGAGE_POSSIBLE_CREDIT_REQUIRED")
    if used != min(possible, national_tax):
        raise MortgageBatchScopeError("MORTGAGE_USED_AMOUNT_DISAGREES")
    if reconcile(source_year, fields).get("source_tax") != "MATCH":
        raise MortgageBatchScopeError("MORTGAGE_SOURCE_TAX_NOT_RECONCILED")
    if municipality_class == "STANDARD":
        municipalities = ("standard",)
    elif municipality_class == "DESIGNATED":
        municipalities = ("designated",)
    elif municipality_class == "UNCERTAIN":
        municipalities = ("standard", "designated")
    else:
        # 'SPECIAL' can indicate a non-standard local-tax ordinance, not
        # simply an unknown standard/designated city-share split.
        raise MortgageBatchScopeError("MORTGAGE_MUNICIPALITY_RATE_UNVERIFIED")
    scenarios = []
    for municipality in municipalities:
        nominal = independent_salary_ceiling(
            year=source_year, salary_income=salary_income,
            resident_deductions=resident_deductions,
            personal_difference=50_000, municipality=municipality)
        # Reject special high-rate schemes unsupported by the one-stop
        # equivalent income-tax-rate calculation.
        if nominal["special_ratio"] < Fraction(56307, 100000):
            raise MortgageBatchScopeError("MORTGAGE_HIGH_RATE_UNVERIFIED")
        basis = (national_taxable + max(0, national_basic - 480000))//1000*1000
        resident_housing = min(possible-used, 97500, basis*5//100)
        one_stop = independent_one_stop_after_housing(
            nominal_thousand_yen=nominal["thousand_yen_reference"],
            resident_income_levy=nominal["resident_income_levy"],
            resident_mortgage_credit=resident_housing,
        )["one_stop_effective_thousand_yen_reference"]
        scenarios.append((municipality, one_stop))
    selected_municipality, conservative = min(scenarios, key=lambda x: x[1])
    higher_filing = None
    # A tax-return comparator never alters the default one-stop number.
    # Only tax-return conditions independently comparable to the slip may
    # produce a conditional filing benefit note. No assumption is made about
    # the recipient's actual need to file or additional income.
    try:
        filing = [
            independent_mortgage_filing_ceiling(
                year=source_year, salary_income=salary_income,
                national_deductions=national_deductions,
                resident_deductions=resident_deductions,
                mortgage_possible=possible, occupancy_year=occupancy,
                personal_difference=50_000, municipality=municipality
            )["tax_return_thousand_yen_reference"]
            for municipality in municipalities
        ]
        if (len(set(filing)) == 1 and filing[0] > max(v for _,v in scenarios)
                and filing[0] > 2000):
            higher_filing = filing[0]
    except (ValueError, TypeError):
        pass
    return {"one_stop_limit": conservative,
            "selected_municipality": selected_municipality,
            "filing_higher_limit": higher_filing,
            "mortgage_applied_national": used,
            "mortgage_resident_transfer": min(
                possible - used, 97500,
                (national_taxable + max(0, national_basic-480000))//1000*1000*5//100),
            "model_locality": municipality_class if municipality_class in
                ("STANDARD", "DESIGNATED") else "UNCERTAIN"}
