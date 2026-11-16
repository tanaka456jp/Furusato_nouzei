"""Synthetic-only regression for housing-credit tax-return donation allocation."""
import unittest

from audit_mortgage_filing import (
    calculate_mortgage_filing_case, independent_mortgage_filing_ceiling,
)


class MortgageFilingTest(unittest.TestCase):
    def setUp(self):
        self.example = dict(
            year=2026, salary_income=5_200_000,
            national_deductions=1_670_000,
            resident_deductions=1_430_000,
            occupancy_year=2024, municipality="standard",
            personal_difference=50_000,
        )

    def _case(self, mortgage, donation, **changes):
        inputs = {**self.example, **changes}
        return calculate_mortgage_filing_case(
            **inputs, mortgage_possible=mortgage, donation=donation)

    def test_mortgage_below_income_tax_keeps_reference(self):
        nominal = self._case(100_000, 109_000)
        self.assertEqual(nominal["income_tax_before_housing_and_donation"],
                         278_500)
        self.assertEqual(nominal["resident_income_levy"], 374_500)
        self.assertEqual(nominal["resident_housing_before"], 0)
        self.assertEqual(nominal["resident_housing_after"], 0)
        self.assertEqual(nominal["total_tax_saving"], 106_999)
        self.assertTrue(nominal["within_2000_yen_reference"])
        above = self._case(100_000, 110_000)
        self.assertEqual(above["estimated_personal_burden"], 2_246)
        self.assertFalse(above["within_2000_yen_reference"])
        reference = independent_mortgage_filing_ceiling(
            **self.example, mortgage_possible=100_000)
        self.assertEqual(reference["tax_return_thousand_yen_reference"],
                         109_000)
        self.assertEqual(reference["donation_limit"], "NOT_VERIFIED")
        self.assertEqual(reference["scope"], "SYNTHETIC_ONLY")

    def test_national_housing_pushes_into_resident_and_raises_burden(self):
        full = self._case(300_000, 109_000)
        self.assertEqual(full["national_housing_applied_before"], 278_500)
        self.assertEqual(full["resident_housing_before"], 21_500)
        self.assertEqual(full["resident_housing_after"], 42_900)
        self.assertEqual(full["resident_donation_applied"], 85_150)
        self.assertEqual(full["total_tax_saving"], 106_550)
        self.assertEqual(full["estimated_personal_burden"], 2_450)
        self.assertFalse(full["within_2000_yen_reference"])
        small = self._case(300_000, 3_000)
        self.assertEqual(small["estimated_personal_burden"], 2_005)
        self.assertFalse(small["within_2000_yen_reference"])
        reference = independent_mortgage_filing_ceiling(
            **self.example, mortgage_possible=300_000)
        # This is a conservative strict-2,000-yen *reference*, not a
        # judgment that a 109,000-yen donation is necessarily undesirable.
        self.assertEqual(reference["tax_return_thousand_yen_reference"],
                         2_000)

    def test_housing_resident_cap_saturation(self):
        maxed = self._case(400_000, 109_000)
        self.assertEqual(maxed["resident_housing_before"], 97_500)
        self.assertEqual(maxed["resident_housing_after"], 97_500)
        self.assertEqual(maxed["estimated_personal_burden"], 23_850)
        self.assertFalse(maxed["within_2000_yen_reference"])

    def test_2022_5pct_and_7pct_require_explicit_class(self):
        default = dict(self.example, occupancy_year=2022)
        five = calculate_mortgage_filing_case(
            **default, mortgage_possible=1_000_000, donation=2_000,
            housing_class="verified_2022_5pct")
        seven = calculate_mortgage_filing_case(
            **default, mortgage_possible=1_000_000, donation=2_000,
            housing_class="transitional_7pct")
        self.assertEqual(five["resident_housing_before"], 97_500)
        self.assertEqual(seven["resident_housing_before"], 136_500)
        self.assertEqual(five["statutory_special_cap"],
                         seven["statutory_special_cap"])
        with self.assertRaisesRegex(ValueError, "UNVERIFIED_2022"):
            self._case(1_000_000, 2_000, occupancy_year=2022)
        with self.assertRaisesRegex(ValueError, "INELIGIBLE_TRANSITION"):
            self._case(1_000_000, 2_000, housing_class="transitional_7pct")

    def test_2026_first_year_filing_allowed_but_not_one_stop(self):
        example = self._case(
            300_000, 3_000, occupancy_year=2026)
        self.assertEqual(example["resident_housing_before"], 21_500)
        self.assertFalse(example["within_2000_yen_reference"])

    def test_invalid_source_and_donation_scope_fail_closed(self):
        for kwargs in (
            {"mortgage_possible": -1}, {"mortgage_possible": 0},
            {"mortgage_possible": True}, {"mortgage_possible": 1.5},
            {"donation": 1_999}, {"donation": 2_000_000},
            {"occupancy_year": 2021}, {"occupancy_year": 2027},
            {"housing_class": "assume_7pct"},
            {"year": 2027},
            {"national_deductions": 6_000_000},
            {"resident_deductions": -1},
        ):
            values = dict(self.example, mortgage_possible=300_000,
                          donation=10_000)
            values.update(kwargs)
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                calculate_mortgage_filing_case(**values)


if __name__ == "__main__":
    unittest.main(verbosity=2)
