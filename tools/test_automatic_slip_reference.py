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

    def test_source_g01_candidate_is_used_only_as_local_tax_hypothesis(self):
        original = source()
        original["municipality_hint"] = {"name": "京都市", "class": "DESIGNATED"}
        result = make_automatic_reference(original, 2026)
        self.assertEqual(result["status"], "AUTO_REFERENCE")
        self.assertIn("MUNICIPALITY_FROM_DOCUMENT_ASSUMED", result["reason"])
        self.assertIn("LOCAL_TAX_RESIDENCE_UNCONFIRMED", result["reason"])
        original["municipality_hint"] = {"name": "名古屋市", "class": "SPECIAL"}
        special = make_automatic_reference(original, 2026)
        self.assertEqual(special["status"], "AUTO_REFERENCE")
        self.assertIn("MUNICIPALITY_RATE_UNCERTAIN", special["reason"])

    def test_numeric_trace_matches_the_same_selected_model(self):
        result = make_automatic_reference(source(), 2026)
        trace = result["report_trace"]
        self.assertEqual(trace["R_SOURCE_YEAR"], 2025)
        self.assertEqual(trace["R_SOURCE_BASIC"], 630000)
        self.assertEqual(trace["R_SPECIAL_CAP"], trace["R_RESIDENT_LEVY"] // 5)
        self.assertGreater(trace["R_RESIDENT_TAXABLE"], 0)
        self.assertGreater(trace["R_SPECIAL_RATIO_PPM"], 0)
        self.assertEqual(trace["R_MODEL_LOCALITY"], "UNCERTAIN")
        self.assertNotIn("name", str(trace).lower())

    def test_unverified_housing_is_hold_not_an_undiscounted_limit(self):
        result = make_automatic_reference(
            source(mortgage_possible_credit=300_000), 2026)
        self.assertEqual(result["status"], "HOLD")
        self.assertNotIn("limit", result)

    def test_same_year_2026_mortgage_is_one_stop_and_comparison_stays_optional(self):
        candidate = source(
            year=2026, salary_gross=7_000_000,
            salary_reference=5_200_000, deductions_reference=1_670_000,
            social_insurance=1_000_000, basic_reference=670_000,
            income_tax_withheld=0, mortgage_possible_credit=300_000,
            mortgage_credit=278_500, mortgage_occupancy_year=2024)
        actual = make_automatic_reference(candidate, 2026)
        self.assertEqual(actual["status"], "AUTO_REFERENCE", actual)
        self.assertTrue(actual["mortgage_mode"])
        self.assertEqual(actual["limit"] % 1000, 0)
        self.assertIn("NO_TAX_RETURN_ONE_STOP_ASSUMED", actual["reason"])
        self.assertIn("MORTGAGE_ONE_STOP_5PCT_MODEL_PROVISIONAL", actual["reason"])
        self.assertNotIn("MORTGAGE_CREDIT_NOT_MODELLED", actual["reason"])
        self.assertNotIn("name", str(actual["report_trace"]).lower())
        # Same source reused for the next tax year must not project the
        # mortgage balance, housing credit and residency as already known.
        projected = make_automatic_reference(candidate, 2025)
        self.assertEqual(projected["status"], "HOLD")

    def test_special_locality_and_omitted_housing_carryover_are_hold(self):
        annual = source(
            year=2026, salary_gross=7_000_000,
            salary_reference=5_200_000, deductions_reference=1_670_000,
            social_insurance=1_000_000, basic_reference=670_000,
            income_tax_withheld=0, mortgage_possible_credit=300_000,
            mortgage_credit=278_500, mortgage_occupancy_year=2024)
        annual["municipality_hint"] = {"name": "synthetic city",
                                        "class": "SPECIAL"}
        special = make_automatic_reference(annual, 2026)
        self.assertEqual(special["status"], "HOLD")
        self.assertEqual(special["reason"], "MORTGAGE_LOCAL_TAX_REVIEW")
        self.assertNotIn("limit", special)
        annual["municipality_hint"] = {"class": "STANDARD"}
        del annual["fields"]["mortgage_possible_credit"]
        unverified = make_automatic_reference(annual, 2026)
        self.assertEqual(unverified["status"], "HOLD")
        self.assertEqual(unverified["reason"],
                         "MORTGAGE_POSSIBLE_AMOUNT_MISSING")
        self.assertNotIn("limit", unverified)
        with patch("withholding_reader.pdf_page_count", return_value=2), \
             patch("withholding_reader.extract",
                   side_effect=[annual, annual]):
            rows = all_page_rows(Path("synthetic.pdf"), target_year=2026)
        self.assertTrue(all(row["STATUS"] == "HOLD" for row in rows))
        self.assertEqual(
            [row["REASON"] for row in rows],
            ["MORTGAGE_POSSIBLE_AMOUNT_MISSING"] * 2)

    def test_first_year_and_2022_mortgage_classes_fail_closed(self):
        base = dict(year=2026, salary_gross=7_000_000,
                    salary_reference=5_200_000, deductions_reference=1_670_000,
                    social_insurance=1_000_000, basic_reference=670_000,
                    income_tax_withheld=0, mortgage_possible_credit=300_000,
                    mortgage_credit=278_500)
        for occupancy in (2022, 2026, 2027):
            with self.subTest(occupancy=occupancy):
                proposal = make_automatic_reference(
                    source(**base, mortgage_occupancy_year=occupancy), 2026)
                self.assertEqual(proposal["status"], "HOLD", proposal)
                self.assertNotIn("limit", proposal)

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

    def test_native_blank_g26_is_only_a_provisional_zero_hypothesis(self):
        original = source(social_insurance=0, deductions_reference=630000)
        original["warnings"] = ["BLANK_SOCIAL_INSURANCE_REQUIRES_REVIEW"]
        proposed = make_automatic_reference(original, 2026)
        self.assertEqual(proposed["status"], "AUTO_REFERENCE")
        self.assertIn("BLANK_SOCIAL_INSURANCE_ASSUMED_ZERO", proposed["reason"])
        original["fields"].pop("social_insurance")
        self.assertEqual(make_automatic_reference(original, 2026)["status"], "HOLD")

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

    def test_v4_mortgage_filing_amount_is_numeric_and_never_in_hold(self):
        import csv
        from bulk_salary_only import write_batch_bridge
        valid = source(year=2026)
        with patch("withholding_reader.pdf_page_count", return_value=2), \
             patch("withholding_reader.extract", side_effect=[valid, valid]), \
             patch("automatic_slip_reference.make_automatic_reference") as model:
            model.return_value = make_automatic_reference(valid, 2026)
            # Artificially inject a comparison only for transport testing:
            # this does NOT assert real tax-filing superiority.
            model.return_value["filing_higher_limit"] = (
                model.return_value["limit"] + 10_000)
            model.return_value["mortgage_mode"] = True
            rows = all_page_rows(Path("synthetic.pdf"), target_year=2026)
        self.assertEqual(rows[0]["FILING_LIMIT"], rows[0]["REFERENCE_LIMIT"]+10_000)
        self.assertEqual(rows[0]["REASON"], "AUTO_ONE_STOP_HOUSING")
        with TemporaryDirectory() as folder:
            target = Path(folder) / "batch.tsv"
            write_batch_bridge(rows, target)
            with target.open(encoding="ascii", newline="") as f:
                observed = list(csv.DictReader(f, delimiter="\t"))
        self.assertEqual(len(observed), 2)
        self.assertEqual(observed[0]["FILING_LIMIT"],
                         str(rows[0]["FILING_LIMIT"]))
        rows[0]["FILING_LIMIT"] = rows[0]["REFERENCE_LIMIT"] - 1_000
        with TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, "INVALID_FILING_COMPARISON"):
                write_batch_bridge(rows, Path(folder) / "invalid.tsv")

    def test_v3_name_hex_retains_exact_person_page_association(self):
        import csv
        from recipient_name import encode
        from bulk_salary_only import write_batch_bridge, REPORT_COLUMNS
        valid = source()
        valid["recipient_name_hex"] = encode("山田 太郎")
        other = {**source(), "warnings": ["INVALID_SALARY"],
                 "recipient_name_hex": encode("佐藤 花子")}
        with patch("withholding_reader.pdf_page_count", return_value=2), \
                patch("withholding_reader.extract", side_effect=[valid, other]):
            rows = all_page_rows(Path("synthetic.pdf"), target_year=2026)
        self.assertEqual(rows[0]["PAGE"], 1)
        self.assertEqual(rows[1]["PAGE"], 2)
        self.assertNotEqual(rows[0]["RECIPIENT_NAME_HEX"],
                            rows[1]["RECIPIENT_NAME_HEX"])
        with TemporaryDirectory() as tmp:
            target = Path(tmp) / "batch.tsv"
            write_batch_bridge(rows, target)
            text = target.read_text(encoding="ascii")
            self.assertNotIn("山田", text)
            self.assertNotIn("佐藤", text)
            with target.open(encoding="ascii", newline="") as handle:
                observed = list(csv.DictReader(handle, delimiter="\t"))
        self.assertEqual(observed[0]["RECIPIENT_NAME_HEX"], encode("山田 太郎"))
        self.assertEqual(observed[1]["RECIPIENT_NAME_HEX"], encode("佐藤 花子"))
        self.assertEqual(observed[1]["STATUS"], "HOLD")
        self.assertTrue(all(observed[1][key] == "" for key in REPORT_COLUMNS))
        rows[1]["RECIPIENT_NAME_HEX"] = "003D00530055004D0028"
        with TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                write_batch_bridge(rows, Path(tmp) / "invalid.tsv")

    def test_v2_per_page_report_bridge_holds_unsafe_pages_without_details(self):
        import csv
        from bulk_salary_only import write_batch_bridge, REPORT_COLUMNS
        valid = source()
        invalid = {**source(), "warnings": ["INVALID_SALARY"]}
        with patch("withholding_reader.pdf_page_count", return_value=2), \
                patch("withholding_reader.extract", side_effect=[valid, invalid]):
            rows = all_page_rows(Path("synthetic.pdf"), target_year=2026)
        with TemporaryDirectory() as tmp:
            out = Path(tmp) / "batch.tsv"
            write_batch_bridge(rows, out)
            with out.open(encoding="ascii", newline="") as f:
                lines = list(csv.DictReader(f, delimiter="\t"))
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0]["STATUS"], "PROVISIONAL")
        self.assertEqual(lines[0]["R_SOURCE_YEAR"], "2025")
        self.assertGreater(int(lines[0]["R_RESIDENT_LEVY"]), 0)
        self.assertEqual(lines[1]["STATUS"], "HOLD")
        self.assertTrue(all(lines[1][k] == "" for k in REPORT_COLUMNS))

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
