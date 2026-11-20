"""Synthetic-only local batch edit, no customer source files."""
import csv
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from audit_withholding_reconciliation import progressive_income_tax
from batch_manual_edit import INPUT_COLUMNS, recalculate_file
from bulk_salary_only import pack_editor_source
from recipient_name import encode


def source(*, mortgage=False, insurance=0):
    fields = {
        "salary_gross": 7_000_000,
        "salary_reference": 5_200_000,
        "social_insurance": 1_000_000,
        "income_tax_withheld": 284300,
    }
    if insurance:
        fields["life_new"] = insurance
        fields["income_tax_withheld"] = 243500  # replaced in test if needed
    if mortgage:
        fields.update({
            "mortgage_credit": 278_500, "mortgage_possible_credit": 300_000,
            "mortgage_occupancy_year": 2024, "mortgage_claim_count": 1,
            "income_tax_withheld": 0,
        })
    return {"year": 2026, "format": "PDF_TEXT", "warnings": [],
            "municipality_hint": {"class": "STANDARD"}, "fields": fields}


def data_row(page, record):
    packed = pack_editor_source(record, 2026)
    return {"PAGE": page, "RECIPIENT_NAME_HEX": encode(
        "山田 太郎" if page == 1 else "佐藤 花子"),
        **packed}


class BatchManualEditTests(unittest.TestCase):
    def make_files(self, rows):
        folder = TemporaryDirectory(prefix="synthetic_batch_edit_")
        self.addCleanup(folder.cleanup)
        input_file = Path(folder.name) / "edit.tsv"
        output = Path(folder.name) / "out.tsv"
        with input_file.open("w", encoding="ascii", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=INPUT_COLUMNS,
                                    delimiter="\t", lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        return input_file, output

    def test_both_tax_modes_and_derived_total_are_independent_per_person(self):
        rows = [data_row(1, source()), data_row(2, source(mortgage=True))]
        input_file, output = self.make_files(rows)
        self.assertEqual(recalculate_file(input_file, output), 2)
        with output.open(encoding="ascii", newline="") as stream:
            out = list(csv.DictReader(stream, delimiter="\t"))
        self.assertEqual(out[0]["TOTAL_DEDUCTIONS"], "1670000")
        self.assertEqual(out[1]["TOTAL_DEDUCTIONS"], "1670000")
        self.assertEqual(out[0]["STATUS"], "PROVISIONAL", out[0])
        self.assertEqual(out[0]["REFERENCE_LIMIT"], out[0]["FILING_LIMIT"])
        self.assertEqual(out[1]["STATUS"], "PROVISIONAL", out[1])
        self.assertNotEqual(out[1]["FILING_LIMIT"], "")
        self.assertNotEqual(out[0]["RECIPIENT_NAME_HEX"], out[1]["RECIPIENT_NAME_HEX"])
        self.assertEqual(out[1]["EDIT_MORTGAGE_CLAIM_COUNT"], "1")

    def test_editing_social_insurance_derives_total_and_holds_stale_tax(self):
        row = data_row(1, source())
        row["EDIT_SOCIAL_INSURANCE"] = 1_100_000
        input_file, output = self.make_files([row])
        recalculate_file(input_file, output)
        with output.open(encoding="ascii", newline="") as stream:
            actual = next(csv.DictReader(stream, delimiter="\t"))
        self.assertEqual(actual["TOTAL_DEDUCTIONS"], "1770000")
        self.assertEqual(actual["STATUS"], "HOLD")
        self.assertEqual(actual["REFERENCE_LIMIT"], "")
        self.assertEqual(actual["FILING_LIMIT"], "")

    def test_mortgage_unverifiable_fields_do_not_reuse_other_mode_amount(self):
        record = source(mortgage=True)
        record["fields"]["mortgage_claim_count"] = 2
        input_file, output = self.make_files([data_row(1, record)])
        recalculate_file(input_file, output)
        with output.open(encoding="ascii", newline="") as stream:
            row = next(csv.DictReader(stream, delimiter="\t"))
        self.assertEqual(row["STATUS"], "HOLD")
        self.assertEqual(row["REFERENCE_LIMIT"], "")
        self.assertEqual(row["FILING_LIMIT"], "")
        self.assertEqual(row["TOTAL_DEDUCTIONS"], "1670000")

    def test_invalid_metadata_and_out_of_order_page_preserve_no_output(self):
        row = data_row(2, source())
        path, output = self.make_files([row])
        with self.assertRaisesRegex(ValueError, "EDIT_PAGE_ORDER_INVALID"):
            recalculate_file(path, output)
        self.assertFalse(output.exists())
        row = data_row(1, source())
        row["EDIT_SOURCE_YEAR"] = "2027"
        path, output = self.make_files([row])
        with self.assertRaisesRegex(ValueError, "EDIT_YEAR_INVALID"):
            recalculate_file(path, output)
        self.assertFalse(output.exists())

    def test_formula_and_duplicate_columns_are_rejected(self):
        row = data_row(1, source())
        row["EDIT_SALARY_GROSS"] = "=1+2"
        path, output = self.make_files([row])
        with self.assertRaisesRegex(ValueError, "EDIT_NUMERIC_INVALID"):
            recalculate_file(path, output)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
