"""No resident-tax notice: synthetic salary-only independent cap comparison."""
import unittest

from reconcile_salary_only_from_slip import compare_case, evaluate, REQUIRED_CONFIRMATIONS


def example(year=2025):
    return {
        "year": year,
        "confirmations": {flag: True for flag in REQUIRED_CONFIRMATIONS},
        "family": {"spouse": "none", "general": 0, "special": 0, "elderly": 0,
                   "cohabiting_elderly": 0, "under16": 0},
        "source": {
            "salary_gross": 7_000_000,
            "salary_reference": 5_200_000,
            "deductions_reference": 1_630_000 if year == 2025 else 1_670_000,
            "income_tax_withheld": 292_500 if year == 2025 else 284_300,
            "social_insurance": 1_000_000,
        },
        "workbook": {"year": year, "donation_limit": 109_000,
                     "resident_income_levy": 374_500},
        "municipality": "designated",
    }


class SalaryOnlySlipReconciliationTest(unittest.TestCase):
    def test_same_year_salary_7m_matches_without_resident_notice(self):
        for year in (2025, 2026):
            with self.subTest(year=year):
                r = compare_case(example(year))
                self.assertEqual(r["status"], "MATCH_REFERENCE")
                self.assertNotIn("resident_notice", str(r))
        report = evaluate([example(2025),example(2026)]*3,min_cases=5)
        self.assertEqual(report["totals"]["MATCH_REFERENCE"],6)
        self.assertFalse(report["resident_tax_notice_used"])
        self.assertEqual(report["release_decision"],"HOLD")
        self.assertEqual(report["review_stage"],
                         "INDEPENDENT_SALARY_ONLY_REFERENCE_MATCHED")
        self.assertNotIn("7_000_000",repr(report))
        self.assertNotIn("5_200_000",repr(report))

    def test_middle_salary_regular_fifth_table_independent_scenario(self):
        # Independently pinned 3m regular row, not copied from Excel code.
        # 2025 and 2026 differ in national basic deduction and source tax.
        for year, deductions, withheld, limit in (
            (2025, 1_880_000, 7_100, 15_000),
            (2026, 2_040_000, 0, 14_000),
        ):
            case = example(year)
            case["source"].update({
                "salary_gross": 3_000_000,
                "salary_reference": 2_020_000,
                "deductions_reference": deductions,
                "income_tax_withheld": withheld,
            })
            case["workbook"].update({
                "donation_limit": limit,
                "resident_income_levy": 56_500,
            })
            with self.subTest(year=year):
                self.assertEqual(compare_case(case)["status"], "MATCH_REFERENCE")
            wrong = example(year)
            wrong["source"] = dict(case["source"])
            wrong["workbook"] = dict(case["workbook"])
            wrong["source"]["salary_reference"] += 800
            self.assertEqual(compare_case(wrong)["reason"],
                             "SOURCE_SALARY_NOT_RECONCILED_TO_NTA_TABLE")

    def test_not_a_prediction_of_2026_from_2025_slip(self):
        case=example(2025)
        case["workbook"]["year"]=2026
        self.assertEqual(compare_case(case)["reason"],"SOURCE_AND_TARGET_YEAR_MISMATCH")

    def test_unsupported_income_credit_or_unverified_family_stops(self):
        for flag in REQUIRED_CONFIRMATIONS:
            case=example()
            case["confirmations"][flag]=False
            self.assertEqual(compare_case(case)["status"],"NOT_COMPARABLE")
        for mutation in (
            ("source","salary_reference",5_100_000),
            ("source","deductions_reference",1_700_000),
            ("source","income_tax_withheld",0),
            ("source","salary_gross",21_000_000),
            ("family","spouse","unreviewed"),
        ):
            case=example()
            case[mutation[0]][mutation[1]]=mutation[2]
            self.assertEqual(compare_case(case)["status"],"NOT_COMPARABLE")

    def test_lower_salary_cannot_use_a_shortcut_instead_of_nta_fifth_table(self):
        case=example(2025)
        case["source"]["salary_gross"]=5_000_000
        # A corroborated year-end G05 and NTA fifth table check are
        # required. Exact raw salary components need separate case data.
        case["confirmations"]["nta_fifth_table_rechecked"]=False
        self.assertEqual(compare_case(case)["status"],"NOT_COMPARABLE")

    def test_wrong_workbook_or_resident_tax_is_mismatch(self):
        for name,value in (("donation_limit",110000),
                           ("resident_income_levy",376000)):
            case=example()
            case["workbook"][name]=value
            self.assertEqual(compare_case(case)["status"],"MISMATCH")

    def test_no_silent_personal_data_acceptance(self):
        case=example()
        case["taxpayer_name"]="CONFIDENTIAL"
        self.assertEqual(compare_case(case)["reason"],"UNEXPECTED_CASE_FIELDS")
        for field in ("salary_gross","social_insurance"):
            bad=example()
            bad["source"][field]=True
            self.assertEqual(compare_case(bad)["status"],"NOT_COMPARABLE")
        report=evaluate([case],min_cases=1)
        self.assertNotIn("CONFIDENTIAL",repr(report))
        with self.assertRaises(ValueError):
            evaluate([],min_cases=1)


    def test_verified_insurance_is_included_in_both_tax_systems(self):
        case = example(2025)
        # All amounts are synthetic. The 'insurance' premiums must be verified
        # independently; source deduction boxes are used ONLY for checking.
        case["insurance"] = {
            "new_life": 50_000, "old_life": 0, "care": 0,
            "new_pension": 50_000, "old_pension": 0,
            "earthquake": 10_902, "old_long": 0,
            "life_reference": 65_000, "earthquake_reference": 10_902,
            "distinct_earthquake_contracts_confirmed": True,
            "no_2026_under23_life_exception_confirmed": True,
        }
        case["source"]["deductions_reference"] = 1_705_902
        case["source"]["income_tax_withheld"] = 276_900
        case["workbook"]["resident_income_levy"] = 368_500
        case["workbook"]["donation_limit"] = 107_000
        self.assertEqual(compare_case(case)["status"], "MATCH_REFERENCE")
        for field, value in (("life_reference",64_999),
                             ("earthquake_reference",10_900),
                             ("new_life",True),
                             ("distinct_earthquake_contracts_confirmed",False)):
            bad = example(2025)
            bad.update({"insurance":dict(case["insurance"])})
            bad["source"] = dict(case["source"])
            bad["workbook"] = dict(case["workbook"])
            bad["insurance"][field] = value
            self.assertEqual(compare_case(bad)["status"], "NOT_COMPARABLE")

    def test_2026_confirmed_under23_insurance_tax_and_donation_reference(self):
        case = example(2026)
        case["family"]["under16"] = 1
        case["insurance"] = {
            "new_life": 120_000, "old_life": 0, "care": 0,
            "new_pension": 0, "old_pension": 0,
            "earthquake": 0, "old_long": 0,
            "life_reference": 60_000, "earthquake_reference": 0,
            "distinct_earthquake_contracts_confirmed": True,
            "no_2026_under23_life_exception_confirmed": False,
            "verified_2026_under23_dependent": True,
        }
        case["source"]["deductions_reference"] = 1_730_000
        case["source"]["income_tax_withheld"] = 272_000
        case["workbook"]["resident_income_levy"] = 371_600
        case["workbook"]["donation_limit"] = 108_000
        self.assertEqual(compare_case(case)["status"], "MATCH_REFERENCE")
        case["family"]["under16"] = 0
        self.assertEqual(compare_case(case)["reason"],
                         "UNDER23_DEPENDENT_NOT_IN_VERIFIED_FAMILY")
        case["family"]["under16"] = 1
        case["insurance"]["verified_2026_under23_dependent"] = False
        self.assertEqual(compare_case(case)["status"], "NOT_COMPARABLE")
        case["insurance"]["verified_2026_under23_dependent"] = True
        case["insurance"]["life_reference"] = 40_000
        self.assertEqual(compare_case(case)["status"], "NOT_COMPARABLE")

    def test_2026_insurance_exception_requires_confirmed_absence(self):
        case = example(2026)
        case["insurance"] = {
            "new_life": 0, "old_life": 0, "care": 0,
            "new_pension": 0, "old_pension": 0,
            "earthquake": 0, "old_long": 0,
            "life_reference": 0, "earthquake_reference": 0,
            "distinct_earthquake_contracts_confirmed": True,
            "no_2026_under23_life_exception_confirmed": False,
        }
        self.assertEqual(compare_case(case)["status"], "NOT_COMPARABLE")
        case["insurance"]["no_2026_under23_life_exception_confirmed"] = True
        self.assertEqual(compare_case(case)["status"], "MATCH_REFERENCE")



if __name__=="__main__":
    unittest.main(verbosity=2)
