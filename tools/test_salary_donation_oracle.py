"""Only synthetic salary data; no identifying information in CI."""
import unittest
from fractions import Fraction
from audit_salary_donation_limit import independent_salary_ceiling, verified_family_deductions, independent_family_mortgage_case


class SalaryDonationOracleTest(unittest.TestCase):

    def test_independent_nta_fifth_table_regular_salary_bands_both_years(self):
        from audit_salary_donation_limit import independent_nta_fifth_table_salary_income as f
        fixtures = (
            (2025, 1_900_000, 1_250_000),
            (2025, 1_903_999, 1_250_000),
            (2025, 1_904_000, 1_252_800),
            (2026, 2_200_000, 1_460_000),
            (2026, 2_203_999, 1_460_000),
            (2026, 2_204_000, 1_462_800),
            (2025, 3_600_000, 2_440_000),
            (2026, 3_604_000, 2_443_200),
            (2026, 4_390_000, 3_070_400),
            (2025, 6_599_999, 4_836_800),
            (2026, 6_599_999, 4_836_800),
            (2025, 6_600_000, 4_840_000),
            (2026, 8_500_001, 6_550_001),
        )
        for year, gross, expected in fixtures:
            with self.subTest(year=year, gross=gross):
                self.assertEqual(f(year, gross), expected)
        # Below the independently covered regular bands, request exact
        # government-table inspection rather than interpolate.
        for year, gross in ((2025, 1_899_999), (2026, 2_199_999),
                            (2026, 2_191_000), (2025, 1_000_000)):
            with self.subTest(year=year, gross=gross):
                with self.assertRaisesRegex(ValueError, "ROW_VERIFICATION"):
                    f(year, gross)
        for year, gross in ((2027, 3_000_000), (2026, True),
                            (2025, 20_000_001)):
            with self.assertRaises(ValueError):
                f(year, gross)

    def test_verified_under23_salary_adjustment_rounds_up_to_yen(self):
        from audit_salary_donation_limit import independent_under23_salary_adjustment
        cases = {
            8_500_000: 0,
            8_500_001: 1,
            8_500_009: 1,
            8_500_010: 1,
            8_500_011: 2,
            9_000_001: 50_001,
            9_999_999: 150_000,
            10_000_001: 150_000,
        }
        for gross, expected in cases.items():
            with self.subTest(gross=gross):
                self.assertEqual(independent_under23_salary_adjustment(
                    gross,has_eligible_under23=True),expected)
                self.assertEqual(independent_under23_salary_adjustment(
                    gross,has_eligible_under23=False),0)
        for invalid in (8_500_001.0, "8500001", True, -1):
            with self.assertRaises(ValueError):
                independent_under23_salary_adjustment(
                    invalid,has_eligible_under23=True)
        with self.assertRaises(ValueError):
            independent_under23_salary_adjustment(
                8_500_001,has_eligible_under23=1)

    def test_insurance_difference_does_not_replace_statutory_special_ratio_basis(self):
        # Under the local-tax statute the special rate uses resident-tax
        # taxable income minus prescribed human/basic deduction differences.
        # Do NOT replace this with actual national income-tax taxable income.
        # Synthetic 2026: 5m salary income, 2.3m social, 120k national vs
        # 70k resident life deduction. Actual national taxable is 1.91m,
        # but the statutory special-rate basis is 2.2m - 50k - 190k = 1.96m.
        result = independent_salary_ceiling(
            year=2026, salary_income=5_000_000,
            resident_deductions=2_800_000, personal_difference=50_000)
        self.assertEqual(result["resident_taxable_income"], 2_200_000)
        self.assertEqual(result["special_ratio"], Fraction(79_790, 100_000))
        self.assertEqual(result["resident_income_levy"], 217_500)
        self.assertEqual(result["thousand_yen_reference"], 56_000)
        self.assertEqual(5_000_000 - (2_300_000 + 670_000 + 120_000),
                         1_910_000)

    def test_negative_special_ratio_uses_90_pct_but_zero_uses_84895(self):
        for year in (2025,2026):
            negative=independent_salary_ceiling(
                year=year,salary_income=1_000_000,
                resident_deductions=500_000,personal_difference=50_000)
            self.assertEqual(negative["special_ratio"],Fraction(9,10))
            self.assertEqual(negative["resident_income_levy"],47_500)
            self.assertEqual(negative["thousand_yen_reference"],12_000)
        # 2025 basis = 520k - 50k - (950k-480k) = exactly zero.
        zero=independent_salary_ceiling(
            year=2025,salary_income=1_000_000,
            resident_deductions=480_000,personal_difference=50_000)
        self.assertEqual(zero["special_ratio"],Fraction(84895,100000))
        self.assertEqual(zero["thousand_yen_reference"],13_000)
        self.assertEqual(zero["donation_limit"],"NOT_VERIFIED")

    def test_spouse_income_tiers_and_kyoto_income_levy_exemption(self):
        from audit_salary_donation_limit import resident_income_levy_exemption_limit
        for year in (2025, 2026):
            # Salary-only total income at the 900/950/1000万円 boundaries.
            for kind, amounts in (
                ("ordinary", ((9_000_000, (380000, 330000, 50000)),
                              (9_000_001, (260000, 220000, 40000)),
                              (9_500_000, (260000, 220000, 40000)),
                              (9_500_001, (130000, 110000, 20000)),
                              (10_000_000, (130000, 110000, 20000)))),
                ("elderly", ((9_000_000, (480000, 380000, 100000)),
                             (9_000_001, (320000, 260000, 60000)),
                             (9_500_000, (320000, 260000, 60000)),
                             (9_500_001, (160000, 130000, 30000)),
                             (10_000_000, (160000, 130000, 30000))))):
                for income, (national, resident, diff) in amounts:
                    with self.subTest(year=year, spouse=kind, income=income):
                        r=verified_family_deductions(
                            year=year,salary_income=income,
                            social_insurance=0,spouse=kind)
                        self.assertEqual(r["national_deductions"]-r["national_basic"],national)
                        self.assertEqual(r["resident_deductions"]-430000,resident)
                        self.assertEqual(r["personal_difference"]-50000,diff)
            # Under-16 children add no ordinary deduction, but do count
            # toward the national uniform resident income-levy exemption.
            self.assertEqual([resident_income_levy_exemption_limit(n)
                              for n in range(4)],
                             [450000,1120000,1470000,1820000])
            for eligible_count, income in ((0,450000),(1,1120000),
                                           (2,1470000),(3,1820000)):
                r=verified_family_deductions(
                    year=year,salary_income=income,social_insurance=0,
                    under16=eligible_count)
                self.assertTrue(r["resident_income_levy_exempt"])
                self.assertFalse(verified_family_deductions(
                    year=year,salary_income=income+1,social_insurance=0,
                    under16=eligible_count)["resident_income_levy_exempt"])
            # This case otherwise has a positive resident taxable income
            # (1.1m - 630k), but no resident income levy because of the child.
            with self.assertRaisesRegex(ValueError, "INCOME_LEVY_EXEMPT"):
                independent_family_mortgage_case(
                    year=year,salary_income=1100000,
                    social_insurance=200000,under16=1)
            self.assertEqual(
                verified_family_deductions(
                    year=year,salary_income=1100000,
                    social_insurance=200000,under16=0
                )["resident_income_levy_exempt"],False)
        with self.assertRaises(ValueError):
            resident_income_levy_exemption_limit(True)
        with self.assertRaises(ValueError):
            verified_family_deductions(
                year=2025,salary_income=10000001,
                social_insurance=0,spouse="ordinary")

    def test_spouse_dependents_and_housing_two_years(self):
        # Independent published basic, spouse and dependent deductions.
        # Each row is synthetic, salary ¥7m / income ¥5.2m / social ¥1m.
        rows=(
            (2025,"none",0,0,0,1_430_000,50_000,374_500,109_000,286_500,13_500),
            (2025,"ordinary",0,0,0,1_760_000,100_000,341_500,87_000,221_500,78_500),
            (2025,"ordinary",1,0,2,2_090_000,150_000,308_500,79_000,183_500,97_500),
            (2025,"ordinary",0,1,0,2_210_000,280_000,296_500,76_000,158_500,97_500),
            (2026,"none",0,0,0,1_430_000,50_000,374_500,109_000,278_500,21_500),
            (2026,"ordinary",0,0,0,1_760_000,100_000,341_500,87_000,217_500,82_500),
            (2026,"ordinary",1,0,2,2_090_000,150_000,308_500,79_000,179_500,97_500),
            (2026,"ordinary",0,1,0,2_210_000,280_000,296_500,76_000,154_500,97_500),
        )
        for (year,spouse,general,special,under16,rd,pd,levy,rounded,national,housing) in rows:
            with self.subTest(year=year,spouse=spouse,general=general,
                              special=special,under16=under16):
                case=independent_family_mortgage_case(
                    year=year,salary_income=5_200_000,
                    social_insurance=1_000_000,spouse=spouse,
                    general=general,special=special,under16=under16,
                    mortgage_possible=300_000,occupancy_year=2024)
                self.assertEqual(case["resident_deductions"],rd)
                self.assertEqual(case["personal_difference"],pd)
                self.assertEqual(case["resident_income_levy"],levy)
                self.assertEqual(case["thousand_yen_reference"],rounded)
                self.assertEqual(case["national_income_tax_before_credit"],national)
                self.assertEqual(case["housing_applied_national"],national)
                self.assertEqual(case["housing_resident_transfer"],housing)
                self.assertEqual(case["donation_limit"],"NOT_VERIFIED")
                self.assertEqual(case["scope"],"SYNTHETIC_ONLY")

    def test_verified_family_composition_fail_closed(self):
        baseline=verified_family_deductions(
            year=2026,salary_income=5_200_000,social_insurance=1_000_000,
            spouse="ordinary",general=1)
        with_children=verified_family_deductions(
            year=2026,salary_income=5_200_000,social_insurance=1_000_000,
            spouse="ordinary",general=1,under16=2)
        self.assertEqual(baseline["resident_deductions"],
                         with_children["resident_deductions"])
        self.assertEqual(with_children["under16_count"],2)
        for kwargs in ({"spouse":"unverified"},{"general":-1},
                       {"special":31},{"under16":31},
                       {"salary_income":12_000_000,"spouse":"ordinary"}):
            values=dict(year=2025,salary_income=5_200_000,
                        social_insurance=1_000_000)
            values.update(kwargs)
            with self.assertRaises(ValueError):
                verified_family_deductions(**values)
        with self.assertRaisesRegex(ValueError,"UNVERIFIED_MORTGAGE_CLASS"):
            independent_family_mortgage_case(
                year=2026,salary_income=5_200_000,
                social_insurance=1_000_000,mortgage_possible=300_000,
                occupancy_year=2022)

    def test_one_stop_housing_resident_capacity_boundaries(self):
        from audit_salary_donation_limit import independent_one_stop_after_housing
        cases = (
            (120_000, 200_000, 40_000, 160_000, 120_000),
            (120_000, 110_000, 30_000, 80_000, 82_000),
            (120_000, 110_000, 109_999, 1, 2_000),
            (120_000, 110_000, 110_000, 0, 0),
            (120_000, 110_000, 120_000, 0, 0),
        )
        for nominal, levy, housing, available, adjusted in cases:
            with self.subTest(levy=levy, housing=housing):
                result = independent_one_stop_after_housing(
                    nominal_thousand_yen=nominal,
                    resident_income_levy=levy,
                    resident_mortgage_credit=housing)
                self.assertEqual(result["resident_income_levy_after_housing"],
                                 available)
                self.assertEqual(
                    result["one_stop_effective_thousand_yen_reference"],
                    adjusted)
                self.assertLessEqual(adjusted, nominal)
                if adjusted > 0:
                    self.assertLessEqual(adjusted - 2_000, available)
        for wrong in (True, -1, 123.45):
            with self.assertRaises(ValueError):
                independent_one_stop_after_housing(
                    nominal_thousand_yen=120_000,
                    resident_income_levy=110_000,
                    resident_mortgage_credit=wrong)
        with self.assertRaisesRegex(ValueError, "NOMINAL_CAP"):
            independent_one_stop_after_housing(
                nominal_thousand_yen=120_001,
                resident_income_levy=110_000,
                resident_mortgage_credit=30_000)

    def test_municipal_published_example(self):
        # 2025 income ¥2,020,000, municipal levy ¥114,500; ceiling ≈ ¥28,974.
        r=independent_salary_ceiling(year=2025,salary_income=2_020_000,
                                    resident_deductions=850_000)
        self.assertEqual(r["resident_taxable_income"],1_170_000)
        self.assertEqual(r["resident_income_levy"],114_500)
        self.assertEqual(r["special_ratio"],Fraction(84895,100000))
        self.assertEqual(int(r["theoretical_ceiling"]),28_974)
        self.assertEqual(r["thousand_yen_reference"],28_000)
        self.assertEqual(r["donation_limit"],"NOT_VERIFIED")

    def test_salary_7m_current_workbook_reference_both_years(self):
        for year,basic in ((2025,630_000),(2026,670_000)):
            r=independent_salary_ceiling(year=year,salary_income=5_200_000,
                                        resident_deductions=1_430_000)
            self.assertEqual(r["national_basic_deduction"],basic)
            self.assertEqual(r["resident_taxable_income"],3_770_000)
            self.assertEqual(r["resident_income_levy"],374_500)
            self.assertEqual(r["special_ratio"],Fraction(69580,100000))
            self.assertEqual(r["thousand_yen_reference"],109_000)
            self.assertLessEqual((109_000-2_000)*r["special_ratio"],
                                 r["special_20pct_cap"])
            self.assertGreater((110_000-2_000)*r["special_ratio"],
                               r["special_20pct_cap"])
            self.assertEqual(r["scope"],"SYNTHETIC_ONLY")

    def test_city_prefecture_split_and_integer_year(self):
        for municipality in ("standard","designated"):
            r=independent_salary_ceiling(year=2026,salary_income=5_200_000,
                 resident_deductions=1_430_000,municipality=municipality)
            self.assertEqual(sum(r["resident_income_levy_parts"]),
                             r["resident_income_levy"])
            self.assertEqual(r["resident_income_levy"],374_500)
        for invalid in (2026.0,"2026",True,2027):
            with self.assertRaises(ValueError):
                independent_salary_ceiling(year=invalid,salary_income=5_200_000,
                                             resident_deductions=1_430_000)
        with self.assertRaises(ValueError):
            independent_salary_ceiling(year=2026,salary_income=5_200_000,
                       resident_deductions=1_430_000,municipality="unknown")

    def test_single_taxpayer_universal_exemption_fails_closed(self):
        for year in (2025, 2026):
            with self.assertRaisesRegex(ValueError, "INCOME_LEVY_EXEMPT"):
                independent_salary_ceiling(
                    year=year, salary_income=450000,
                    resident_deductions=100000)
            # The next yen is not automatically exempt: individual tax
            # deductions and locally verified family status still matter.
            example=independent_salary_ceiling(
                year=year, salary_income=450001,
                resident_deductions=100000)
            self.assertEqual(example["donation_limit"],"NOT_VERIFIED")

    def test_income_cap_and_non_taxable_are_not_approved(self):
        r=independent_salary_ceiling(year=2025,salary_income=1_500_000,
                                    resident_deductions=1_000_000)
        self.assertLessEqual(r["theoretical_ceiling"],Fraction(450_000))
        with self.assertRaises(ValueError):
            independent_salary_ceiling(year=2025,salary_income=430_000,
                                      resident_deductions=430_000)


if __name__ == "__main__":
    unittest.main(verbosity=2)
