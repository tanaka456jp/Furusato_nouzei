"""Synthetic contract test: stage remains HOLD and printing must be real."""
import hashlib
import tempfile
import unittest
from pathlib import Path
from prepare_official_excel_release import PRINT_SCHEMA, PRINT_FIELDS, check_paper, stage, read_private

def make_paper():
    return {
        "schema": PRINT_SCHEMA,
        "signed_candidate_archive_sha256": "a" * 64,
        "printed_workbook_sha256": "b" * 64,
        "tax_year": 2026,
        "expected_limit_yen": 109000,
        "observed_limit_yen": 109000,
        "physical_printer_confirmed": True,
        "one_page_a4_checked": True,
        "paper_physically_observed": True,
        "paper_readability_reviewed": True,
        "tax_amounts_cross_checked": True,
        "only_synthetic_data": True,
        "reviewer_role": "qa_operator",
        "manual_human_review": True,
        "release_decision": "HOLD",
    }

class OfficialStagingTest(unittest.TestCase):
    def test_claim_remains_hold(self):
        p = make_paper()
        self.assertEqual(set(p), PRINT_FIELDS)
        check_paper(p, "a" * 64, "b" * 64)
        self.assertEqual(p["release_decision"], "HOLD")

    def test_bad_paper_rejected(self):
        for key, value in (
            ("paper_physically_observed", False),
            ("paper_readability_reviewed", False),
            ("physical_printer_confirmed", False),
            ("manual_human_review", False),
            ("only_synthetic_data", False),
            ("signed_candidate_archive_sha256", "c" * 64),
            ("printed_workbook_sha256", "c" * 64),
            ("observed_limit_yen", 110000),
            ("reviewer_role", "release_operator"),
            ("release_decision", "APPROVED"),
        ):
            with self.subTest(key=key):
                sample = dict(make_paper(), **{key: value})
                with self.assertRaises(ValueError):
                    check_paper(sample, "a" * 64, "b" * 64)
        with self.assertRaisesRegex(ValueError, "FIELDS_INVALID"):
            check_paper(dict(make_paper(), taxpayer_name="PRIVATE"),
                        "a" * 64, "b" * 64)

    def test_private_staging_evidence_rejects_conflicting_json_keys(self):
        with tempfile.TemporaryDirectory() as d:
            source = Path(d) / "private-review.json"
            source.write_text('{"release_decision":"HOLD","release_decision":"PASS"}',
                              encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "DUPLICATE_RELEASE_EVIDENCE_JSON_KEY"):
                read_private(source)
            source.write_text('{"tax_year":NaN}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "NONFINITE_RELEASE_EVIDENCE_JSON"):
                read_private(source)

    def test_staging_is_exact_and_cannot_publish(self):
        with tempfile.TemporaryDirectory() as d:
            original = Path(d) / "sample.bin"
            original.write_bytes(b"anonymous-synthetic-test")
            h = hashlib.sha256(original.read_bytes()).hexdigest()
            report = {"version": "v4.18.34",
                      "candidate_archive_sha256": h, "release_decision": "HOLD"}
            folder = Path(d) / "stage"
            copied = stage(original, folder, "v4.18.34", report)
            self.assertEqual(copied.read_bytes(), original.read_bytes())
            self.assertIn(h, (folder / "SHA256SUMS.txt").read_text())
            self.assertEqual(copied.name, "Furusato_nouzei_v4.18.34_ReadyToUse.zip")
            self.assertIn('"release_decision": "HOLD"', (folder / "release-preflight-v4.18.34.json").read_text())
            with self.assertRaisesRegex(ValueError, "ALREADY_EXISTS"):
                stage(original, folder, "v4.18.34", report)
            original.write_bytes(b"modified")
            with self.assertRaisesRegex(ValueError, "SOURCE_CHANGED"):
                stage(original, Path(d) / "new", "v4.18.34", report)

if __name__ == "__main__":
    unittest.main(verbosity=2)
