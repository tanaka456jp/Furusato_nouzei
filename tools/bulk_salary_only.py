"""Salary-only, slip-based *provisional* multi-person PDF list.

No identifiers or original document strings enter the bridge. The bulk mode
is deliberately narrower than the single-case Excel calculation:
other income, split taxation, complex family/housing situations => HOLD.
"""
from __future__ import annotations

import csv
import io
import os
import tempfile
from pathlib import Path

from audit_salary_donation_limit import (
    BASIC, independent_nta_fifth_table_salary_income, independent_salary_ceiling,
    resident_income_levy_exemption_limit,
)
from audit_withholding_reconciliation import reconcile
from audit_insurance_deductions import _insurance_category, _new
from recipient_name import decode as decode_name

COLUMNS = (
    "PAGE", "YEAR", "SALARY_GROSS", "SALARY_INCOME", "TOTAL_DEDUCTIONS",
    "SOURCE_TAX", "SOCIAL_INSURANCE", "REFERENCE_LIMIT", "STATUS", "REASON",
)
# Backward-compatible report-aware bridge v2: existing v1 tests and loaders
# continue to work. Only local numeric model traces are persisted in K:R.
REPORT_COLUMNS = (
    "R_SOURCE_YEAR", "R_SOURCE_BASIC", "R_RESIDENT_DEDUCTIONS",
    "R_RESIDENT_TAXABLE", "R_RESIDENT_LEVY", "R_SPECIAL_RATIO_PPM",
    "R_SPECIAL_CAP", "R_MODEL_LOCALITY",
)
ALLOWED_MODEL_LOCALITIES = ("STANDARD", "DESIGNATED", "UNCERTAIN")
NAME_COLUMNS = ("RECIPIENT_NAME_HEX",)  # v3; never plaintext in TSV
FILING_COLUMNS = ("FILING_LIMIT",)  # v4; optional numeric comparison only
FILING_TRIAL_COLUMNS = ("FILING_TRIAL_DONATION", "FILING_TRIAL_BURDEN")  # v6; both-or-none
# v5 local-only detailed editor. Salary gross/income and tax amounts are
# ordinary input values, never totals. Only the derived G06 deduction total
# is intentionally excluded from editing and reconstructed on recalculation.
EDIT_FIELDS = (
    "salary_gross", "salary_reference", "income_tax_withheld", "social_insurance",
    "life_new", "life_old", "medical_care", "annuity_new", "annuity_old",
    "earthquake_deduction_reference", "old_long_premium_reference",
    "spouse_deduction_reference", "spouse_income_reference",
    "spouse_eligibility_flag", "under16_count", "special_relative_count",
    "special_relative_deduction_reference", "income_adjustment",
    "mortgage_credit", "mortgage_possible_credit", "mortgage_occupancy_year",
    "mortgage_claim_count",
    "dependent_general_count", "dependent_special_count",
    "dependent_elderly_count", "dependent_cohabiting_elderly_count",
    "under23_life_eligible_flag", "trial_donation",
)
EDIT_META = ("EDIT_SOURCE_YEAR", "EDIT_TARGET_YEAR", "EDIT_MUNI_CLASS",
             "EDIT_FORMAT", "EDIT_WARNINGS")
EDIT_COLUMNS = EDIT_META + tuple("EDIT_" + item.upper() for item in EDIT_FIELDS)


def pack_editor_source(evidence, target_year):
    """Whitelisted, source-annotated inputs; never original PDF or address."""
    fields = evidence.get("fields") or {}
    hint = evidence.get("municipality_hint") or {}
    return {
        **{"EDIT_SOURCE_YEAR": evidence.get("year", ""),
           "EDIT_TARGET_YEAR": target_year,
           "EDIT_MUNI_CLASS": hint.get("class", "UNCERTAIN")
            if hint.get("class") in ("STANDARD", "DESIGNATED", "SPECIAL")
            else "UNCERTAIN",
           "EDIT_FORMAT": evidence.get("format", ""),
           "EDIT_WARNINGS": "|".join(
               w for w in (evidence.get("warnings") or [])
               if type(w) is str and len(w) <= 64 and
               w.replace("_", "").isalnum() and w.upper() == w)[:250]},
        **{"EDIT_" + key.upper(): ("" if key == "trial_donation" else fields.get(key, ""))
           for key in EDIT_FIELDS},
    }

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
    "earthquake_paid", "earthquake_deduction_reference", "mortgage_credit",
    "mortgage_possible_credit", "mortgage_claim_count",
    "mortgage_occupancy_year", "spouse_income_reference",
    "special_relative_count", "special_relative_deduction_reference",
    "income_adjustment",
}


def _life_deductions(fields: dict, *, year=2025, eligible_under23=False) -> tuple[int, int]:
    """Compute insurance relief from the five *paid premium* boxes.

    Earthquake cases remain outside batch mode, since the slip alone does
    not distinguish old-long-term contracts and paid premiums.
    The national result must reconcile to G27 before resident use.
    """
    if year not in (2025, 2026) or type(eligible_under23) is not bool or (year != 2026 and eligible_under23):
        raise ValueError("UNAPPROVED_LIFE_DEDUCTION_YEAR")
    amounts = [fields.get(key, 0) for key in
               ("life_new", "life_old", "medical_care", "annuity_new",
                "annuity_old")]
    if any(type(x) is not int or not 0 <= x <= 10**9 for x in amounts):
        raise ValueError("INVALID_LIFE_PREMIUM")
    life_new, life_old, care, annuity_new, annuity_old = amounts
    results = []
    for resident in (False, True):
        total = (
            _insurance_category(life_new, life_old, resident=resident,
                                eligible_2026_under23=(eligible_under23 and not resident))
            + _new(care, resident=resident)
            + _insurance_category(annuity_new, annuity_old, resident=resident)
        )
        results.append(min(total, 70_000 if resident else 120_000))
    return results[0], results[1]


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
    extra_warnings = set(evidence["warnings"]) - ALLOWED_SOURCE_WARNINGS
    # Only a physically blank social-insurance box may be relaxed for a
    # salary income below the universal ¥450k income-levy exemption.
    if extra_warnings and extra_warnings != {
            "BLANK_SOCIAL_INSURANCE_REQUIRES_REVIEW"}:
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
    if extra_warnings:
        if salary_income <= 450_000 and fields["income_tax_withheld"] == 0:
            row["REFERENCE_LIMIT"] = 0
            row["STATUS"] = "PROVISIONAL"
            row["REASON"] = "INCOME_LEVY_EXEMPT_SALARY_ONLY"
            return row
        row["REASON"] = "SOURCE_REVIEW_REQUIRED"
        return row
    basic = next((v for limit, v in BASIC[year] if salary_income <= limit), 0)
    try:
        national_life, resident_life = _life_deductions(fields)
    except ValueError:
        row["REASON"] = "LIFE_PREMIUM_SINGLE_ONLY"
        return row
    if fields.get("life_deduction_reference", 0) != national_life:
        row["REASON"] = "LIFE_DEDUCTION_NOT_RECONCILED"
        return row
    if (fields["basic_reference"] != basic or
            fields["deductions_reference"] != (
                fields["social_insurance"] + basic + national_life)):
        row["REASON"] = "NATIONAL_DEDUCTIONS_SINGLE_ONLY"
        return row
    if reconcile(year, fields)["source_tax"] != "MATCH":
        row["REASON"] = "SOURCE_TAX_NOT_RECONCILED"
        return row
    under16 = fields.get("under16_count")
    if under16 is not None and (type(under16) is not int or
                                not 0 <= under16 <= 30):
        row["REASON"] = "UNDER16_REVIEW_REQUIRED"
        return row
    # A salary income <=450k is universally below the ordinary income-levy
    # exemption. Higher income may be exempt depending on under-16 children;
    # do not fabricate zero children if the PDF omitted the count entirely.
    if salary_income <= 450_000 or (
            under16 is not None and salary_income <=
            resident_income_levy_exemption_limit(under16)):
        row["REFERENCE_LIMIT"] = 0
        row["STATUS"] = "PROVISIONAL"
        row["REASON"] = "INCOME_LEVY_EXEMPT_SALARY_ONLY"
        return row
    if under16 is None and salary_income <= 2_520_000:
        row["REASON"] = "FAMILY_EXEMPTION_MAY_APPLY"
        return row
    try:
        values = [
            independent_salary_ceiling(
                year=year, salary_income=salary_income,
                resident_deductions=(
                    fields["social_insurance"] + 430_000 + resident_life),
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


def all_page_rows(path: Path, target_year=None) -> list[dict]:
    """Read all pages independently. One damaged page cannot mix taxpayers."""
    from withholding_reader import extract, pdf_page_count
    from automatic_slip_reference import make_automatic_reference
    if target_year is not None and target_year not in (2025, 2026):
        raise ValueError("UNAPPROVED_BATCH_TARGET_YEAR")
    path = Path(path)
    if path.suffix.lower() != ".pdf":
        raise ValueError("BATCH_REQUIRES_PDF")
    count = pdf_page_count(path)
    if not 1 <= count <= 100:
        raise ValueError("INVALID_BATCH_PAGE_COUNT")
    rows = []
    for page in range(1, count + 1):
        try:
            result = extract(path, page_number=page,
                             include_recipient_name=(target_year is not None))
            row = evaluate_page(page, result)
            if target_year is not None:
                reference = make_automatic_reference(result, target_year)
                row["YEAR"] = target_year
                row.update({name: "" for name in REPORT_COLUMNS})
                row["RECIPIENT_NAME_HEX"] = result.get("recipient_name_hex", "")
                row["FILING_LIMIT"] = ""
                row.update({key: "" for key in FILING_TRIAL_COLUMNS})
                row.update(pack_editor_source(result, target_year))
                if reference["status"] == "AUTO_REFERENCE":
                    row["SALARY_INCOME"] = reference["salary_income"]
                    row["REFERENCE_LIMIT"] = reference["limit"]
                    row["STATUS"] = "PROVISIONAL"
                    if reference.get("mortgage_mode"):
                        row["REASON"] = (
                            "AUTO_ONE_STOP_HOUSING_SPOUSE_INFERRED"
                            if "SOURCE_SPOUSE_DEDUCTION_INFERRED_FROM_TOTAL"
                            in reference.get("reason", "")
                            else "AUTO_ONE_STOP_HOUSING")
                    else:
                        row["REASON"] = "AUTO_SOURCE_ASSUMPTION"
                    comparison = reference.get("filing_limit")
                    if comparison is not None:
                        row["FILING_LIMIT"] = comparison
                    if reference.get("filing_trial_donation") is not None and reference.get("filing_trial_burden") is not None:
                        row["FILING_TRIAL_DONATION"] = reference["filing_trial_donation"]
                        row["FILING_TRIAL_BURDEN"] = reference["filing_trial_burden"]
                    row.update(reference["report_trace"])
                else:
                    row["REFERENCE_LIMIT"] = ""
                    row["STATUS"] = "HOLD"
                    reviewed = {
                        "MORTGAGE_POSSIBLE_AMOUNT_MISSING",
                        "MORTGAGE_DEDUCTION_DETAIL_REVIEW",
                        "MORTGAGE_BASIC_DEDUCTION_REVIEW",
                        "MORTGAGE_LIFE_PREMIUM_REVIEW",
                        "MORTGAGE_EARTHQUAKE_REVIEW",
                        "MORTGAGE_SPOUSE_DEDUCTION_REVIEW",
                        "MORTGAGE_FAMILY_DEDUCTION_REVIEW",
                        "MORTGAGE_OCCUPANCY_CLASS_REVIEW",
                        "MORTGAGE_NEXT_YEAR_REVIEW",
                        "MORTGAGE_LOCAL_TAX_REVIEW",
                        "MORTGAGE_ONE_STOP_REQUIRES_INDIVIDUAL_REVIEW",
                    }
                    code = reference.get("reason")
                    row["REASON"] = (
                        code if isinstance(code, str) and code in reviewed
                        else "AUTO_SOURCE_HOLD")
            rows.append(row)
        except Exception:
            # Do not write the exception, PDF text, name, amount, or filename.
            row = {key: (page if key == "PAGE" else
                         "HOLD" if key == "STATUS" else
                         "PAGE_READ_ERROR" if key == "REASON" else "")
                   for key in COLUMNS}
            if target_year is not None:
                row.update({name: "" for name in REPORT_COLUMNS})
                row["RECIPIENT_NAME_HEX"] = ""
                row["FILING_LIMIT"] = ""
                row.update({key: "" for key in FILING_TRIAL_COLUMNS})
                row.update({key: "" for key in EDIT_COLUMNS})
            rows.append(row)
    return rows


def write_batch_bridge(rows: list[dict], output: Path) -> None:
    """Fixed ASCII TSV v1/v2 schema; excludes identities, paths and source text.

    v2 is emitted only if ALL page records carry an explicit report schema.
    A partial/failed page gets blank report cells and a HOLD status.
    """
    if not rows or not isinstance(rows, list):
        raise ValueError("EMPTY_BATCH_REPORT")
    with_report = any("R_SOURCE_YEAR" in row for row in rows)
    with_name = any("RECIPIENT_NAME_HEX" in row for row in rows)
    if with_name and not with_report:
        raise ValueError("NAME_REQUIRES_REPORT")
    with_edit = any("EDIT_SOURCE_YEAR" in row for row in rows)
    if with_edit and any(any(k not in row for k in EDIT_COLUMNS) for row in rows):
        raise ValueError("PARTIAL_EDIT_SCHEMA")
    with_filing = any("FILING_LIMIT" in row for row in rows)
    with_trial = any(any(k in row for k in FILING_TRIAL_COLUMNS) for row in rows)
    if with_trial and (not with_edit or not with_filing or
                       any(any(k not in row for k in FILING_TRIAL_COLUMNS)
                           for row in rows)):
        raise ValueError("PARTIAL_FILING_TRIAL_SCHEMA")
    if with_filing and (not with_name or
                        any("FILING_LIMIT" not in row for row in rows)):
        raise ValueError("FILING_REQUIRES_COMPLETE_NAMED_REPORT")
    if with_name and any("RECIPIENT_NAME_HEX" not in row for row in rows):
        raise ValueError("PARTIAL_NAME_SCHEMA")
    columns = (COLUMNS + (REPORT_COLUMNS if with_report else ())
               + (NAME_COLUMNS if with_name else ())
               + (FILING_COLUMNS if with_filing else ())
               + (EDIT_COLUMNS if with_edit else ())
               + (FILING_TRIAL_COLUMNS if with_trial else ()))
    if with_report and any(any(k not in row for k in REPORT_COLUMNS)
                           for row in rows):
        raise ValueError("PARTIAL_REPORT_SCHEMA")
    # Validate and serialize ALL rows before touching the destination.
    # A malformed later taxpayer must never leave an apparently valid prefix.
    with io.StringIO() as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(columns)
        for idx, row in enumerate(rows, 1):
            if type(row.get("PAGE")) is not int or row["PAGE"] != idx:
                raise ValueError("NON_CONTIGUOUS_SOURCE_PAGES")
            status = row.get("STATUS")
            if status not in ("HOLD", "PROVISIONAL"):
                raise ValueError("INVALID_BATCH_STATUS")
            if status == "HOLD" and row.get("REFERENCE_LIMIT") not in ("", None):
                raise ValueError("HOLD_WITH_REFERENCE_LIMIT")
            if with_report:
                trace = [row[k] for k in REPORT_COLUMNS]
                if status == "HOLD":
                    if any(value != "" for value in trace):
                        raise ValueError("HOLD_WITH_REPORT_NUMBERS")
                elif not all(type(value) is int for value in trace[:-1]):
                    raise ValueError("INVALID_REPORT_NUMBERS")
                elif trace[-1] not in ALLOWED_MODEL_LOCALITIES:
                    raise ValueError("INVALID_REPORT_LOCALITY")
                elif (trace[0] not in (2025, 2026)
                      or any(value < 0 or value > 10**12 for value in trace[:-1])
                      or trace[5] > 900000
                      or trace[6] != trace[4] // 5):
                    raise ValueError("INVALID_REPORT_TRACE")
            if with_name:
                encoded = row["RECIPIENT_NAME_HEX"]
                if encoded:
                    decode_name(encoded)
                elif encoded != "":
                    raise ValueError("INVALID_NAME_HEX")
            if with_filing:
                comparison = row["FILING_LIMIT"]
                if comparison not in (None, ""):
                    if (status != "PROVISIONAL" or
                        type(comparison) is not int or
                        comparison < 0 or
                        comparison > 10**9 or comparison % 1000):
                        raise ValueError("INVALID_FILING_COMPARISON")
                elif comparison not in ("", None):
                    raise ValueError("INVALID_FILING_COMPARISON")
                if (comparison not in ("", None) and
                        not isinstance(row.get("REFERENCE_LIMIT"), int)):
                    raise ValueError("FILING_WITHOUT_ONE_STOP")
            if with_trial:
                chosen = row["FILING_TRIAL_DONATION"]
                burden = row["FILING_TRIAL_BURDEN"]
                if (chosen in ("", None)) != (burden in ("", None)):
                    raise ValueError("INCOMPLETE_FILING_TRIAL_VALUES")
                if chosen not in ("", None) and (
                        status != "PROVISIONAL" or type(chosen) is not int or
                        type(burden) is not int or chosen < 2000 or
                        chosen > 10**9 or chosen % 1000 or
                        not 0 <= burden <= chosen or
                        not isinstance(row.get("REFERENCE_LIMIT"), int)):
                    raise ValueError("INVALID_FILING_TRIAL_VALUES")
                if status == "HOLD" and chosen not in ("", None):
                    raise ValueError("HOLD_WITH_FILING_TRIAL_VALUES")
            if with_edit:
                if not with_filing:
                    raise ValueError("EDIT_REQUIRES_FILING")
                for key in EDIT_COLUMNS:
                    value = row[key]
                    if key in ("EDIT_MUNI_CLASS", "EDIT_FORMAT", "EDIT_WARNINGS"):
                        if (type(value) is not str or len(value) > 250 or
                                any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_|"
                                    for c in value)):
                            raise ValueError("INVALID_EDIT_METADATA")
                    elif value not in ("", None) and (
                            type(value) is not int or not 0 <= value <= 10**12):
                        raise ValueError("INVALID_EDIT_NUMERIC")
            writer.writerow([row.get(key, "") for key in columns])
        serialized = handle.getvalue()
    # Replace in the same directory only after the complete bridge has passed
    # validation and a temporary file has been flushed to disk.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
                mode="w", encoding="ascii", newline="", dir=Path(output).parent,
                prefix=".furusato_batch_", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(serialized)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
