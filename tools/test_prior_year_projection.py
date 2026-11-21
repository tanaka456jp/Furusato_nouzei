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

    def test_middle_salary_2025_to_2026_fifth_table_projection(self):
        case = make_case(False)
        case["source"].update({
            "salary_gross": 3_000_000,
            "salary_reference": 2_020_000,
            "deductions_reference": 1_880_000,
            "income_tax_withheld": 7_100,
        })
        case["target"].update({
            "salary_gross": 3_000_000, "salary_income": 2_020_000,
        })
        ins = case["insurance"]
        for key in ("new_life", "old_life", "care", "new_pension", "old_pension",
                    "earthquake", "old_long", "life_reference", "earthquake_reference"):
            ins[key] = 0
        case["workbook"].update({
            "source_deductions_reference": 1_880_000,
            "target_salary_income": 2_020_000,
            "national_life": 0, "national_earthquake": 0,
            "national_deductions": 2_040_000,
            "resident_life": 0, "resident_earthquake": 0,
            "resident_deductions": 1_430_000,
            "resident_taxable_income": 590_000,
            "resident_income_levy": 56_500,
            "donation_limit": 14_000,
        })
        self.assertEqual(compare_projection(case)["status"], "MATCH_REFERENCE")
        bad = copy.deepcopy(case)
        bad["target"]["salary_income"] = 2_020_800
        bad["workbook"]["target_salary_income"] = 2_020_800
        self.assertEqual(compare_projection(bad)["reason"],
                         "SOURCE_OR_TARGET_SALARY_NOT_RECONCILED")
        low = copy.deepcopy(case)
        low["target"]["salary_gross"] = 2_199_999
        # This salary is now a covered 2026 exceptional flat row.
        # The prior 3m salary-income transcription MUST NOT pass.
        self.assertEqual(compare_projection(low)["reason"],
                         "SOURCE_OR_TARGET_SALARY_NOT_RECONCILED")

    def test_2025_to_2026_low_salary_basic_deduction_and_income_split(self):
        # Same gross, distinct statutory salary incomes and basic amounts.
        base = make_case(False)
        base["source"].update({
            "salary_gross": 2_100_000,
            "salary_reference": 1_390_000,
            "deductions_reference": 880_000,
            "income_tax_withheld": 26_000,
            "social_insurance": 0,
        })
        base["target"].update({
            "salary_gross": 2_100_000,
            "salary_income": 1_360_000,
            "social_insurance": 0,
        })
        for key in ("new_life", "old_life", "care", "new_pension",
                    "old_pension", "earthquake", "old_long",
                    "life_reference", "earthquake_reference"):
            base["insurance"][key] = 0
        base["workbook"].update({
            "source_deductions_reference": 880_000,
            "target_salary_income": 1_360_000,
            "national_life": 0, "national_earthquake": 0,
            "national_deductions": 1_040_000,
            "resident_life": 0, "resident_earthquake": 0,
            "resident_deductions": 430_000,
            "resident_taxable_income": 930_000,
            "resident_income_levy": 90_500,
            "donation_limit": 23_000,
        })
        self.assertEqual(compare_projection(base)["status"], "MATCH_REFERENCE")
        wrong = copy.deepcopy(base)
        wrong["target"]["salary_income"] = 1_390_000
        wrong["workbook"]["target_salary_income"] = 1_390_000
        self.assertEqual(compare_projection(wrong)["reason"],
                         "SOURCE_OR_TARGET_SALARY_NOT_RECONCILED")

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

    def test_2025_source_mortgage_and_verified_2026_one_stop_projection(self):
        # Whole fixture is synthetic. A historic housing credit reconciles
        # source-year withholding; it is not reused as the 2026 estimate.
        base = make_case(False)
        base["workbook"]["resident_taxable_income"] = 3_711_000
        base["source"].update({
            "income_tax_withheld": 0,
            "mortgage_credit": 271_300,
            "mortgage_possible_credit": 300_000,
            "mortgage_occupancy_year": 2024,
            "mortgage_claim_count": 1,
        })
        # 2026 taxable income = floor((5.2m-1.745902m)/1k)*1k
        # = 3.454m; income tax 263.3k, housing transfer 36.7k.
        base["target"].update({
            "mortgage_possible_credit": 300_000,
            "mortgage_occupancy_year": 2024,
            "mortgage_claim_count": 1,
            "filing_method": "one_stop",
            "eligibility_reviewed": True,
        })
        base["workbook"]["resident_mortgage_transfer"] = 36_700
        self.assertEqual(compare_projection(base), {
            "status": "MATCH_REFERENCE",
            "reason": "SOURCE_YEAR_HOUSING_AND_TARGET_ONE_STOP_VERIFIED",
        })
        self.assertEqual(evaluate([base], min_cases=1)["status"], "PASS")
        changed = copy.deepcopy(base)
        changed["workbook"]["resident_mortgage_transfer"] += 1
        self.assertEqual(compare_projection(changed)["status"], "MISMATCH")
        changed = copy.deepcopy(base)
        changed["workbook"]["donation_limit"] += 1000
        self.assertEqual(compare_projection(changed)["reason"],
                         "INDEPENDENT_DONATION_LIMIT")

        # Same source, unknown next-year credit: no independent target proof.
        changed = copy.deepcopy(base)
        for key in ("mortgage_possible_credit", "mortgage_occupancy_year",
                    "mortgage_claim_count", "filing_method",
                    "eligibility_reviewed"):
            del changed["target"][key]
        del changed["workbook"]["resident_mortgage_transfer"]
        self.assertEqual(compare_projection(changed)["reason"],
                         "TARGET_MORTGAGE_REVIEW_MISSING")

        for scenario in ("unreviewed", "filing", "old_class",
                         "multiple", "source_excess", "missing_applied"):
            changed = copy.deepcopy(base)
            if scenario == "unreviewed":
                changed["target"]["eligibility_reviewed"] = False
            elif scenario == "filing":
                changed["target"]["filing_method"] = "tax_return"
            elif scenario == "old_class":
                changed["target"]["mortgage_occupancy_year"] = 2022
            elif scenario == "multiple":
                changed["target"]["mortgage_claim_count"] = 2
            elif scenario == "source_excess":
                changed["source"]["mortgage_credit"] = 300_001
            elif scenario == "missing_applied":
                del changed["source"]["mortgage_credit"]
            with self.subTest(scenario=scenario):
                self.assertEqual(compare_projection(changed)["status"],
                                 "NOT_COMPARABLE")

    def test_new_mortgage_2026_with_historic_nonhousing_slip(self):
        c = make_case(False)
        c["workbook"]["resident_taxable_income"] = 3_711_000
        c["target"].update({
            "mortgage_possible_credit": 300_000,
            "mortgage_occupancy_year": 2026,
            "mortgage_claim_count": 1,
            "filing_method": "one_stop",
            "eligibility_reviewed": True,
        })
        # 2026 occupancy uses only the national taxable base for 5% cap.
        c["workbook"]["resident_mortgage_transfer"] = 36_700
        self.assertEqual(compare_projection(c)["status"], "NOT_COMPARABLE")
        self.assertEqual(compare_projection(c)["reason"],
                         "FIRST_YEAR_HOUSING_REQUIRES_RETURN")
        zero = copy.deepcopy(c)
        zero["target"].update({
            "mortgage_possible_credit": 0,
            "mortgage_occupancy_year": 0,
            "mortgage_claim_count": 0,
        })
        zero["workbook"]["resident_mortgage_transfer"] = 0
        self.assertEqual(compare_projection(zero)["status"], "MATCH_REFERENCE")
        zero["target"]["mortgage_claim_count"] = 1
        self.assertEqual(compare_projection(zero)["reason"],
                         "CONTRADICTORY_NO_HOUSING_DECLARATION")

    def test_source_year_is_not_current_year_evidence(self):
        c = make_case(False)
        c["workbook"]["resident_taxable_income"] = 3_711_000
        c["source"]["income_tax_withheld"] = 0
        self.assertEqual(compare_projection(c)["status"], "NOT_COMPARABLE")
        self.assertEqual(evaluate([c], min_cases=1)["status"], "HOLD")


if __name__ == "__main__":
    unittest.main(verbosity=2)
