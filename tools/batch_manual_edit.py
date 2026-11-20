"""Local-only edits for one taxpayer per row; no full PDF is retained.

The source withholding total is intentionally *not* an editable input.
An edited source is ALWAYS a provisional assumption, never a tax decision.
All rows are validated before any output is written (atomic replace).
"""
from __future__ import annotations
import csv
import re
from pathlib import Path

from audit_salary_donation_limit import BASIC, independent_nta_fifth_table_salary_income
from audit_withholding_reconciliation import reconcile
from bulk_salary_only import (
    COLUMNS, REPORT_COLUMNS, EDIT_COLUMNS, EDIT_FIELDS, _life_deductions,
    write_batch_bridge, pack_editor_source,
)
from automatic_slip_reference import make_automatic_reference
from batch_source_deductions import (
    reconcile_mortgage_deductions, MortgageDeductionError,
)
from recipient_name import decode as decode_name

INPUT_COLUMNS = ("PAGE", "RECIPIENT_NAME_HEX") + EDIT_COLUMNS
VALID_SOURCE = ("PDF_TEXT", "PDF_PAGE_SELECTED",
                "STRUCTURED_JSON", "STRUCTURED_TEXT", "TEXT_LABELS")
VALID_MUNI = ("STANDARD", "DESIGNATED", "SPECIAL", "UNCERTAIN")
CODE = re.compile(r"[A-Z0-9_]+")
LIMIT_BYTES = 300_000


def fail(code):
    raise ValueError(code)


def parse_integer(value, *, optional=False):
    if optional and value == "":
        return None
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,11})", value):
        fail("EDIT_NUMERIC_INVALID")
    number = int(value)
    if number > 10**12:
        fail("EDIT_NUMERIC_OVERSIZED")
    return number


def evidence_from_edit(row):
    year = parse_integer(row["EDIT_SOURCE_YEAR"], optional=True)
    target = parse_integer(row["EDIT_TARGET_YEAR"], optional=True)
    if year not in (2025, 2026) or target not in (2025, 2026):
        fail("EDIT_YEAR_INVALID")
    values = {
        k: parse_integer(row["EDIT_" + k.upper()], optional=True)
        for k in EDIT_FIELDS
    }
    values = {k: v for k, v in values.items() if v is not None}
    if row["EDIT_FORMAT"] not in VALID_SOURCE or row["EDIT_MUNI_CLASS"] not in VALID_MUNI:
        fail("EDIT_SOURCE_OR_MUNICIPALITY_INVALID")
    warning_str = row["EDIT_WARNINGS"]
    if type(warning_str) is not str or len(warning_str) > 250:
        fail("EDIT_WARNINGS_INVALID")
    warnings = warning_str.split("|") if warning_str else []
    if any(len(code) > 64 or not CODE.fullmatch(code) for code in warnings):
        fail("EDIT_WARNINGS_INVALID")
    record = {"year": year, "fields": values,
              "format": row["EDIT_FORMAT"], "warnings": warnings,
              "municipality_hint": {"class": row["EDIT_MUNI_CLASS"]}}
    return record, target


def reconstruct_total(record, target):
    """Statutory deduction recomputation without accepting the printed total."""
    fields = record["fields"]
    source_year = record["year"]
    needed = ("salary_gross", "salary_reference",
              "income_tax_withheld", "social_insurance")
    if not all(type(fields.get(k)) is int for k in needed):
        return None
    gross = fields["salary_gross"]
    salary_income = fields["salary_reference"]
    adjust = fields.get("income_adjustment", 0)
    if (gross > 20_000_000 or salary_income > gross or
            not 0 <= adjust <= 150_000 or
            salary_income != independent_nta_fifth_table_salary_income(
                source_year, gross) - adjust):
        return None
    basic = next((amount for maximum, amount in BASIC[source_year]
                  if salary_income <= maximum), None)
    if basic is None:
        return None
    eligible = source_year == 2026 and fields.get("under16_count", 0) > 0
    life, _ = _life_deductions(fields, year=source_year,
                               eligible_under23=eligible)
    quake = fields.get("earthquake_deduction_reference", 0)
    if (type(quake) is not int or quake > 50_000 or
            fields.get("old_long_premium_reference", 0) != 0):
        return None
    spouse = fields.get("spouse_deduction_reference", 0)
    if type(spouse) is not int or spouse not in (0, 380_000):
        return None
    if spouse and (type(fields.get("spouse_income_reference")) is not int or
                   fields["spouse_income_reference"] >
                   (580_000 if source_year == 2025 else 620_000)):
        return None
    if any(fields.get(k, 0) for k in
           ("special_relative_count", "special_relative_deduction_reference")):
        return None
    total = fields["social_insurance"] + basic + life + quake + spouse
    fields.update({"basic_reference": basic,
                   "life_deduction_reference": life,
                   "deductions_reference": total})
    # Source-year national total is rebuilt, then target-year national total
    # is reprojected by the independent approved deduction model. The main
    # overview must NOT display stale G06 from the preceding-year slip.
    target_salary = independent_nta_fifth_table_salary_income(target, gross) - adjust
    try:
        return reconcile_mortgage_deductions(
            fields, source_year, target, basic, salary_income,
            target_salary)["target_national"]
    except (MortgageDeductionError, TypeError, ValueError):
        return None


def evaluated_row(page, name_hex, record, target, total):
    if record is None or target not in (2025, 2026):
        return {
            **{k: (page if k == "PAGE" else
                   "HOLD" if k == "STATUS" else
                   "EDIT_INPUT_REVIEW_REQUIRED" if k == "REASON" else "")
               for k in COLUMNS},
            **{k: "" for k in REPORT_COLUMNS},
            "RECIPIENT_NAME_HEX": name_hex,
            "FILING_LIMIT": "",
            **{k: "" for k in EDIT_COLUMNS},
        }
    fields = record["fields"]
    row = {
        "PAGE": page, "YEAR": target,
        "SALARY_GROSS": fields.get("salary_gross", ""),
        "SALARY_INCOME": fields.get("salary_reference", ""),
        "TOTAL_DEDUCTIONS": total if type(total) is int else "",
        "SOURCE_TAX": fields.get("income_tax_withheld", ""),
        "SOCIAL_INSURANCE": fields.get("social_insurance", ""),
        "REFERENCE_LIMIT": "", "STATUS": "HOLD",
        "REASON": "EDIT_INPUT_REVIEW_REQUIRED",
        "RECIPIENT_NAME_HEX": name_hex, "FILING_LIMIT": "",
        **{k: "" for k in REPORT_COLUMNS},
    }
    if total is not None:
        auto = make_automatic_reference(record, target)
        if auto["status"] == "AUTO_REFERENCE" and (
                reconcile(record["year"], fields).get("source_tax") == "MATCH"):
            row.update({
                "SALARY_INCOME": auto["salary_income"],
                "REFERENCE_LIMIT": auto["limit"],
                "STATUS": "PROVISIONAL",
                "REASON": ("AUTO_ONE_STOP_HOUSING" if auto.get("mortgage_mode")
                           else "AUTO_SOURCE_ASSUMPTION"),
                "FILING_LIMIT": (auto.get("filing_limit")
                                 if auto.get("filing_limit") is not None else ""),
            })
            row.update(auto["report_trace"])
        else:
            row["REASON"] = "EDIT_SOURCE_TAX_OR_DEDUCTIONS_REVIEW"
    row.update(pack_editor_source(record, target))
    return row


def recalculate_file(source: Path, destination: Path):
    source, destination = Path(source), Path(destination)
    if (not source.is_file() or source.is_symlink() or
            source.stat().st_size > LIMIT_BYTES or source.stat().st_size < 20 or
            destination.exists() or source.resolve() == destination.resolve()):
        fail("EDIT_FILES_INVALID")
    with source.open("r", encoding="ascii", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        if reader.fieldnames != list(INPUT_COLUMNS):
            fail("EDIT_HEADER_INVALID")
        results = []
        for record in reader:
            if None in record or len(results) == 100:
                fail("EDIT_ROW_COLUMNS_INVALID")
            page = parse_integer(record["PAGE"])
            if page != len(results) + 1:
                fail("EDIT_PAGE_ORDER_INVALID")
            hex_name = record["RECIPIENT_NAME_HEX"]
            if len(hex_name) > 160:
                fail("EDIT_NAME_TOO_LONG")
            if hex_name:
                decode_name(hex_name)
            evidence, target_year = evidence_from_edit(record)
            total = None
            if evidence is not None:
                try:
                    total = reconstruct_total(evidence, target_year)
                except (TypeError, ValueError, KeyError):
                    total = None
            results.append(evaluated_row(page, hex_name, evidence,
                                          target_year, total))
    if not results:
        fail("EDIT_EMPTY")
    write_batch_bridge(results, destination)
    return len(results)
