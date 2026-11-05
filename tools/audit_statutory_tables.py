"""Independent static statutory table checks for the published 2025/26 bands.

This compares immutable public-law reference values, NOT copies of formulas
from Furusato's workbook. It does not replace real tax-document validation.

Official sources (read on 2026-11-06):
https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm
https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm
https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm
"""
from __future__ import annotations

import argparse
from pathlib import Path

from openpyxl import load_workbook


# (upper income inclusive, income-tax basic deduction, resident-tax base deduction)
BASIC = {
    2025: [
        (1_320_000, 950_000, 430_000),
        (3_360_000, 880_000, 430_000),
        (4_890_000, 680_000, 430_000),
        (6_550_000, 630_000, 430_000),
        (23_500_000, 580_000, 430_000),
        (24_000_000, 480_000, 430_000),
        (24_500_000, 320_000, 290_000),
        (25_000_000, 160_000, 150_000),
        (999_999_999_999, 0, 0),
    ],
    2026: [
        (1_320_000, 1_040_000, 430_000),
        (3_360_000, 1_040_000, 430_000),
        (4_890_000, 1_040_000, 430_000),
        (6_550_000, 670_000, 430_000),
        (23_500_000, 620_000, 430_000),
        (24_000_000, 480_000, 430_000),
        (24_500_000, 320_000, 290_000),
        (25_000_000, 160_000, 150_000),
        (999_999_999_999, 0, 0),
    ],
}
# Official salary-deduction amount bands. For <6.6m the separate year-end
# payroll-income table / special edge cases must still be respected.
SALARY = {
    2025: [
        (1_900_000, 0.0, 650_000),
        (3_600_000, 0.3, 80_000),
        (6_600_000, 0.2, 440_000),
        (8_500_000, 0.1, 1_100_000),
        (999_999_999_999, 0.0, 1_950_000),
    ],
    2026: [
        (2_200_000, 0.0, 740_000),
        (3_600_000, 0.3, 80_000),
        (6_600_000, 0.2, 440_000),
        (8_500_000, 0.1, 1_100_000),
        (999_999_999_999, 0.0, 1_950_000),
    ],
}
RATES = [
    (1_950_000, .05),
    (3_300_000, .10),
    (6_950_000, .20),
    (9_000_000, .23),
    (18_000_000, .33),
    (40_000_000, .40),
    (999_999_999_999, .45),
]


def numeric(value):
    if not isinstance(value, (int, float)):
        raise AssertionError(f"Non-numeric statutory master entry: {value!r}")
    return value


def audit(path: Path) -> int:
    book = load_workbook(path, read_only=True, data_only=False)
    checked = 0
    try:
        for name, expected, columns in (
            ("年度別基礎控除", BASIC, ("C", "D", "E")),
            ("年度別給与控除", SALARY, ("C", "D", "E")),
            ("年度別所得税率", {2025: RATES, 2026: RATES}, ("C", "D")),
        ):
            sheet = book[name]
            for year in (2025, 2026):
                data = list(expected[year])
                actual = []
                for row in list(sheet.iter_rows(min_row=4, values_only=True)):
                    if row[0] != year:
                        continue
                    # A/B = year and exclusive lower bound; C+ values.
                    first = numeric(row[1])
                    if not actual:
                        assert first == -1, (name, year, "first lower bound")
                    else:
                        assert first == actual[-1][0], (name, year, "gap/overlap")
                    upper = numeric(row[2])
                    assert upper > first, (name, year, "non-increasing band")
                    if name == "年度別所得税率":
                        actual.append((upper, numeric(row[3])))
                    else:
                        actual.append((upper, numeric(row[3]), numeric(row[4])))
                assert len(actual) == len(data), (name, year, len(actual))
                for i, (given, published) in enumerate(zip(actual, data)):
                    assert len(given) == len(published), (name, year, i)
                    for a, b in zip(given, published):
                        assert abs(a - b) < 1e-9, (name, year, i, a, b)
                    checked += 1
        return checked
    finally:
        book.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("workbook", type=Path)
    args = p.parse_args()
    total = audit(args.workbook)
    print(f"PASS: {total} statutory bands for 2025/2026, including published thresholds.")
