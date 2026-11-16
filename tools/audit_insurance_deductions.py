"""Independent national/resident insurance deductions for salary-only audit.

Inputs are separately verified *paid premiums*, not the withholding-slip
deduction box. Public CI must use synthetic data only. Exact integer ceilings
mirror NTA No.1140/1145 and Kyoto's individual-resident-tax tables.

2026's enhanced new-life deduction for a dependent under 23 is deliberately
not assumed: this limited comparator requires its absence to be confirmed.
"""
from fractions import Fraction

PREMIUM_KEYS = (
    "new_life", "old_life", "care", "new_pension", "old_pension",
    "earthquake", "old_long",
)
INSURANCE_KEYS = PREMIUM_KEYS + (
    "life_reference", "earthquake_reference",
    "distinct_earthquake_contracts_confirmed",
    "no_2026_under23_life_exception_confirmed",
)


def _ceil_fraction(value):
    return (value.numerator + value.denominator - 1) // value.denominator


def _new(paid, *, resident):
    if resident:
        bounds = (12_000, 32_000, 56_000)
        values = (6_000, 14_000, 28_000)
    else:
        bounds = (20_000, 40_000, 80_000)
        values = (10_000, 20_000, 40_000)
    if paid <= bounds[0]:
        return paid
    if paid <= bounds[1]:
        return _ceil_fraction(Fraction(paid, 2) + values[0])
    if paid <= bounds[2]:
        return _ceil_fraction(Fraction(paid, 4) + values[1])
    return values[2]


def _old(paid, *, resident):
    if resident:
        bounds = (15_000, 40_000, 70_000)
        values = (7_500, 17_500, 35_000)
    else:
        bounds = (25_000, 50_000, 100_000)
        values = (12_500, 25_000, 50_000)
    if paid <= bounds[0]:
        return paid
    if paid <= bounds[1]:
        return _ceil_fraction(Fraction(paid, 2) + values[0])
    if paid <= bounds[2]:
        return _ceil_fraction(Fraction(paid, 4) + values[1])
    return values[2]


def _insurance_category(new_paid, old_paid, *, resident):
    n, o = _new(new_paid, resident=resident), _old(old_paid, resident=resident)
    if new_paid and old_paid:
        return max(o, min(n + o, 28_000 if resident else 40_000))
    return n if new_paid else o


def _old_long(paid, *, resident):
    if resident:
        if paid <= 5_000:
            return paid
        if paid <= 15_000:
            return _ceil_fraction(Fraction(paid, 2) + 2_500)
        return 10_000
    if paid <= 10_000:
        return paid
    if paid <= 20_000:
        return _ceil_fraction(Fraction(paid, 2) + 5_000)
    return 15_000


def calculate_insurance(*, year, record):
    """Return both years' confirmed deductions; fail closed on unknown keys.

    'life_reference' and 'earthquake_reference' are transcribed national
    *deduction amounts* on the slip. Other money fields are paid premiums
    independently confirmed against insurance statements/receipts.
    """
    if type(year) is not int or year not in (2025, 2026):
        raise ValueError("UNAPPROVED_YEAR")
    if not isinstance(record, dict) or set(record) != set(INSURANCE_KEYS):
        raise ValueError("INSURANCE_FIELDS_MISSING_OR_UNEXPECTED")
    if any(type(record[k]) is not int or not 0 <= record[k] <= 10**9
           for k in PREMIUM_KEYS + ("life_reference", "earthquake_reference")):
        raise ValueError("INVALID_INSURANCE_AMOUNT")
    if record["distinct_earthquake_contracts_confirmed"] is not True:
        raise ValueError("UNVERIFIED_EARTHQUAKE_CONTRACTS")
    if year == 2026 and record["no_2026_under23_life_exception_confirmed"] is not True:
        raise ValueError("UNVERIFIED_2026_LIFE_DEDUCTION_EXCEPTION")
    if type(record["no_2026_under23_life_exception_confirmed"]) is not bool:
        raise ValueError("INVALID_UNDER23_CONFIRMATION")
    result = {}
    for resident, title in ((False, "national"), (True, "resident")):
        general = _insurance_category(record["new_life"], record["old_life"],
                                      resident=resident)
        care = _new(record["care"], resident=resident)
        pension = _insurance_category(record["new_pension"], record["old_pension"],
                                      resident=resident)
        life = min(general + care + pension, 70_000 if resident else 120_000)
        earthquake = min(
            (min(_ceil_fraction(Fraction(record["earthquake"], 2)), 25_000) if resident
             else min(record["earthquake"], 50_000))
            + _old_long(record["old_long"], resident=resident),
            25_000 if resident else 50_000)
        result[title+"_life"] = life
        result[title+"_earthquake"] = earthquake
    if (result["national_life"] != record["life_reference"]
            or result["national_earthquake"] != record["earthquake_reference"]):
        raise ValueError("SLIP_INSURANCE_DEDUCTIONS_NOT_RECONCILED")
    return result
