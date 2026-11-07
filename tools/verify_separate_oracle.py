"""Independent fixture oracle using rational amounts and marginal bands.

Run with --write only after reviewing the cited tax sources. Ordinary
progressive tax is calculated by slices. Resident credits use Fraction,
rather than the fixed-point model used by the workbook and GAS.
"""
from fractions import Fraction
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "taxdata/separate-tax-cases-v1.json"
KINDS = ("ordinary", "shortLand", "longLand", "listedDividend", "generalStock", "listedStock", "futures")
BANDS = ((1950000, 5), (3300000, 10), (6950000, 20), (9000000, 23), (18000000, 33), (40000000, 40), (10**9, 45))
RATIO = (84895, 79790, 69580, 66517, 56307, 49160, 44055)


def allocate(incomes, deduction):
    used = []
    taxable = []
    for income in incomes:
        applied = min(deduction, income)
        deduction -= applied
        used.append(applied)
        taxable.append((income - applied) // 1000 * 1000)
    return used, taxable, deduction


def annual(taxable):
    ordinary, short, *flat = taxable
    tax = short * 3 // 10 + sum(flat) * 15 // 100
    lower = 0
    for upper, rate in BANDS:
        tax += max(0, min(ordinary, upper) - lower) * rate // 100
        lower = upper
    return tax + tax * 21 // 1000


def oracle(case):
    incomes = [case[k] for k in KINDS]
    total = sum(incomes)
    year = case["year"]
    national = case["nationalDeductions"]
    resident = case["residentDeductions"]
    gap = case["personalDifference"]
    if total <= 1320000:
        basic = 950000 if year == 2025 else 1040000
    elif total <= 3360000:
        basic = 880000 if year == 2025 else 1040000
    elif total <= 4890000:
        basic = 680000 if year == 2025 else 1040000
    elif total <= 6550000:
        basic = 630000 if year == 2025 else 670000
    else:
        basic = 580000 if year == 2025 else 620000
    n_used, n_taxable, n_unused = allocate(incomes, national)
    r_used, r_taxable, r_unused = allocate(incomes, resident)
    ordinary, short, *other = r_taxable
    adjustment_base = min(gap, ordinary) if ordinary <= 2000000 else max(50000, gap - ordinary + 2000000)
    gross = Fraction(ordinary, 10) + Fraction(short * 9, 100) + Fraction(sum(other), 20)
    levy = gross - Fraction(adjustment_base, 20)
    jurisdictions = [levy * Fraction(3, 5), levy * Fraction(2, 5)]
    base_resident = sum(math.floor(t / 100) * 100 for t in jurisdictions)
    base_income = annual(n_taxable)
    discriminator = ordinary - gap - max(0, basic - 480000)
    if ordinary > 0 and discriminator >= 0:
        ratio = next(r for (upper, _), r in zip(BANDS, RATIO) if discriminator <= upper)
    else:
        ratio = 59370 if incomes[1] else 74685

    def evaluate(donation):
        applied = max(0, min(donation, total * 2 // 5) - 2000)
        after = annual(allocate(incomes, national + applied)[1])
        basic_credit = max(Fraction(0), min(Fraction(donation), Fraction(3 * total, 10)) - 2000) / 10
        special = Fraction(max(0, donation - 2000) * ratio, 100000)
        local_after = 0
        for current, share in zip(jurisdictions, (Fraction(3, 5), Fraction(2, 5))):
            credit = math.ceil(basic_credit * share + min(special * share, current / 5))
            local_after += max(0, math.floor((current - credit) / 100) * 100)
        return after, local_after, donation - (base_income - after) - (base_resident - local_after)

    # Wider than the product search bound; catches erroneous truncation.
    limit = max((d for d in range(3000, 1250001, 1000) if evaluate(d)[2] <= 2000), default=0)
    after_income, after_resident, net_cost = evaluate(case["donation"])
    return dict(nationalApplied=n_used, residentApplied=r_used, nationalTaxable=n_taxable,
                residentTaxable=r_taxable, nationalUnused=n_unused, residentUnused=r_unused,
                nationalBefore=base_income, residentBefore=base_resident, ratio=ratio,
                nationalAfter=after_income, residentAfter=after_resident, netCost=net_cost, limit=limit)


def cases():
    common = ((0, 1000000), (0, 6000000), (1000000, 1000000), (1000000, 1500000),
              (2000000, 3000000), (2000000, 7000000), (2000000, 8000000), (5000000, 3000000))

    def one(year, name, ordinary=0, nd=1000000, rd=None, donation=30000, **split):
        params = dict.fromkeys(KINDS, 0)
        params.update(split or {"listedStock": 5000000})
        params.update(ordinary=ordinary, year=year, nationalDeductions=nd, residentDeductions=nd if rd is None else rd,
                      personalDifference=50000, donation=donation, filing="return", conditions="reviewed", mode="separate")
        return {"id": f"{year}-{name}", "input": params, "expected": oracle(params)}

    for year in (2025, 2026):
        for index, (ordinary, deduction) in enumerate(common, 1):
            yield one(year, f"required-{index}", ordinary, deduction)
        yield one(year, "overflow-minus-one", 1000000, 999999)
        yield one(year, "overflow-plus-one", 1000000, 1000001)
        yield one(year, "short-stock-futures", 2000000, 3000000, 2500000, 40000,
                  shortLand=700000, generalStock=1900250, listedStock=2500000, futures=999999)
        yield one(year, "exhausted-short", 0, 1000000, 900000, 55000, shortLand=300000, listedStock=4700000)
        yield one(year, "long-land", 0, 1100000, 900000, 55558, longLand=5000000)
        yield one(year, "declared-dividend", 0, 1100000, 900000, 55559, listedDividend=5000000)
        yield one(year, "tax-bracket-below", 2950999, 1000000, 950000, 2001)
        yield one(year, "tax-bracket-above", 2951000, 1000000, 950000, 2001)
        ordinary = 700000 if year == 2025 else 740000
        yield one(year, "ratio-below-zero", ordinary-1, 1100000, 500000)
        yield one(year, "ratio-exact-zero", ordinary, 1100000, 500000)
        yield one(year, "income-donation-caps", 0, 1000000, 950000, 2500000)
        yield one(year, "credit-ceiling-before", 0, 1000000, 1000000, 55558)
        yield one(year, "credit-ceiling-after", 0, 1000000, 1000000, 55559)


if __name__ == "__main__":
    generated = list(cases())
    # Direct hand-derived anchors for ordinary-first and independent
    # prefectural/municipal levies, before donation or withholding.
    assert [item["expected"]["nationalTaxable"][5] for item in generated[:8]] == [
        4000000, 0, 5000000, 4500000, 4000000, 0, 0, 5000000
    ]
    assert generated[0]["expected"]["nationalBefore"] == 612600
    assert generated[0]["expected"]["residentBefore"] == 200000
    if "--write" in sys.argv:
        FIXTURES.write_text(json.dumps(generated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        assert json.loads(FIXTURES.read_text(encoding="utf-8")) == generated
    print(f"{len(generated)} statutory synthetic fixtures verified by Fraction/sliced-bracket oracle")
