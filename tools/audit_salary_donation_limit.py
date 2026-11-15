"""Independent *synthetic-only* salary resident-tax and donation-cap oracle.

Ordinary salary income, no other income or tax credits. Inputs must have been
independently verified: this function never reads a taxpayer's documents.
This is not a real taxpayer's approved furusato-nozei limit.

Sources: NTA No.1155; city tax-credit explanations (resident special 20% cap).
"""
from fractions import Fraction

# Inclusive total salary-income thresholds for income-tax basic deduction.
BASIC = {
    2025: ((1320000,950000),(3360000,880000),(4890000,680000),
           (6550000,630000),(23500000,580000),(24000000,480000),
           (24500000,320000),(25000000,160000)),
    2026: ((1320000,1040000),(3360000,1040000),(4890000,1040000),
           (6550000,670000),(23500000,620000),(24000000,480000),
           (24500000,320000),(25000000,160000)),
}
# Ordinary taxable-income bracket and resident special deduction fraction.
SPECIAL_RATES = ((1950000,84895),(3300000,79790),(6950000,69580),
                 (9000000,66517),(18000000,56307),(40000000,49160),
                 (10**15,44055))


def independent_under23_salary_adjustment(salary_gross, *, has_eligible_under23):
    """NTA No.1411: exact integer 1-yen round-up for a verified child.

    Only the confirmed under-23 family path, not the separate disability
    eligibility routes. This is a synthetic-only crosscheck; it never
    establishes the existence of a qualifying dependent.
    """
    if type(salary_gross) is not int or not 0 <= salary_gross <= 10**12:
        raise ValueError("INVALID_SALARY_GROSS")
    if type(has_eligible_under23) is not bool:
        raise ValueError("UNVERIFIED_DEPENDENT_STATUS")
    if not has_eligible_under23 or salary_gross <= 8_500_000:
        return 0
    amount = min(salary_gross, 10_000_000) - 8_500_000
    return (amount + 9) // 10


def independent_salary_ceiling(*, year, salary_income, resident_deductions,
                               personal_difference=50000, municipality="standard"):
    """Exact rational reference for a limited salary-only synthetic scenario.

    resident_deductions MUST include the resident basic deduction and must be
    independently reviewed. Local non-taxable thresholds, special conditions,
    tax credits, filing selections and 1-yen real-taxpayer rounding are outside
    this oracle's coverage.
    """
    if type(year) is not int or year not in BASIC:
        raise ValueError("UNAPPROVED_YEAR")
    for value in (salary_income, resident_deductions, personal_difference):
        if type(value) is not int or value < 0 or value > 10**12:
            raise ValueError("INVALID_AMOUNTS")
    if municipality not in ("standard", "designated"):
        raise ValueError("UNSUPPORTED_MUNICIPALITY")
    # Even without knowing family composition, income of at most ¥450,000
    # is below the nationwide resident income-levy exemption for everyone.
    # Never create a positive-looking cap from a positive taxable base.
    if salary_income <= 450_000:
        raise ValueError("INCOME_LEVY_EXEMPT_NO_DONATION_CAP")
    if salary_income > 25000000:
        raise ValueError("HIGH_INCOME_SPECIAL_CASE")
    if resident_deductions > salary_income:
        raise ValueError("NON_TAXABLE_CASE_NOT_MODELLED")

    national_basic = next((v for upper,v in BASIC[year]
                           if salary_income <= upper), 0)
    taxable = max(0, salary_income - resident_deductions) // 1000 * 1000
    if taxable <= 0:
        raise ValueError("ZERO_RESIDENT_TAXABLE_INCOME")
    adjustment_basis = (min(personal_difference, taxable)
                        if taxable <= 2000000 else
                        max(50000,personal_difference - taxable + 2000000))
    adjustment = min(Fraction(taxable,10), Fraction(adjustment_basis,20))
    gross = Fraction(taxable,10)
    city_share = Fraction(3,5) if municipality == "standard" else Fraction(4,5)
    shares = (city_share, 1-city_share)
    # City/prefecture levies are floored to ¥100 separately.
    parts = tuple(int((gross - adjustment)*share // 100)*100 for share in shares)
    levy = sum(parts)
    if levy <= 0:
        raise ValueError("NO_REMAINING_INCOME_LEVY")
    rate_basis = taxable - personal_difference - max(0,national_basic - 480000)
    # The resident-tax special ratio is 90%, not 84.895%, when
    # the local taxable basis minus personal/basic differences is NEGATIVE.
    # The zero boundary itself uses the first 84.895% band.
    ratio = (Fraction(9,10) if rate_basis < 0
             else next(Fraction(rate,100000) for upper,rate in SPECIAL_RATES
                       if rate_basis <= upper))
    cap = Fraction(levy,5)
    special_boundary = 2000 + cap / ratio
    resident_donation_income_cap = Fraction(salary_income*3,10)
    upper = min(special_boundary, resident_donation_income_cap)
    thousand = max(0,int(upper)//1000*1000)
    return {"scope":"SYNTHETIC_ONLY", "donation_limit":"NOT_VERIFIED",
            "national_basic_deduction":national_basic,
            "resident_taxable_income":taxable,
            "resident_income_levy":levy,
            "resident_income_levy_parts":parts,
            "special_ratio":ratio,
            "special_20pct_cap":cap,
            "theoretical_ceiling":upper,
            "thousand_yen_reference":thousand}


# Reviewed minimum national/resident deduction anchors for separately
# confirmed eligible family members. These do NOT establish a relative's
# actual age, income, cohabitation or eligibility from a withholding slip.
FAMILY = {
    "spouse_ordinary": (380000,330000,50000),
    "spouse_elderly": (480000,380000,100000),
    "dependent_general": (380000,330000,50000),
    "dependent_special": (630000,450000,180000),
    "dependent_elderly": (480000,380000,100000),
    "dependent_cohabiting_elderly": (580000,450000,130000),
}


# For independently established spouse eligibility, deductions still vary by
# taxpayer's total income. The three columns are national, resident, and the
# statutory difference used for adjustment credits.
# NTA No.1191; city individual resident-tax human-difference tables.
SPOUSE_BY_TAXPAYER_INCOME = {
    "ordinary": ((9_000_000, (380_000, 330_000, 50_000)),
                 (9_500_000, (260_000, 220_000, 40_000)),
                 (10_000_000, (130_000, 110_000, 20_000))),
    "elderly": ((9_000_000, (480_000, 380_000, 100_000)),
                (9_500_000, (320_000, 260_000, 60_000)),
                (10_000_000, (160_000, 130_000, 30_000))),
}


def resident_income_levy_exemption_limit(family_count):
    """Nationally uniform income-levy exemption (not equal-levy threshold).

    Family includes eligible same-livelihood spouse AND dependents under 16.
    Salary-income only; the independently confirmed family composition is a
    prerequisite. Does not evaluate a taxpayer's protected-status exemptions.
    """
    if type(family_count) is not int or not 0 <= family_count <= 30:
        raise ValueError("INVALID_FAMILY_COUNT")
    return (450_000 if family_count == 0
            else 350_000 * (family_count + 1) + 420_000)


def verified_family_deductions(*, year, salary_income, social_insurance,
                               spouse="none", general=0, special=0, elderly=0,
                               cohabiting_elderly=0, under16=0):
    """Tax deductions only for a hypothetical independently eligible family.

    Personal difference includes the statutory ¥50,000 base used for
    adjustment credit; an under-16 child adds no ordinary tax deduction.
    """
    if type(year) is not int or year not in BASIC:
        raise ValueError("UNAPPROVED_YEAR")
    for val in (salary_income,social_insurance):
        if type(val) is not int or not 0<=val<=10**12:
            raise ValueError("INVALID_AMOUNTS")
    for val in (general,special,elderly,cohabiting_elderly,under16):
        if type(val) is not int or not 0<=val<=30:
            raise ValueError("INVALID_FAMILY_COUNT")
    if general+special+elderly+cohabiting_elderly+under16>30:
        raise ValueError("FAMILY_COUNT_EXCEEDS_REVIEW")
    if spouse not in ("none","ordinary","elderly"):
        raise ValueError("UNKNOWN_SPOUSE_CATEGORY")
    # This oracle has no non-salary income; salary income is total income.
    if spouse!="none" and salary_income>10_000_000:
        raise ValueError("SPOUSE_INCOME_LIMIT")
    if salary_income>25_000_000:
        raise ValueError("HIGH_INCOME_SPECIAL_CASE")
    basic=next(v for upper,v in BASIC[year] if salary_income<=upper)
    components=[]
    if spouse!="none":
        components.append(next(d for upper,d in
                               SPOUSE_BY_TAXPAYER_INCOME[spouse]
                               if salary_income<=upper))
    for key,count in (("dependent_general",general),("dependent_special",special),
                      ("dependent_elderly",elderly),
                      ("dependent_cohabiting_elderly",cohabiting_elderly)):
        components.extend([FAMILY[key]]*count)
    national=social_insurance+basic+sum(item[0] for item in components)
    resident=social_insurance+430_000+sum(item[1] for item in components)
    difference=50_000+sum(item[2] for item in components)
    family_count=(int(spouse!="none")+general+special+elderly+
                  cohabiting_elderly+under16)
    exemption_limit=resident_income_levy_exemption_limit(family_count)
    return {"national_deductions":national,"resident_deductions":resident,
            "personal_difference":difference,"national_basic":basic,
            "under16_count":under16,
            "resident_income_levy_exemption_limit":exemption_limit,
            "resident_income_levy_exempt":salary_income<=exemption_limit,
            "scope":"SYNTHETIC_ONLY"}


def independent_family_mortgage_case(*, year, salary_income, social_insurance,
                                     mortgage_possible=0, occupancy_year=None,
                                     spouse="none", general=0, special=0,
                                     elderly=0, cohabiting_elderly=0, under16=0,
                                     municipality="standard"):
    """Independent source-free combined test: salary, family, and 5% housing.

    2022 exceptional 7% acquisition class, multiple mortgage claims, other
    credits, and real taxpayer 1-yen donation outcomes remain out of scope.
    """
    values=verified_family_deductions(
        year=year,salary_income=salary_income,social_insurance=social_insurance,
        spouse=spouse,general=general,special=special,elderly=elderly,
        cohabiting_elderly=cohabiting_elderly,under16=under16)
    # A positive taxable-income figure is not enough to establish an income
    # levy: the family-based income exemption is tested BEFORE the formula.
    if values["resident_income_levy_exempt"]:
        raise ValueError("INCOME_LEVY_EXEMPT_NO_DONATION_CAP")
    limit=independent_salary_ceiling(
        year=year,salary_income=salary_income,
        resident_deductions=values["resident_deductions"],
        personal_difference=values["personal_difference"],
        municipality=municipality)
    if type(mortgage_possible) is not int or not 0<=mortgage_possible<=10**12:
        raise ValueError("INVALID_MORTGAGE_AMOUNT")
    if mortgage_possible>0 and (
        type(occupancy_year) is not int or not 2023<=occupancy_year<=year):
        raise ValueError("UNVERIFIED_MORTGAGE_CLASS")
    from audit_withholding_reconciliation import progressive_income_tax
    national_taxable=max(0,salary_income-values["national_deductions"])//1000*1000
    national_before_credit=progressive_income_tax(national_taxable)
    applied=min(mortgage_possible,national_before_credit)
    delta=(max(0,values["national_basic"]-480000)
           if mortgage_possible>0 and occupancy_year<=2025 else 0)
    cap_basis=(national_taxable+delta)//1000*1000
    housing_transfer=min(mortgage_possible-applied,97500,cap_basis*5//100)
    return {**values,**limit,
            "national_taxable_income":national_taxable,
            "national_income_tax_before_credit":national_before_credit,
            "housing_applied_national":applied,
            "housing_resident_transfer":housing_transfer,
            "housing_5pct_cap_basis":cap_basis,
            "donation_limit":"NOT_VERIFIED"}
