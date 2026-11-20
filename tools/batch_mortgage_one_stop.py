"""Conservative salary-only mortgage one-stop estimate and filing comparison.

All outputs are provisional model references, not verified personal taxes.
Use a reconciled source-year wage and a single 2023+ mortgage claim.
For a following-year projection keep the source mortgage-possible amount
unchanged, but recalculate its national/resident split for the target tax year.
Unsupported eligibility and deductions are never verified benefits.
"""
from audit_salary_donation_limit import (
    independent_salary_ceiling, independent_one_stop_after_housing,
    independent_nta_fifth_table_salary_income,
)
from audit_mortgage_filing import independent_mortgage_filing_ceiling
from audit_withholding_reconciliation import progressive_income_tax, reconcile
from batch_source_deductions import MortgageDeductionError, reconcile_mortgage_deductions
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
    if (type(source_year) is not int or type(target_year) is not int
            or source_year not in (2025, 2026)
            or target_year not in (2025, 2026)
            or source_year > target_year or target_year - source_year > 1):
        raise MortgageBatchScopeError("MORTGAGE_TAX_YEAR_UNSUPPORTED")
    if not all(type(value) is int for value in
               (salary_income, national_deductions, resident_deductions,
                national_basic)):
        raise MortgageBatchScopeError("MORTGAGE_DEDUCTIONS_NOT_RECONCILED")
    if (type(fields.get("salary_gross")) is not int or
            fields.get("income_adjustment", 0) != 0 or
            fields.get("salary_reference") !=
            independent_nta_fifth_table_salary_income(
                source_year, fields["salary_gross"]) or
            salary_income != independent_nta_fifth_table_salary_income(
                target_year, fields["salary_gross"])):
        raise MortgageBatchScopeError("MORTGAGE_SALARY_OR_FAMILY_UNVERIFIED")
    source_basic = fields.get("basic_reference")
    if source_basic is None:
        from audit_salary_donation_limit import BASIC
        source_basic = next(
            (v for upper, v in BASIC[source_year]
             if fields["salary_reference"] <= upper), None)
    try:
        d = reconcile_mortgage_deductions(
            fields, source_year, target_year, source_basic,
            fields["salary_reference"], salary_income)
    except MortgageDeductionError as exc:
        raise MortgageBatchScopeError(str(exc)) from None
    if (national_deductions != d["target_national"]
            or resident_deductions != d["target_resident"]
            or national_basic != d["target_basic"]):
        raise MortgageBatchScopeError("MORTGAGE_DEDUCTIONS_NOT_RECONCILED")
    from audit_salary_donation_limit import resident_income_levy_exemption_limit
    if salary_income <= resident_income_levy_exemption_limit(
            fields.get("under16_count", 0)):
        raise MortgageBatchScopeError("MORTGAGE_FAMILY_DEDUCTION_REVIEW")
    claim_count = fields.get("mortgage_claim_count")
    if type(claim_count) is not int or claim_count != 1:
        # An absent G35 is NOT proof of only one housing credit. Avoid
        # inadvertently combining multiple homes/renovation deductions.
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
    # Compare the original G29 with original tax, not target-year tax.
    source_taxable = max(
        0, fields["salary_reference"] - d["source_national"]) // 1000 * 1000
    source_national_tax = progressive_income_tax(source_taxable)
    national_taxable = max(0, salary_income - national_deductions)//1000*1000
    national_tax = progressive_income_tax(national_taxable)
    target_used = min(possible, national_tax)
    # In the NTA slip the "possible" amount can be omitted when the full
    # credit is consumed by income tax. But if the national liability is
    # *fully* used, an omitted possible amount leaves the resident carryover
    # unknown. Do not equate actual applied with total allowable credit.
    if "mortgage_possible_credit" not in fields and used >= source_national_tax:
        raise MortgageBatchScopeError("MORTGAGE_POSSIBLE_CREDIT_REQUIRED")
    if used != min(possible, source_national_tax):
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
            year=target_year, salary_income=salary_income,
            resident_deductions=resident_deductions,
            personal_difference=50_000, municipality=municipality)
        # Reject special high-rate schemes unsupported by the one-stop
        # equivalent income-tax-rate calculation.
        if nominal["special_ratio"] < Fraction(56307, 100000):
            raise MortgageBatchScopeError("MORTGAGE_HIGH_RATE_UNVERIFIED")
        basis = (national_taxable + max(0, national_basic - 480000))//1000*1000
        resident_housing = min(possible-target_used, 97500, basis*5//100)
        one_stop = independent_one_stop_after_housing(
            nominal_thousand_yen=nominal["thousand_yen_reference"],
            resident_income_levy=nominal["resident_income_levy"],
            resident_mortgage_credit=resident_housing,
        )["one_stop_effective_thousand_yen_reference"]
        scenarios.append((municipality, one_stop))
    selected_municipality, conservative = min(scenarios, key=lambda x: x[1])
    higher_filing = None
    filing_limit = None
    # A tax-return comparator never alters the default one-stop number.
    # Only tax-return conditions independently comparable to the slip may
    # produce a conditional filing benefit note. No assumption is made about
    # the recipient's actual need to file or additional income.
    try:
        filing = [
            independent_mortgage_filing_ceiling(
                year=target_year, salary_income=salary_income,
                national_deductions=national_deductions,
                resident_deductions=resident_deductions,
                mortgage_possible=possible, occupancy_year=occupancy,
                personal_difference=50_000, municipality=municipality
            )["tax_return_thousand_yen_reference"]
            for municipality in municipalities
        ]
        if len(set(filing)) == 1:
            # Show the filing reference EVEN when it equals or is below
            # one-stop. Disagreeing ordinary city-class scenarios remain
            # blank rather than inventing a particular municipality.
            filing_limit = filing[0]
            if filing_limit > max(v for _,v in scenarios) and filing_limit > 2000:
                higher_filing = filing_limit
    except (ValueError, TypeError):
        pass
    return {"one_stop_limit": conservative,
            "selected_municipality": selected_municipality,
            "filing_higher_limit": higher_filing,
            "filing_limit": filing_limit,
            "mortgage_applied_national": target_used,
            "mortgage_resident_transfer": min(
                possible - target_used, 97500,
                (national_taxable + max(0, national_basic-480000))//1000*1000*5//100),
            "model_locality": municipality_class if municipality_class in
                ("STANDARD", "DESIGNATED") else "UNCERTAIN"}
