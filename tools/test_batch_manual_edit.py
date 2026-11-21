"""Synthetic-only local batch edit, no customer source files."""
import csv
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from audit_withholding_reconciliation import progressive_income_tax
from batch_manual_edit import INPUT_COLUMNS, recalculate_file
from bulk_salary_only import pack_editor_source, write_batch_bridge
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
        self.assertEqual(actual["REASON"], "EDIT_SOURCE_TAX_MISMATCH")

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

    def test_invalid_salary_and_spouse_edits_explain_hold(self):
        first = data_row(1, source())
        first["EDIT_SALARY_GROSS"] = 7_100_000
        second = data_row(2, source())
        second["EDIT_SPOUSE_DEDUCTION_REFERENCE"] = 380_000
        input_file, output = self.make_files([first, second])
        recalculate_file(input_file, output)
        with output.open(encoding="ascii", newline="") as stream:
            rows = list(csv.DictReader(stream, delimiter="\t"))
        self.assertEqual(rows[0]["STATUS"], "HOLD")
        self.assertEqual(rows[0]["REASON"], "EDIT_SALARY_INCOME_MISMATCH")
        self.assertEqual(rows[1]["STATUS"], "HOLD")
        self.assertEqual(rows[1]["REASON"], "EDIT_SPOUSE_DEDUCTION_REVIEW")
        self.assertEqual(rows[0]["REFERENCE_LIMIT"], "")
        self.assertEqual(rows[1]["FILING_LIMIT"], "")
        self.assertEqual(rows[0]["RECIPIENT_NAME_HEX"], first["RECIPIENT_NAME_HEX"])
        self.assertEqual(rows[1]["RECIPIENT_NAME_HEX"], second["RECIPIENT_NAME_HEX"])

    def test_partial_failure_does_not_overwrite_previous_bridge(self):
        """A later invalid person must never truncate an existing batch."""
        folder = TemporaryDirectory(prefix="synthetic_batch_atomic_")
        self.addCleanup(folder.cleanup)
        output = Path(folder.name) / "overview.tsv"
        original = b"PREVIOUS_VALID_BATCH_RETAINED\\n"
        output.write_bytes(original)
        good = {
            "PAGE": 1, "YEAR": 2026, "SALARY_GROSS": 7_000_000,
            "SALARY_INCOME": 5_200_000, "TOTAL_DEDUCTIONS": 1_670_000,
            "SOURCE_TAX": 284_300, "SOCIAL_INSURANCE": 1_000_000,
            "REFERENCE_LIMIT": 90_000, "STATUS": "PROVISIONAL",
            "REASON": "SALARY_ONLY_HYPOTHESIS",
        }
        invalid = {**good, "PAGE": 2, "STATUS": "HOLD",
                   "REASON": "SOURCE_REVIEW_REQUIRED"}
        with self.assertRaisesRegex(ValueError, "HOLD_WITH_REFERENCE_LIMIT"):
            write_batch_bridge([good, invalid], output)
        self.assertEqual(output.read_bytes(), original)
        self.assertEqual(sorted(p.name for p in Path(folder.name).iterdir()),
                         ["overview.tsv"])


    def test_family_category_rebuild_and_local_deduction_rates(self):
        from batch_source_deductions import reviewed_family_details
        values = {
            "dependent_general_count": (380_000, 330_000, 50_000),
            "dependent_special_count": (630_000, 450_000, 180_000),
            "dependent_elderly_count": (480_000, 380_000, 100_000),
            "dependent_cohabiting_elderly_count": (580_000, 450_000, 130_000),
        }
        for key, (income, resident, difference) in values.items():
            with self.subTest(category=key):
                item = source()
                item["fields"][key] = 1
                edited = data_row(1, item)
                if key == "dependent_general_count":
                    edited["EDIT_UNDER23_LIFE_ELIGIBLE_FLAG"] = "0"
                inp, out = self.make_files([edited])
                recalculate_file(inp, out)
                with out.open(encoding="ascii", newline="") as stream:
                    row = next(csv.DictReader(stream, delimiter="\t"))
                self.assertEqual(row["TOTAL_DEDUCTIONS"], str(1_670_000 + income))
                self.assertEqual(row["STATUS"], "HOLD")
                self.assertEqual(row["REFERENCE_LIMIT"], "")
                reviewed = reviewed_family_details(
                    {key: 1, "under23_life_eligible_flag": 0
                     if key == "dependent_general_count" else None}, 2026, 2026)
                self.assertEqual(reviewed["resident"], resident)
                self.assertEqual(reviewed["personal_difference"], 50_000 + difference)

    def test_under23_new_life_requires_review_when_general_age_unknown(self):
        item = source(insurance=120_000)
        item["fields"]["dependent_general_count"] = 1
        initial = data_row(1, item)
        inp, out = self.make_files([initial])
        recalculate_file(inp, out)
        with out.open(encoding="ascii", newline="") as stream:
            first = next(csv.DictReader(stream, delimiter="\t"))
        self.assertEqual(first["REASON"], "EDIT_FAMILY_DEDUCTION_REVIEW")
        initial["EDIT_UNDER23_LIFE_ELIGIBLE_FLAG"] = "1"
        confirmed_inp, confirmed_out = self.make_files([initial])
        recalculate_file(confirmed_inp, confirmed_out)
        with confirmed_out.open(encoding="ascii", newline="") as stream:
            confirmed = next(csv.DictReader(stream, delimiter="\t"))
        self.assertNotEqual(confirmed["REASON"], "EDIT_FAMILY_DEDUCTION_REVIEW")
        self.assertEqual(confirmed["TOTAL_DEDUCTIONS"], "2110000")

    def test_invalid_family_count_does_not_affect_second_person(self):
        first, second = data_row(1, source()), data_row(2, source())
        first["EDIT_DEPENDENT_SPECIAL_COUNT"] = "31"
        inp, out = self.make_files([first, second])
        recalculate_file(inp, out)
        with out.open(encoding="ascii", newline="") as stream:
            rows = list(csv.DictReader(stream, delimiter="\t"))
        self.assertEqual(rows[0]["REASON"], "EDIT_FAMILY_DEDUCTION_REVIEW")
        self.assertEqual(rows[0]["REFERENCE_LIMIT"], "")
        self.assertEqual(rows[1]["STATUS"], "PROVISIONAL")
        self.assertEqual(rows[1]["TOTAL_DEDUCTIONS"], "1670000")

    def test_explicit_zero_spouse_fields_do_not_create_false_hold(self):
        item = data_row(1, source())
        item["EDIT_SPOUSE_DEDUCTION_REFERENCE"] = "0"
        item["EDIT_SPOUSE_INCOME_REFERENCE"] = "0"
        item["EDIT_SPOUSE_ELIGIBILITY_FLAG"] = "0"
        inp, out = self.make_files([item])
        recalculate_file(inp, out)
        with out.open(encoding="ascii", newline="") as stream:
            row = next(csv.DictReader(stream, delimiter="\t"))
        self.assertEqual(row["TOTAL_DEDUCTIONS"], "1670000")
        self.assertEqual(row["STATUS"], "PROVISIONAL", row["REASON"])
        self.assertNotEqual(row["FILING_LIMIT"], "")

    def test_under16_family_levy_exemption_prevents_false_limit(self):
        example = source()
        example["fields"] = {
            "salary_gross": 2_600_000,
            "salary_reference": 1_740_000,
            "social_insurance": 200_000,
            "income_tax_withheld": 25_500,
            "under16_count": 3,
        }
        inp, out = self.make_files([data_row(1, example)])
        recalculate_file(inp, out)
        with out.open(encoding="ascii", newline="") as stream:
            row = next(csv.DictReader(stream, delimiter="\t"))
        self.assertEqual(row["TOTAL_DEDUCTIONS"], "1240000")
        self.assertEqual(row["REFERENCE_LIMIT"], "0")
        self.assertEqual(row["STATUS"], "PROVISIONAL")
        self.assertEqual(row["FILING_LIMIT"], "")

    def test_spouse_edit_uses_distinct_resident_deduction(self):
        record = source()
        record["fields"].update({
            "spouse_deduction_reference": 380_000,
            "spouse_income_reference": 0,
            "spouse_eligibility_flag": 1,
            "income_tax_withheld": 222_000,
        })
        inp, out = self.make_files([data_row(1, record)])
        recalculate_file(inp, out)
        with out.open(encoding="ascii", newline="") as stream:
            actual = next(csv.DictReader(stream, delimiter="\t"))
        self.assertEqual(actual["TOTAL_DEDUCTIONS"], "2050000")
        self.assertEqual(actual["R_RESIDENT_DEDUCTIONS"], "1760000")
        self.assertEqual(actual["STATUS"], "PROVISIONAL", actual["REASON"])

    def test_formula_and_duplicate_columns_are_rejected(self):
        row = data_row(1, source())
        row["EDIT_SALARY_GROSS"] = "=1+2"
        path, output = self.make_files([row])
        with self.assertRaisesRegex(ValueError, "EDIT_NUMERIC_INVALID"):
            recalculate_file(path, output)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
