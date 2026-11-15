"""Release checks must never approve solely from synthetic CI or metadata."""
import unittest
from release_readiness import REQUIRED, SCHEMA, evaluate

HEAD = "a" * 40


class ReleaseReadinessTest(unittest.TestCase):
    def test_no_evidence_always_hold(self):
        report = evaluate(HEAD)
        self.assertEqual(report["release_decision"], "HOLD")
        self.assertEqual(set(report["checks"]), set(REQUIRED))
        self.assertTrue(all(v == "MISSING" for v in report["checks"].values()))

    def test_stale_evidence_and_private_fields_not_emitted(self):
        report = evaluate(HEAD, {
            "schema": SCHEMA, "head_sha": "b" * 40, "taxpayer_name": "CONFIDENTIAL",
            "checks": {"ci_exact_commit": {
                "status": "REVIEWED", "sha256": "f" * 64,
                "head_sha": "b" * 40, "reviewer_role": "qa_operator"}}})
        self.assertIn("EVIDENCE_SHA_NOT_CURRENT", report["blockers"])
        self.assertIn("MANIFEST_EXTRA_FIELDS", report["blockers"])
        self.assertNotIn("CONFIDENTIAL", repr(report))
        with self.assertRaises(ValueError):
            evaluate("not-a-commit")

    def test_all_recorded_evidence_still_not_release_authorization(self):
        one = {"status": "REVIEWED", "sha256": "f" * 64,
               "reviewer_role": "external_reviewer", "head_sha": HEAD}
        report = evaluate(HEAD, {
            "schema": SCHEMA, "head_sha": HEAD,
            "checks": {key: one.copy() for key in REQUIRED}})
        self.assertEqual(report["blockers"], [])
        self.assertEqual(report["review_stage"], "MANUAL_FINAL_AUDIT_REQUIRED")
        self.assertEqual(report["release_decision"], "HOLD")
        self.assertTrue(all("NOT_INDEPENDENTLY_VERIFIED" in x
                            for x in report["checks"].values()))

if __name__ == "__main__":
    unittest.main(verbosity=2)
