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
    ratio = next(Fraction(rate,100000) for upper,rate in SPECIAL_RATES
                 if rate_basis <= upper)
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
