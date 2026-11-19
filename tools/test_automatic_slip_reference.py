"""Anonymous synthetic tests for the source-only auto-reference pathway."""
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json
import subprocess
import sys

from bulk_salary_only import all_page_rows

from automatic_slip_reference import make_automatic_reference


def source(year=2025, **overrides):
    fields = {"salary_gross": 8_800_000,
              "salary_reference": 6_850_000,
              "deductions_reference": 2_871_190,
              "social_insurance": 2_183_340,
              "income_tax_withheld": 383_900,
              "basic_reference": 630_000}
    fields.update(overrides)
    return {"year": year, "fields": fields, "format": "PDF_TEXT", "warnings": []}


class AutoReferenceTests(unittest.TestCase):
    def test_reading_alone_returns_2026_number_as_explicit_hypothesis(self):
        result = make_automatic_reference(source(), 2026)
        self.assertEqual(result["status"], "AUTO_REFERENCE")
        self.assertEqual(result["target_year"], 2026)
        self.assertIsInstance(result["salary_income"], int)
        self.assertIsInstance(result["limit"], int)
        self.assertGreater(result["limit"], 0)
        self.assertEqual(result["limit"] % 1000, 0)
        self.assertIn("PRIOR_YEAR_CONDITIONS_CARRIED_FORWARD", result["reason"])
        self.assertIn("LOCAL_TAX_RESIDENCE_UNCONFIRMED", result["reason"])

    def test_unmodelled_housing_is_disclosed_not_claimed_exact(self):
        result = make_automatic_reference(
            source(mortgage_possible_credit=300_000), 2026)
        self.assertEqual(result["status"], "AUTO_REFERENCE")
        self.assertIn("MORTGAGE_CREDIT_NOT_MODELLED", result["reason"])

    def test_no_numeric_for_wrong_year_or_incomplete_deductions(self):
        for evidence, target in (
            (source(), 2027),
            (source(year=2026), 2025),
            (source(deductions_reference=100), 2026),
            ({**source(), "warnings": ["CONFLICT_salary_gross"]}, 2026),
            ({**source(), "format": "SCAN_OCR"}, 2026),
        ):
            report = make_automatic_reference(evidence, target)
            self.assertEqual(report["status"], "HOLD", report)
            self.assertNotIn("limit", report)

    def test_non_salary_facts_are_assumptions_never_certifications(self):
        candidate = make_automatic_reference(source(), 2025)
        self.assertEqual(candidate["status"], "AUTO_REFERENCE")
        self.assertNotIn("VERIFIED", candidate["status"])
        self.assertIn("NO_OTHER_CREDITS_ASSUMED", candidate["reason"])


    def test_batch_2026_reference_from_two_2025_pages_without_any_dialog(self):
        original = source()
        with patch("withholding_reader.pdf_page_count", return_value=2), \
                patch("withholding_reader.extract", side_effect=[original, original]):
            rows = all_page_rows(Path("synthetic.pdf"), target_year=2026)
        self.assertEqual(len(rows), 2)
        for index, row in enumerate(rows, 1):
            self.assertEqual(row["PAGE"], index)
            self.assertEqual(row["YEAR"], 2026)
            self.assertEqual(row["STATUS"], "PROVISIONAL")
            self.assertEqual(row["REASON"], "AUTO_SOURCE_ASSUMPTION")
            self.assertGreater(row["REFERENCE_LIMIT"], 0)
        with patch("withholding_reader.pdf_page_count", return_value=2), \
                patch("withholding_reader.extract", side_effect=[original, ValueError("damaged")]):
            rows = all_page_rows(Path("synthetic.pdf"), target_year=2026)
        self.assertEqual(rows[1]["STATUS"], "HOLD")
        self.assertEqual(rows[1]["REFERENCE_LIMIT"], "")

    def test_local_json_cli_exports_auto_reference_and_no_identifier(self):
        with TemporaryDirectory() as tmp:
            file = Path(tmp) / "synthetic.json"
            output = Path(tmp) / "result.json"
            bridge = Path(tmp) / "bridge.tsv"
            raw = source()
            file.write_text(json.dumps({
                "schema": "furusato-withholding/v1",
                "year": raw["year"],
                "fields": raw["fields"],
            }), encoding="utf-8")
            cli = Path(__file__).with_name("withholding_reader.py")
            run = subprocess.run([
                sys.executable, str(cli), "--input", str(file),
                "--output", str(output), "--bridge", str(bridge),
                "--auto-reference-year", "2026",
            ], text=True, capture_output=True, check=False, timeout=30)
            self.assertEqual(run.returncode, 0, run.stderr)
            data = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(data["automatic_reference"]["status"], "AUTO_REFERENCE")
            output_text = bridge.read_text(encoding="utf-8")
            self.assertIn("AUTO_STATUS\tAUTO_REFERENCE", output_text)
            self.assertIn("AUTO_SCOPE\tUNVERIFIED_SOURCE_ONLY", output_text)
            self.assertIn("AUTO_YEAR\t2026", output_text)
            self.assertNotIn("personal_name", output_text)
            self.assertNotIn("residential_address", output_text)

if __name__ == "__main__":
    unittest.main(verbosity=2)
