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


if __name__=="__main__":
    unittest.main(verbosity=2)
