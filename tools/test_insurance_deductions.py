"""Synthetic-only regression for independent insurance deductions."""
import unittest

from audit_insurance_deductions import (
    PREMIUM_KEYS, calculate_insurance,
)


def insurance(**changes):
    value = {key: 0 for key in PREMIUM_KEYS}
    value.update({
        "life_reference": 0,
        "earthquake_reference": 0,
        "distinct_earthquake_contracts_confirmed": True,
        "no_2026_under23_life_exception_confirmed": True,
    })
    value.update(changes)
    return value


class IndependentInsuranceDeductionTest(unittest.TestCase):
    def test_general_and_pension_plus_earthquake(self):
        r = calculate_insurance(year=2025, record=insurance(
            new_life=50_000, new_pension=50_000, earthquake=10_902,
            life_reference=65_000, earthquake_reference=10_902))
        self.assertEqual(r, {
            "national_life": 65_000, "resident_life": 53_000,
            "national_earthquake": 10_902, "resident_earthquake": 5_451})

    def test_fractional_yen_is_rounded_up_not_ignored(self):
        r = calculate_insurance(year=2025, record=insurance(
            new_life=5_613, care=28_501, earthquake=10_901,
            life_reference=29_864, earthquake_reference=10_901))
        self.assertEqual(r["national_life"], 29_864)
        self.assertEqual(r["resident_life"], 25_864)
        self.assertEqual(r["resident_earthquake"], 5_451)

    def test_old_life_and_new_pension_are_not_both_new(self):
        r = calculate_insurance(year=2025, record=insurance(
            old_life=157_924, new_pension=156_456, life_reference=90_000))
        self.assertEqual((r["national_life"],r["resident_life"]),
                         (90_000,63_000))

    def test_mixed_contract_selects_more_advantageous_old_only(self):
        r = calculate_insurance(year=2025, record=insurance(
            old_life=100_000, new_life=20_000, life_reference=50_000))
        self.assertEqual(r["national_life"], 50_000)
        self.assertEqual(r["resident_life"], 35_000)

    def test_old_long_and_earthquake_distinct_contract_caps(self):
        r = calculate_insurance(year=2025, record=insurance(
            earthquake=80_000, old_long=10_000, earthquake_reference=50_000))
        self.assertEqual(r["national_earthquake"], 50_000)
        self.assertEqual(r["resident_earthquake"], 25_000)

    def test_2026_dependent_exception_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"UNVERIFIED_2026"):
            calculate_insurance(year=2026, record=insurance(
                new_life=90_000, life_reference=40_000,
                no_2026_under23_life_exception_confirmed=False))
        self.assertEqual(calculate_insurance(year=2026,record=insurance(
            new_life=90_000, life_reference=40_000))["national_life"],40_000)

    def test_verified_2026_under23_table_boundaries_and_resident_unchanged(self):
        # Synthetic-only premiums; each exact transition is taken from NTA No.1140.
        cases = (
            (20_000, 20_000), (30_000, 30_000),
            (30_001, 30_001), (60_000, 45_000),
            (60_001, 45_001), (120_000, 60_000),
            (120_001, 60_000),
        )
        for paid, expected in cases:
            with self.subTest(paid=paid):
                r = calculate_insurance(year=2026, record=insurance(
                    new_life=paid, life_reference=expected,
                    no_2026_under23_life_exception_confirmed=False,
                    verified_2026_under23_dependent=True))
                self.assertEqual(r["national_life"], expected)
                self.assertLessEqual(r["resident_life"], 28_000)
                if paid == 120_000:
                    self.assertEqual(r["resident_life"], 28_000)
        no_exception = calculate_insurance(year=2026, record=insurance(
            new_life=120_000, life_reference=40_000))
        self.assertEqual(no_exception["national_life"], 40_000)
        self.assertEqual(no_exception["resident_life"], 28_000)

    def test_verified_2026_under23_mixed_old_new_and_total_cap(self):
        r = calculate_insurance(year=2026, record=insurance(
            new_life=120_000, old_life=100_000,
            care=100_000, new_pension=100_000,
            life_reference=120_000,
            no_2026_under23_life_exception_confirmed=False,
            verified_2026_under23_dependent=True))
        self.assertEqual(r["national_life"], 120_000)
        self.assertEqual(r["resident_life"], 70_000)
        old_only = calculate_insurance(year=2026, record=insurance(
            new_life=30_000, old_life=100_000,
            life_reference=50_000,
            no_2026_under23_life_exception_confirmed=False,
            verified_2026_under23_dependent=True))
        self.assertEqual(old_only["national_life"], 50_000)
        self.assertEqual(old_only["resident_life"], 35_000)

    def test_2026_old_premium_sixty_thousand_transition_no_illegal_sum(self):
        # Under the special 60k combined cap, old premiums at 60k may
        # combine; over 60k, the NTA No.1140 combined option is unavailable.
        for old_paid, expected_national, expected_resident in (
            (59_999, 60_000, 32_500),
            (60_000, 60_000, 32_500),
            (60_001, 40_001, 32_501),
            (100_000, 50_000, 35_000),
        ):
            with self.subTest(old_paid=old_paid):
                r = calculate_insurance(year=2026, record=insurance(
                    old_life=old_paid, new_life=30_000,
                    life_reference=expected_national,
                    no_2026_under23_life_exception_confirmed=False,
                    verified_2026_under23_dependent=True))
                self.assertEqual(r["national_life"], expected_national)
                self.assertEqual(r["resident_life"], expected_resident)

    def test_2026_new_only_can_outperform_old_only(self):
        result = calculate_insurance(year=2026, record=insurance(
            old_life=100_000, new_life=120_000,
            life_reference=60_000,
            no_2026_under23_life_exception_confirmed=False,
            verified_2026_under23_dependent=True))
        self.assertEqual(result["national_life"], 60_000)
        self.assertEqual(result["resident_life"], 35_000)

    def test_under23_eligibility_unknown_or_contradictory_is_hold(self):
        for changes in (
            {"no_2026_under23_life_exception_confirmed": False},
            {"verified_2026_under23_dependent": True},
            {"verified_2026_under23_dependent": 1,
             "no_2026_under23_life_exception_confirmed": False},
            {"verified_2026_under23_dependent": False,
             "no_2026_under23_life_exception_confirmed": False},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    calculate_insurance(year=2026, record=insurance(**changes))
        with self.assertRaisesRegex(ValueError, "SOURCE_YEAR"):
            calculate_insurance(year=2025, record=insurance(
                verified_2026_under23_dependent=False))

    def test_reference_and_missing_premium_fail_closed(self):
        for altered in (
            {"new_life": 70_000, "life_reference": 0},
            {"earthquake": 8_000, "earthquake_reference": 0},
            {"distinct_earthquake_contracts_confirmed": False},
        ):
            with self.subTest(altered=altered):
                with self.assertRaises(ValueError):
                    calculate_insurance(year=2025,record=insurance(**altered))
        for field in ("new_life", "earthquake", "life_reference"):
            with self.assertRaises(ValueError):
                calculate_insurance(year=2025,record=insurance(**{field:True}))
        for field in ("taxpayer_name", "address", "withholding_pdf"):
            with self.assertRaises(ValueError):
                calculate_insurance(year=2025,record=insurance(**{field:"PRIVATE"}))


if __name__ == "__main__":
    unittest.main(verbosity=2)
