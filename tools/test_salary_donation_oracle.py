"""Only synthetic salary data; no identifying information in CI."""
import unittest
from fractions import Fraction
from audit_salary_donation_limit import independent_salary_ceiling


class SalaryDonationOracleTest(unittest.TestCase):
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

    def test_income_cap_and_non_taxable_are_not_approved(self):
        r=independent_salary_ceiling(year=2025,salary_income=1_500_000,
                                    resident_deductions=1_000_000)
        self.assertLessEqual(r["theoretical_ceiling"],Fraction(450_000))
        with self.assertRaises(ValueError):
            independent_salary_ceiling(year=2025,salary_income=430_000,
                                      resident_deductions=430_000)


if __name__ == "__main__":
    unittest.main(verbosity=2)
