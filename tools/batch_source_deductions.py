"""Reconcile source-year deductions, then project *distinct* target-year amounts.

Public code contains no real tax-slip data. A prior year's ordinary-spouse,
under-16-family and insurance-premium conditions are model assumptions, not
proof of the next year's facts. Unsupported categories fail closed.
"""
from audit_salary_donation_limit import BASIC
from bulk_salary_only import _life_deductions


class MortgageDeductionError(ValueError):
    """The withholding-slip deductions cannot be reconstructed safely."""



# Reviewed ordinary family deduction amounts: income tax / resident tax /
# personal difference. NTA No.1180; municipality human-difference tables.
_FAMILY_RATES = {
    "dependent_general_count": (380_000, 330_000, 50_000),
    "dependent_special_count": (630_000, 450_000, 180_000),
    "dependent_elderly_count": (480_000, 380_000, 100_000),
    "dependent_cohabiting_elderly_count": (580_000, 450_000, 130_000),
}


def reviewed_family_details(fields, source_year, target_year):
    """Do not guess a dependent's age or source/target eligibility.

    A general dependent may be 16-18 OR 23+, so a new-life premium in 2026
    needs an explicit 0/1 under-23 confirmation unless an under-16 or
    special dependent already proves the age condition.
    """
    counts = {}
    for key in _FAMILY_RATES:
        value = fields.get(key, 0)
        if type(value) is not int or not 0 <= value <= 30:
            raise MortgageDeductionError("MORTGAGE_FAMILY_DEDUCTION_REVIEW")
        counts[key] = value
    under16 = fields.get("under16_count", 0)
    if type(under16) is not int or not 0 <= under16 <= 30:
        raise MortgageDeductionError("MORTGAGE_FAMILY_DEDUCTION_REVIEW")
    if under16 + sum(counts.values()) > 30:
        raise MortgageDeductionError("MORTGAGE_FAMILY_DEDUCTION_REVIEW")
    flag = fields.get("under23_life_eligible_flag")
    if flag is not None and (type(flag) is not int or flag not in (0, 1)):
        raise MortgageDeductionError("MORTGAGE_FAMILY_DEDUCTION_REVIEW")
    known = under16 > 0 or counts["dependent_special_count"] > 0
    if flag == 0 and known:
        raise MortgageDeductionError("MORTGAGE_FAMILY_DEDUCTION_REVIEW")
    if flag == 1 and not (known or counts["dependent_general_count"] > 0):
        raise MortgageDeductionError("MORTGAGE_FAMILY_DEDUCTION_REVIEW")
    if (flag is None and counts["dependent_general_count"] > 0
            and not known and fields.get("life_new", 0)
            and 2026 in (source_year, target_year)):
        raise MortgageDeductionError("MORTGAGE_FAMILY_DEDUCTION_REVIEW")
    return {
        "national": sum(counts[k] * v[0] for k, v in _FAMILY_RATES.items()),
        "resident": sum(counts[k] * v[1] for k, v in _FAMILY_RATES.items()),
        "personal_difference": 50_000 + sum(
            counts[k] * v[2] for k, v in _FAMILY_RATES.items()),
        "family_count": under16 + sum(counts.values()),
        "has_eligible_under23": known or flag == 1,
        "has_adult_dependents": sum(counts.values()) > 0,
    }


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
    # Entered family counts remain a next-year projection assumption.
    family = reviewed_family_details(fields, source_year, target_year)
    source_under23 = source_year == 2026 and family["has_eligible_under23"]
    target_under23 = target_year == 2026 and family["has_eligible_under23"]
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
    spouse_inferred = False
    spouse_amount = fields.get("spouse_deduction_reference")
    spouse_income = fields.get("spouse_income_reference")
    if spouse_amount is None and type(spouse_income) is int:
        # Some native PDFs print G13 immediately *after* its amount, so a
        # strict right-of-anchor extractor can omit it. Infer the 380k
        # ordinary-spouse relief ONLY when G09 confirms spouse presence,
        # G43 confirms low spouse income and the entire remaining G06
        # difference is exactly 380k. It is still a source assumption.
        residual = (fields["deductions_reference"] - fields["social_insurance"]
                    - source_basic - source_life - quake)
        if fields.get("spouse_eligibility_flag") == 1 and residual == 380_000:
            spouse_amount = residual
            spouse_inferred = True
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
    source_national = (social + source_basic + source_life + quake
                       + source_spouse + family["national"])
    if fields["deductions_reference"] != source_national:
        raise MortgageDeductionError("MORTGAGE_DEDUCTION_DETAIL_REVIEW")

    return {
        "source_national": source_national,
        "target_basic": target_basic,
        "target_national": (social + target_basic + target_life + quake
                            + source_spouse + family["national"]),
        "target_resident": (social + 430_000 + target_resident_life
                            + resident_quake + resident_spouse + family["resident"]),
        "personal_difference": (family["personal_difference"]
                                + (50_000 if source_spouse else 0)),
        "family_count": family["family_count"] + (1 if source_spouse else 0),
        "prior_year_adult_dependents_assumed": (
            target_year != source_year and family["has_adult_dependents"]),
        "prior_year_under23_life_assumed": (
            target_year != source_year and target_under23),
        "prior_year_spouse_assumed": (
            target_year != source_year and source_spouse > 0),
        "source_spouse_inferred_from_total": spouse_inferred,
        "mortgage_possible_unchanged": target_year != source_year,
    }
