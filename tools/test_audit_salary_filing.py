"""Synthetic no-housing filing model and two-method separation tests."""
import unittest
from unittest.mock import patch
from audit_salary_filing import calculate_salary_filing_case, independent_salary_filing_ceiling
from automatic_slip_reference import make_automatic_reference


class FilingModelTests(unittest.TestCase):
    def source(self):
        return {"year": 2026, "format": "PDF_TEXT", "warnings": [],
                "municipality_hint": {"class": "STANDARD"},
                "fields": {"salary_gross": 7_000_000,
                           "salary_reference": 5_200_000,
                           "deductions_reference": 1_670_000,
                           "basic_reference": 670_000,
                           "social_insurance": 1_000_000,
                           "under16_count": 0,
                           "income_tax_withheld": 284_300}}

    def test_independent_national_and_local_savings(self):
        actual = calculate_salary_filing_case(
            year=2026, salary_income=5_200_000,
            national_deductions=1_670_000, resident_deductions=1_430_000,
            donation=3_000)
        self.assertGreater(actual["national_tax_saving"], 0)
        self.assertGreater(actual["resident_tax_saving"], 0)
        self.assertTrue(actual["within_2000_yen_reference"])
        self.assertEqual(actual["total_saving"],
                         actual["national_tax_saving"] + actual["resident_tax_saving"])

    def test_two_paths_not_copied_for_no_mortgage(self):
        evidence = self.source()
        result = make_automatic_reference(evidence, 2026)
        self.assertEqual(result["status"], "AUTO_REFERENCE", result)
        independent = independent_salary_filing_ceiling(
            year=2026, salary_income=5_200_000,
            national_deductions=1_670_000,
            resident_deductions=1_430_000)
        self.assertEqual(result["filing_limit"],
                         independent["tax_return_thousand_yen_reference"])
        with patch("audit_salary_filing.independent_salary_filing_ceiling",
                   return_value={"tax_return_thousand_yen_reference": 5_000}):
            changed = make_automatic_reference(evidence, 2026)
        self.assertEqual(changed["filing_limit"], 5_000)
        self.assertEqual(changed["limit"], result["limit"])

    def test_unknown_locality_or_tax_mismatch_keeps_filing_blank(self):
        item = self.source()
        item["municipality_hint"]["class"] = "UNCERTAIN"
        first = make_automatic_reference(item, 2026)
        self.assertEqual(first["status"], "AUTO_REFERENCE")
        self.assertIsNone(first["filing_limit"])
        item["municipality_hint"]["class"] = "STANDARD"
        item["fields"]["income_tax_withheld"] = 0
        second = make_automatic_reference(item, 2026)
        self.assertEqual(second["status"], "AUTO_REFERENCE")
        self.assertIsNone(second["filing_limit"])

    def test_filing_year_and_donation_invalid(self):
        for year, amount in ((2027, 3_000), (2026, 1_000)):
            with self.assertRaises(ValueError):
                calculate_salary_filing_case(
                    year=year, salary_income=5_200_000,
                    national_deductions=1_670_000,
                    resident_deductions=1_430_000, donation=amount)


if __name__ == "__main__":
    unittest.main(verbosity=2)
