"""Reconcile source-year deductions, then project *distinct* target-year amounts.

Public code contains no real tax-slip data. A prior year's ordinary-spouse,
under-16-family and insurance-premium conditions are model assumptions, not
proof of the next year's facts. Unsupported categories fail closed.
"""
from audit_salary_donation_limit import BASIC
from bulk_salary_only import _life_deductions


class MortgageDeductionError(ValueError):
    """The withholding-slip deductions cannot be reconstructed safely."""


def reconcile_mortgage_deductions(fields, source_year, target_year,
                                  source_basic, source_salary, target_salary):
    if source_year not in (2025, 2026) or target_year not in (2025, 2026):
        raise MortgageDeductionError("MORTGAGE_DEDUCTION_DETAIL_REVIEW")
    if not isinstance(fields, dict):
        raise MortgageDeductionError("MORTGAGE_DEDUCTION_DETAIL_REVIEW")
    if any(type(fields.get(k)) is not int for k in
           ("social_insurance", "deductions_reference")):
        raise MortgageDeductionError("MORTGAGE_DEDUCTION_DETAIL_REVIEW")
    if any(type(v) is not int or v < 0 for v in
           (source_basic, source_salary, target_salary)):
        raise MortgageDeductionError("MORTGAGE_DEDUCTION_DETAIL_REVIEW")
    source_basic_expected = next(
        (amount for ceiling, amount in BASIC[source_year]
         if source_salary <= ceiling), None)
    target_basic = next(
        (amount for ceiling, amount in BASIC[target_year]
         if target_salary <= ceiling), None)
    if source_basic != source_basic_expected or target_basic is None:
        raise MortgageDeductionError("MORTGAGE_BASIC_DEDUCTION_REVIEW")

    children = fields.get("under16_count", 0)
    if type(children) is not int or not 0 <= children <= 30:
        raise MortgageDeductionError("MORTGAGE_FAMILY_DEDUCTION_REVIEW")
    # A declared under-16 dependent stays under 23 in the following year.
    # Whether the person remains eligible is an explicit projection assumption.
    source_under23 = source_year == 2026 and children > 0
    target_under23 = target_year == 2026 and children > 0
    try:
        source_life, _ = _life_deductions(
            fields, year=source_year, eligible_under23=source_under23)
        target_life, target_resident_life = _life_deductions(
            fields, year=target_year, eligible_under23=target_under23)
    except (ValueError, TypeError):
        raise MortgageDeductionError("MORTGAGE_LIFE_PREMIUM_REVIEW") from None
    if fields.get("life_deduction_reference", 0) != source_life:
        raise MortgageDeductionError("MORTGAGE_LIFE_PREMIUM_REVIEW")

    quake = fields.get("earthquake_deduction_reference", 0)
    old_long = fields.get("old_long_premium_reference", 0)
    if (type(quake) is not int or not 0 <= quake <= 50_000
            or type(old_long) is not int or old_long < 0):
        raise MortgageDeductionError("MORTGAGE_EARTHQUAKE_REVIEW")
    if old_long:
        # G28 alone cannot allocate mixed ordinary/old-long relief.
        raise MortgageDeductionError("MORTGAGE_EARTHQUAKE_REVIEW")
    # With no old-long premium, G28<50k equals ordinary earthquake premium.
    # The resident-tax deduction is half, rounded up, capped at 25k.
    resident_quake = min((quake + 1) // 2, 25_000)

    source_spouse = 0
    resident_spouse = 0
    spouse_amount = fields.get("spouse_deduction_reference")
    spouse_income = fields.get("spouse_income_reference")
    if spouse_amount is not None or spouse_income is not None:
        # G13=380k and G43<=income threshold establish an ordinary spouse
        # only in the first income band. Do not silently infer elderly spouse,
        # special-spouse, or other unreported family conditions.
        source_limit = 580_000 if source_year == 2025 else 620_000
        if (type(spouse_amount) is not int
                or type(spouse_income) is not int
                or spouse_amount != 380_000
                or not 0 <= spouse_income <= source_limit
                or source_salary > 9_000_000
                or target_salary > 9_000_000):
            raise MortgageDeductionError("MORTGAGE_SPOUSE_DEDUCTION_REVIEW")
        source_spouse, resident_spouse = 380_000, 330_000

    # Other adult dependents and exceptional deductions have not been
    # independently reconstructed from the source PDF.
    if any(fields.get(k, 0) not in (0, None) for k in
           ("special_relative_count", "special_relative_deduction_reference",
            "income_adjustment")):
        raise MortgageDeductionError("MORTGAGE_FAMILY_DEDUCTION_REVIEW")

    social = fields["social_insurance"]
    source_national = social + source_basic + source_life + quake + source_spouse
    if fields["deductions_reference"] != source_national:
        raise MortgageDeductionError("MORTGAGE_DEDUCTION_DETAIL_REVIEW")

    return {
        "source_national": source_national,
        "target_basic": target_basic,
        "target_national": social + target_basic + target_life + quake + source_spouse,
        "target_resident": (social + 430_000 + target_resident_life
                            + resident_quake + resident_spouse),
        "prior_year_under23_life_assumed": (
            target_year != source_year and target_under23),
        "prior_year_spouse_assumed": (
            target_year != source_year and source_spouse > 0),
        "mortgage_possible_unchanged": target_year != source_year,
    }
