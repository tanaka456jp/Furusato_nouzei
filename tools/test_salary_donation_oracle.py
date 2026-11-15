"""Only synthetic salary data; no identifying information in CI."""
import unittest
from fractions import Fraction
from audit_salary_donation_limit import independent_salary_ceiling, verified_family_deductions, independent_family_mortgage_case


class SalaryDonationOracleTest(unittest.TestCase):

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
