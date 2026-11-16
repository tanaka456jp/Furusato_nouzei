"""Release checks must never approve solely from synthetic CI or metadata."""
import unittest
from release_readiness import REQUIRED, SCHEMA, REVIEWER_ROLES, evaluate

HEAD = "a" * 40


class ReleaseReadinessTest(unittest.TestCase):
    def test_pr_report_uses_actual_pr_head_not_ephemeral_merge_sha(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/workbook.yml").read_text(encoding="utf-8")
        self.assertIn("github.event.pull_request.head.sha || github.sha", workflow)
        self.assertNotIn('--head "${GITHUB_SHA}"', workflow)

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

    def test_tax_gate_cannot_be_signed_off_by_release_operator(self):
        entry = {"status": "REVIEWED", "sha256": "f" * 64,
                 "reviewer_role": "release_operator", "head_sha": HEAD}
        report = evaluate(HEAD, {"schema": SCHEMA, "head_sha": HEAD,
                                 "checks": {"real_tax_and_resident_notice_reconciliation": entry}})
        self.assertEqual(report["checks"]["real_tax_and_resident_notice_reconciliation"], "INVALID")
        self.assertIn("INVALID_REAL_TAX_AND_RESIDENT_NOTICE_RECONCILIATION", report["blockers"])
        self.assertEqual(report["release_decision"], "HOLD")

    def test_each_gate_accepts_only_its_authorized_role(self):
        self.assertEqual(set(REVIEWER_ROLES), set(REQUIRED))
        checks = {key: {"status": "REVIEWED", "sha256": "f" * 64,
                        "reviewer_role": REVIEWER_ROLES[key][0], "head_sha": HEAD}
                  for key in REQUIRED}
        report = evaluate(HEAD, {"schema": SCHEMA, "head_sha": HEAD, "checks": checks})
        self.assertEqual(report["blockers"], [])
        self.assertEqual(report["release_decision"], "HOLD")

    def test_all_recorded_evidence_still_not_release_authorization(self):
        checks = {key: {"status": "REVIEWED", "sha256": "f" * 64,
                        "reviewer_role": REVIEWER_ROLES[key][0], "head_sha": HEAD}
                  for key in REQUIRED}
        report = evaluate(HEAD, {
            "schema": SCHEMA, "head_sha": HEAD,
            "checks": checks})
        self.assertEqual(report["blockers"], [])
        self.assertEqual(report["review_stage"], "MANUAL_FINAL_AUDIT_REQUIRED")
        self.assertEqual(report["release_decision"], "HOLD")
        self.assertTrue(all("NOT_INDEPENDENTLY_VERIFIED" in x
                            for x in report["checks"].values()))

if __name__ == "__main__":
    unittest.main(verbosity=2)
