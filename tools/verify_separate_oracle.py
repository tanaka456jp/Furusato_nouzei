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


def oracle(case, exact=False, jurisdiction=False):
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
    city_fraction = Fraction(4, 5) if case.get("municipality") == "designated" else Fraction(3, 5)
    shares = (city_fraction, 1 - city_fraction)
    jurisdictions = [levy * share for share in shares]
    base_parts = [math.floor(t / 100) * 100 for t in jurisdictions]
    base_resident = sum(base_parts)
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
        parts = []
        for current, share in zip(jurisdictions, shares):
            credit = math.ceil(basic_credit * share + min(special * share, current / 5))
            parts.append(max(0, math.floor((current - credit) / 100) * 100))
        local_after = sum(parts)
        return after, local_after, donation - (base_income - after) - (base_resident - local_after), parts

    # Wider than the product search bound; catches erroneous truncation.
    limit = max((d for d in range(3000, 1250001, 1000) if evaluate(d)[2] <= 2000), default=0)
    after_income, after_resident, net_cost, after_parts = evaluate(case["donation"])
    if exact:
        # Search high-to-low in 1000-yen blocks. At the upper endpoint the
        # total relief is at least that of every amount in the block.
        for high in range(1250000, 1999, -1000):
            low = max(2000, high - 999)
            high_cost = evaluate(high)[2]
            if high - high_cost + 2000 < low:
                continue
            for donation in range(high, low - 1, -1):
                cost = evaluate(donation)[2]
                if cost <= 2000:
                    return dict(maximum=donation, rounded=donation // 1000 * 1000,
                                costAtMaximum=cost, costNext=evaluate(donation + 1)[2])
    result = dict(nationalApplied=n_used, residentApplied=r_used, nationalTaxable=n_taxable,
                residentTaxable=r_taxable, nationalUnused=n_unused, residentUnused=r_unused,
                nationalBefore=base_income, residentBefore=base_resident, ratio=ratio,
                nationalAfter=after_income, residentAfter=after_resident, netCost=net_cost, limit=limit)
    if jurisdiction:
        result.update(residentBeforeParts=base_parts, residentAfterParts=after_parts)
    return result


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


def locality_cases(existing):
    by_id = {item["id"]: item["input"] for item in existing}
    for year in (2025, 2026):
        for name in ("required-1", "short-stock-futures", "ratio-exact-zero"):
            source_id = f"{year}-{name}"
            values = dict(by_id[source_id], municipality="designated")
            yield f"{source_id}-designated", values
    values = dict(by_id["2026-required-1"], municipality="standard",
                  ordinary=19529655, listedStock=1697956, nationalDeductions=1102014,
                  residentDeductions=912014, donation=430000)
    yield "2026-rounded-is-infeasible", values


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
    exact_path = FIXTURES.with_name("separate-tax-exact-v1.json")
    exact_results = [dict(id=item["id"], **oracle(item["input"], exact=True)) for item in generated]
    if "--write" in sys.argv:
        exact_path.write_text(json.dumps(exact_results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        assert json.loads(exact_path.read_text(encoding="utf-8")) == exact_results
    local_path = FIXTURES.with_name("separate-tax-local-v1.json")
    local_results = [
        dict(id=id_, input=values, expected=oracle(values, jurisdiction=True), exact=oracle(values, exact=True))
        for id_, values in locality_cases(generated)
    ]
    assert local_results[0]["expected"]["residentBeforeParts"] == [160000, 40000]
    assert local_results[-1]["exact"]["rounded"] == 430000
    assert local_results[-1]["expected"]["netCost"] > 2000
    assert local_results[-1]["expected"]["limit"] == 429000
    if "--write" in sys.argv:
        local_path.write_text(json.dumps(local_results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        assert json.loads(local_path.read_text(encoding="utf-8")) == local_results
    print(f"{len(generated)} existing and {len(local_results)} new statutory fixtures verified by Fraction/sliced-bracket oracle")
