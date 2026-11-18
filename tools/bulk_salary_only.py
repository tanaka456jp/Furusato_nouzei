"""Salary-only, slip-based *provisional* multi-person PDF list.

No identifiers or original document strings enter the bridge. The bulk mode
is deliberately narrower than the single-case Excel calculation:
other income, split taxation, complex family/housing situations => HOLD.
"""
from __future__ import annotations

import csv
from pathlib import Path

from audit_salary_donation_limit import (
    BASIC, independent_nta_fifth_table_salary_income, independent_salary_ceiling,
)
from audit_withholding_reconciliation import reconcile

COLUMNS = (
    "PAGE", "YEAR", "SALARY_GROSS", "SALARY_INCOME", "TOTAL_DEDUCTIONS",
    "SOURCE_TAX", "SOCIAL_INSURANCE", "REFERENCE_LIMIT", "STATUS", "REASON",
)
REQUIRED = (
    "salary_gross", "salary_reference", "deductions_reference",
    "income_tax_withheld", "social_insurance", "basic_reference",
)
# Selected-page HOLD and its generic marker are structural: one person's
# source is still independently read but cannot become an approved case.
ALLOWED_SOURCE_WARNINGS = {
    "MULTIPAGE_SELECTED_PAGE_REVIEW", "INCOMPLETE_OR_UNVERIFIED",
}
COMPLEX_FIELDS = {
    "life_new", "life_old", "medical_care", "annuity_new", "annuity_old",
    "earthquake_paid", "life_deduction_reference",
    "earthquake_deduction_reference", "mortgage_credit",
    "mortgage_possible_credit", "mortgage_claim_count",
    "mortgage_occupancy_year", "spouse_income_reference",
    "special_relative_count", "special_relative_deduction_reference",
    "under16_count", "income_adjustment",
}


def evaluate_page(page: int, evidence: dict) -> dict:
    """Return a whitelisted numeric row; never promise a verified tax limit."""
    fields = evidence.get("fields") or {}
    year = evidence.get("year")
    row = {
        "PAGE": page,
        "YEAR": year if type(year) is int and year in (2025, 2026) else "",
        "SALARY_GROSS": fields.get("salary_gross", ""),
        "SALARY_INCOME": fields.get("salary_reference", ""),
        "TOTAL_DEDUCTIONS": fields.get("deductions_reference", ""),
        "SOURCE_TAX": fields.get("income_tax_withheld", ""),
        "SOCIAL_INSURANCE": fields.get("social_insurance", ""),
        "REFERENCE_LIMIT": "",
        "STATUS": "HOLD",
        "REASON": "UNSUPPORTED_OR_UNVERIFIED",
    }
    for key in ("SALARY_GROSS", "SALARY_INCOME", "TOTAL_DEDUCTIONS",
                "SOURCE_TAX", "SOCIAL_INSURANCE"):
        if type(row[key]) is not int or not 0 <= row[key] <= 10**12:
            row[key] = ""
    if row["YEAR"] == "":
        row["REASON"] = "YEAR_UNREADABLE"
        return row
    if any(k not in fields or type(fields[k]) is not int for k in REQUIRED):
        row["REASON"] = "REQUIRED_FIELDS_MISSING"
        return row
    if evidence.get("warnings") is None or not isinstance(evidence["warnings"], list):
        row["REASON"] = "SOURCE_WARNINGS_MISSING"
        return row
    if set(evidence["warnings"]) - ALLOWED_SOURCE_WARNINGS:
        row["REASON"] = "SOURCE_REVIEW_REQUIRED"
        return row
    if any(k in fields and (type(fields[k]) is not int or fields[k] != 0)
           for k in COMPLEX_FIELDS):
        row["REASON"] = "COMPLEX_DEDUCTIONS_SINGLE_ONLY"
        return row
    salary_income = fields["salary_reference"]
    salary_gross = fields["salary_gross"]
    if salary_gross > 20_000_000 or salary_income > 25_000_000:
        row["REASON"] = "HIGH_INCOME_SINGLE_ONLY"
        return row
    if salary_income != independent_nta_fifth_table_salary_income(year, salary_gross):
        row["REASON"] = "SALARY_REFERENCE_NOT_RECONCILED"
        return row
    basic = next((v for limit, v in BASIC[year] if salary_income <= limit), 0)
    if (fields["basic_reference"] != basic or
            fields["deductions_reference"] != fields["social_insurance"] + basic):
        row["REASON"] = "NATIONAL_DEDUCTIONS_SINGLE_ONLY"
        return row
    if reconcile(year, fields)["source_tax"] != "MATCH":
        row["REASON"] = "SOURCE_TAX_NOT_RECONCILED"
        return row
    # The income-levy exemption depends on dependents who might not reduce
    # national income tax (notably under-16 children). Treat all cases
    # within the possible five-person exemption band as ambiguous.
    if salary_income <= 35_0000 * 6 + 42_0000:
        row["REASON"] = "FAMILY_EXEMPTION_MAY_APPLY"
        return row
    try:
        values = [
            independent_salary_ceiling(
                year=year, salary_income=salary_income,
                resident_deductions=fields["social_insurance"] + 430_000,
                personal_difference=50_000, municipality=place,
            )["thousand_yen_reference"]
            for place in ("standard", "designated")
        ]
    except ValueError:
        row["REASON"] = "RESIDENT_TAX_SINGLE_ONLY"
        return row
    if values[0] != values[1]:
        row["REASON"] = "MUNICIPALITY_UNCERTAIN"
        return row
    row["REFERENCE_LIMIT"] = values[0]
    row["STATUS"] = "PROVISIONAL"
    row["REASON"] = "SALARY_ONLY_HYPOTHESIS"
    return row


def all_page_rows(path: Path) -> list[dict]:
    """Read all pages independently. One damaged page cannot mix taxpayers."""
    from withholding_reader import extract, pdf_page_count
    path = Path(path)
    if path.suffix.lower() != ".pdf":
        raise ValueError("BATCH_REQUIRES_PDF")
    count = pdf_page_count(path)
    if not 1 <= count <= 100:
        raise ValueError("INVALID_BATCH_PAGE_COUNT")
    rows = []
    for page in range(1, count + 1):
        try:
            result = extract(path, page_number=page)
            rows.append(evaluate_page(page, result))
        except Exception:
            # Do not write the exception, PDF text, name, amount, or filename.
            rows.append({key: (page if key == "PAGE" else
                                "HOLD" if key == "STATUS" else
                                "PAGE_READ_ERROR" if key == "REASON" else "")
                         for key in COLUMNS})
    return rows


def write_batch_bridge(rows: list[dict], output: Path) -> None:
    """Fixed TSV schema, ASCII-safe values; no names or arbitrary PDF text."""
    with Path(output).open("w", encoding="ascii", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(COLUMNS)
        for idx, row in enumerate(rows, 1):
            if type(row.get("PAGE")) is not int or row["PAGE"] != idx:
                raise ValueError("NON_CONTIGUOUS_SOURCE_PAGES")
            if row.get("STATUS") not in ("HOLD", "PROVISIONAL"):
                raise ValueError("INVALID_BATCH_STATUS")
            writer.writerow([row.get(key, "") for key in COLUMNS])
