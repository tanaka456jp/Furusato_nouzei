"""Synthetic-only mandatory regression for 2025 slip -> 2026 estimate."""
import copy
import unittest

from audit_prior_year_projection import compare_projection, evaluate


def make_case(under23=False):
    ins = {
        "new_life": 120_000 if under23 else 50_000,
        "old_life": 0, "care": 0,
        "new_pension": 0 if under23 else 50_000,
        "old_pension": 0,
        "earthquake": 0 if under23 else 10_902,
        "old_long": 0,
        "life_reference": 60_000 if under23 else 65_000,
        "earthquake_reference": 0 if under23 else 10_902,
        "distinct_earthquake_contracts_confirmed": True,
        "no_2026_under23_life_exception_confirmed": not under23,
    }
    if under23:
        ins["verified_2026_under23_dependent"] = True
    resident = 1_458_000 if under23 else 1_488_451
    return {
        "source_year": 2025, "target_year": 2026,
        "source": {
            "salary_gross": 7_000_000, "salary_reference": 5_200_000,
            "deductions_reference": 1_670_000 if under23 else 1_705_902,
            "income_tax_withheld": 284_300 if under23 else 276_900,
            "social_insurance": 1_000_000,
        },
        "target": {
            "salary_gross": 7_000_000, "salary_income": 5_200_000,
            "social_insurance": 1_000_000,
        },
        "insurance": ins,
        "family": {
            "spouse": "none", "general": 0, "special": 0,
            "elderly": 0, "cohabiting_elderly": 0,
            "under16": 1 if under23 else 0,
        },
        "municipality": "designated",
        "confirmations": {
            "target_pay_and_insurance_reviewed": True,
            "family_eligibility_reviewed": True,
            "municipality_reviewed": True,
            "one_stop_filing_confirmed": True,
            "no_other_income_or_credits": True,
            "no_unverified_manual_overrides": True,
            "source_deductions_not_reused": True,
        },
        "workbook": {
            "source_deductions_reference": 1_670_000 if under23 else 1_705_902,
            "target_salary_income": 5_200_000,
            "national_life": 60_000 if under23 else 65_000,
            "national_earthquake": 0 if under23 else 10_902,
            "national_deductions": 1_730_000 if under23 else 1_745_902,
            "resident_life": 28_000 if under23 else 53_000,
            "resident_earthquake": 0 if under23 else 5_451,
            "resident_deductions": resident,
            "resident_taxable_income": 5_200_000 - resident,
            "resident_income_levy": 371_600 if under23 else 368_500,
            "donation_limit": 108_000 if under23 else 107_000,
        },
    }


class PriorYearProjectionTest(unittest.TestCase):
    def test_ordinary_and_under23_2026_are_independent_of_2025_slip(self):
        cases = [make_case(False), make_case(True)]
        for case in cases:
            # Taxable resident income is first floored to 1,000 yen;
            # the workbook must not use income-tax taxable income.
            resident = case["workbook"]["resident_deductions"]
            case["workbook"]["resident_taxable_income"] = (
                (5_200_000 - resident) // 1000 * 1000)
            self.assertEqual(compare_projection(case)["status"], "MATCH_REFERENCE")
        self.assertEqual(evaluate(cases, min_cases=2)["status"], "PASS")

    def test_no_prior_year_national_deduction_reuse(self):
        c = make_case(True)
        c["workbook"]["resident_taxable_income"] = 3_742_000
        c["workbook"]["national_deductions"] = c["source"]["deductions_reference"]
        r = compare_projection(c)
        self.assertEqual(r["status"], "MISMATCH")
        self.assertEqual(r["reason"], "INDEPENDENT_NATIONAL_DEDUCTIONS")

    def test_different_resident_components_fail_individually(self):
        base = make_case(False)
        base["workbook"]["resident_taxable_income"] = 3_711_000
        for key in ("resident_life", "resident_earthquake",
                    "resident_deductions", "resident_taxable_income",
                    "resident_income_levy", "donation_limit"):
            c = copy.deepcopy(base)
            c["workbook"][key] += 1
            with self.subTest(key=key):
                self.assertEqual(compare_projection(c)["status"], "MISMATCH")

    def test_unverified_premiums_eligibility_or_year_refuses_projection(self):
        base = make_case(True)
        base["workbook"]["resident_taxable_income"] = 3_742_000
        for invalid in ("year", "confirm", "insurance", "family", "source"):
            c = copy.deepcopy(base)
            if invalid == "year":
                c["source_year"] = 2026
            elif invalid == "confirm":
                c["confirmations"]["family_eligibility_reviewed"] = False
            elif invalid == "insurance":
                c["insurance"]["verified_2026_under23_dependent"] = False
            elif invalid == "family":
                c["family"]["under16"] = "unverified"
            elif invalid == "source":
                c["source"]["salary_reference"] = 0
            with self.subTest(invalid=invalid):
                self.assertEqual(
                    compare_projection(c)["status"], "NOT_COMPARABLE")

    def test_under23_flag_without_verified_family_is_hold(self):
        case = make_case(True)
        case["family"]["under16"] = 0
        case["workbook"]["resident_taxable_income"] = 3_742_000
        verdict = compare_projection(case)
        self.assertEqual(verdict["status"], "NOT_COMPARABLE")
        self.assertEqual(verdict["reason"],
                         "UNDER23_DEPENDENT_NOT_IN_TARGET_FAMILY")

    def test_source_year_is_not_current_year_evidence(self):
        c = make_case(False)
        c["workbook"]["resident_taxable_income"] = 3_711_000
        c["source"]["income_tax_withheld"] = 0
        self.assertEqual(compare_projection(c)["status"], "NOT_COMPARABLE")
        self.assertEqual(evaluate([c], min_cases=1)["status"], "HOLD")


if __name__ == "__main__":
    unittest.main(verbosity=2)
