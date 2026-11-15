"""Local-only, independent year-end withholding-tax arithmetic check.

Reconstructs only ordinary salary year-end income tax using the year-end
slip's already determined salary-income and deduction totals. It does NOT
calculate or approve a furusato-nozei donation ceiling. The taxpayer's
resident-tax position and filing choices cannot be proved from a slip alone.

Official reference: https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2662.htm
Rates: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm
"""
from __future__ import annotations

import argparse
from pathlib import Path

# Marginal-slice algorithm, independent of workbook tax master and GAS.
INCOME_TAX_BANDS = (
    (1_950_000, 5), (3_300_000, 10), (6_950_000, 20),
    (9_000_000, 23), (18_000_000, 33), (40_000_000, 40),
    (10**15, 45),
)


def progressive_income_tax(taxable: int) -> int:
    if type(taxable) is not int or taxable < 0:
        raise ValueError("Invalid taxable salary income")
    value, lower = 0, 0
    for upper, rate in INCOME_TAX_BANDS:
        if taxable <= lower:
            break
        span = min(taxable, upper) - lower
        value += span * rate // 100
        lower = upper
    return value


def reconcile(year, fields: dict) -> dict:
    """Reconcile source withholding, never a donation ceiling.

    By default returns only categorical evidence, not source amounts or names.
    A mismatch demands review but does not prove incorrect withholding:
    unsupported credits or other special cases may affect the reported tax.
    """
    result = {"source_tax": "NOT_COMPARABLE", "donation_limit": "NOT_VERIFIED"}
    required = ("salary_reference", "deductions_reference", "income_tax_withheld")
    if type(year) is not int or year not in (2025, 2026):
        result["reason"] = "UNAPPROVED_YEAR"
        return result
    if not isinstance(fields, dict) or any(k not in fields for k in required):
        result["reason"] = "SOURCE_REFERENCE_MISSING"
        return result
    keys = required + (("mortgage_credit",) if "mortgage_credit" in fields else ())
    if any(type(fields[k]) is not int or fields[k] < 0 or fields[k] > 10**12 for k in keys):
        result["reason"] = "INVALID_SOURCE_AMOUNT"
        return result
    salary_income = fields["salary_reference"]
    # 2025+ high-income minimum-tax rules need separate verification.
    if salary_income > 330_000_000:
        result["reason"] = "HIGH_INCOME_TAX_SPECIAL_CASE"
        return result
    possible = fields.get("mortgage_possible_credit", 0)
    if type(possible) is not int or possible < 0:
        result["reason"] = "INVALID_HOUSING_CREDIT"
        return result
    if possible > 0 and "mortgage_credit" not in fields:
        # Only zero taxable income and source tax zero prove that the
        # mortgage credit did not reduce ordinary national income tax.
        if (fields["deductions_reference"] >= salary_income
                and fields["income_tax_withheld"] == 0):
            applied = 0
        else:
            result["reason"] = "HOUSING_APPLIED_CREDIT_MISSING"
            return result
    else:
        applied = fields.get("mortgage_credit", 0)
    taxable = max(0, salary_income-fields["deductions_reference"]) // 1000 * 1000
    income_tax = progressive_income_tax(taxable)
    if applied > income_tax or (possible > 0 and applied > possible):
        result["reason"] = "INVALID_HOUSING_CREDIT"
        return result
    # NTA year-end method: 102.1% followed by <100 yen truncation.
    predicted = ((income_tax-applied)*1021 // 100_000)*100
    result["source_tax"] = (
        "MATCH" if predicted == fields["income_tax_withheld"] else "MISMATCH"
    )
    result["reason"] = "YEAR_END_SALARY_TAX_MODEL"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--page", type=int)
    group.add_argument("--all-pages", action="store_true")
    args = parser.parse_args()
    # Deferred import allows the pure tax oracle to be tested without OCR.
    from withholding_reader import extract, pdf_page_count
    if args.all_pages:
        if args.input.suffix.lower() != ".pdf":
            parser.error("--all-pages requires PDF")
        pages = range(1, pdf_page_count(args.input)+1)
    else:
        pages = [args.page]
    results = []
    for page in pages:
        evidence = extract(args.input, page_number=page)
        verdict = reconcile(evidence["year"], evidence["fields"])
        results.append(verdict["source_tax"])
        page_id = str(page) if page is not None else "single"
        # Never print names, salary amounts, or raw input from private PDFs.
        print("PAGE="+page_id+" SOURCE_TAX="+verdict["source_tax"]+
              " REASON="+verdict.get("reason", "UNKNOWN")+
              " DONATION_LIMIT=NOT_VERIFIED")
    print("SUMMARY="+str(len(results))+" MATCH="+str(results.count("MATCH"))+
          " NOT_COMPARABLE="+str(results.count("NOT_COMPARABLE"))+
          " MISMATCH="+str(results.count("MISMATCH")))
    return 0 if all(v == "MATCH" for v in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
