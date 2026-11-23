"""Synthetic mortgage one-stop first, conditional filing cap second."""
import unittest
from unittest.mock import patch
from batch_mortgage_one_stop import (
    MortgageBatchScopeError, compare_mortgage_modes,
)


def sample(occupancy=2024, possible=300000, used=278500):
    return {
        "year": 2026, "warnings": [], "format": "PDF_TEXT",
        "fields": {
            "salary_gross": 7_000_000, "salary_reference": 5_200_000,
            "deductions_reference": 1_670_000,
            "social_insurance": 1_000_000, "basic_reference": 670_000,
            "income_tax_withheld": 0, "mortgage_possible_credit": possible,
            "mortgage_credit": used, "mortgage_occupancy_year": occupancy,
            "mortgage_claim_count": 1,
        },
    }


def compare(evidence=None, **overrides):
    values = dict(
        evidence=sample() if evidence is None else evidence,
        source_year=2026, target_year=2026, salary_income=5_200_000,
        national_deductions=1_670_000, resident_deductions=1_430_000,
        national_basic=670_000, municipality_class="STANDARD")
    values.update(overrides)
    return compare_mortgage_modes(**values)


class MortgageBatchOneStopTest(unittest.TestCase):
    def test_source_with_known_national_credit_stays_one_stop_first(self):
        result = compare()
        self.assertEqual(result["mortgage_applied_national"], 278_500)
        self.assertEqual(result["mortgage_resident_transfer"], 21_500)
        self.assertEqual(result["selected_municipality"], "standard")
        self.assertEqual(result["one_stop_limit"] % 1000, 0)
        self.assertGreater(result["one_stop_limit"], 0)
        self.assertIsNone(result["filing_higher_limit"])

    def test_trial_burden_keeps_strict_ceiling_separate(self):
        default = compare()
        self.assertEqual(default["filing_limit"], 2_000)
        self.assertEqual(default["filing_trial_donation"], default["one_stop_limit"])
        self.assertEqual(default["filing_trial_tax_saving"],
                         default["filing_trial_donation"] - default["filing_trial_burden"])
        small = compare(trial_donation=3_000)
        self.assertEqual(small["filing_limit"], 2_000)
        self.assertEqual(small["filing_trial_donation"], 3_000)
        self.assertEqual(small["filing_trial_burden"], 2_005)
        self.assertEqual(small["one_stop_limit"], default["one_stop_limit"])
        for illegal in (0, 1999, 2500, -1000, True, 2_000_000):
            with self.subTest(illegal=illegal), self.assertRaisesRegex(
                    MortgageBatchScopeError, "TRIAL_DONATION_INVALID"):
                compare(trial_donation=illegal)

    def test_no_tax_return_applies_to_same_source_year_only(self):
        with self.assertRaisesRegex(MortgageBatchScopeError, "TAX_YEAR_UNSUPPORTED"):
            compare(target_year=2025)
        with self.assertRaisesRegex(MortgageBatchScopeError, "OCCUPANCY"):
            compare(evidence=sample(occupancy=2026))
        with self.assertRaisesRegex(MortgageBatchScopeError, "OCCUPANCY"):
            compare(evidence=sample(occupancy=2022))

    def test_missing_credit_or_unreconciled_tax_fails_closed(self):
        for mutate in (
            {"mortgage_credit": None},
            {"mortgage_credit": 400_000},
            {"income_tax_withheld": 100},
            {"mortgage_claim_count": 2},
            {"life_new": 100000},
            {"mortgage_occupancy_year": 2027},
        ):
            with self.subTest(mutate=mutate):
                data = sample()
                data["fields"].update(mutate)
                with self.assertRaises(MortgageBatchScopeError):
                    compare(evidence=data)

    def test_missing_claim_count_is_not_assumed_single(self):
        missing = sample()
        del missing["fields"]["mortgage_claim_count"]
        with self.assertRaisesRegex(MortgageBatchScopeError,
                                    "MULTIPLE_CLAIMS_UNVERIFIED"):
            compare(evidence=missing)
        altered = sample()
        altered["fields"]["mortgage_claim_count"] = True
        with self.assertRaisesRegex(MortgageBatchScopeError,
                                    "MULTIPLE_CLAIMS_UNVERIFIED"):
            compare(evidence=altered)

    def test_omitted_possible_credit_cannot_hide_resident_carryover(self):
        data = sample()
        del data["fields"]["mortgage_possible_credit"]
        # Source income tax is fully absorbed. No inferred "possible" amount
        # may erase an unobserved residual resident housing credit.
        with self.assertRaisesRegex(MortgageBatchScopeError,
                                    "POSSIBLE_CREDIT_REQUIRED"):
            compare(evidence=data)
        # If used is strictly below income tax, there can be no unallocated
        # amount under the same-year salary-only reconciled tax model.
        data = sample(possible=100_000, used=100_000)
        del data["fields"]["mortgage_possible_credit"]
        # Keep the corresponding withholding evidence coherent.
        from audit_withholding_reconciliation import progressive_income_tax
        national = progressive_income_tax(3_530_000)
        data["fields"]["income_tax_withheld"] = (
            ((national - 100_000) * 1021 // 100_000) * 100)
        result = compare(evidence=data)
        self.assertEqual(result["mortgage_resident_transfer"], 0)

    def test_special_local_tax_ordinance_is_not_ordinary_unknown_city(self):
        with self.assertRaisesRegex(MortgageBatchScopeError,
                                    "MUNICIPALITY_RATE_UNVERIFIED"):
            compare(municipality_class="SPECIAL")

    def test_higher_filing_note_requires_strict_same_conclusion(self):
        baseline = compare()
        # These are mocked numerical conditions for output gating only;
        # they do NOT establish any real taxpayer's comparative benefit.
        mocked = {"tax_return_thousand_yen_reference":
                  baseline["one_stop_limit"] + 10000}
        with patch("batch_mortgage_one_stop.independent_mortgage_filing_ceiling",
                   return_value=mocked):
            higher = compare()
        self.assertEqual(higher["filing_higher_limit"],
                         baseline["one_stop_limit"] + 10000)
        with patch("batch_mortgage_one_stop.independent_mortgage_filing_ceiling",
                   return_value={"tax_return_thousand_yen_reference":
                                 baseline["one_stop_limit"]}):
            equal = compare()
        self.assertIsNone(equal["filing_higher_limit"])

    def test_unknown_municipality_needs_both_splits_to_agree(self):
        baseline = compare(municipality_class="UNCERTAIN")
        with patch("batch_mortgage_one_stop.independent_mortgage_filing_ceiling",
                   side_effect=[
                       {"tax_return_thousand_yen_reference":
                         baseline["one_stop_limit"]+10000},
                       {"tax_return_thousand_yen_reference":
                         baseline["one_stop_limit"]+11000},
                   ]):
            uncertain = compare(municipality_class="UNCERTAIN")
        self.assertIsNone(uncertain["filing_higher_limit"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
