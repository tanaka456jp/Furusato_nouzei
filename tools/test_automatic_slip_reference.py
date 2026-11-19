"""Anonymous synthetic tests for the source-only auto-reference pathway."""
import unittest

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
