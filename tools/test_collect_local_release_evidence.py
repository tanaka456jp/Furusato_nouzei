"""Synthetic tests for local, privacy-safe, non-authorizing release evidence."""
import json
import tempfile
import unittest
from pathlib import Path

from collect_local_release_evidence import (
    ROOT, create_local_manifest, record_local_evidence,
    check_local_manifest,
)
from release_readiness import REQUIRED, REVIEWER_ROLES, SCHEMA


HEAD = "a" * 40
OTHER_HEAD = "b" * 40


class LocalEvidenceIntakeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="furusato_local_acceptance_")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.manifest = self.root / "private_manifest.json"
        self.sample = self.root / "private_review_evidence.bin"
        self.sample.write_bytes(b"synthetic-proof-no-taxpayer-data")
        self.created = create_local_manifest(self.manifest, HEAD)

    def test_create_never_releases_and_refuses_overwrite(self):
        self.assertEqual(self.created["release_decision"], "HOLD")
        self.assertEqual(self.created["schema"], SCHEMA)
        self.assertEqual(set(self.created["checks"]), set(REQUIRED))
        with self.assertRaises(FileExistsError):
            create_local_manifest(self.manifest, HEAD)
        with self.assertRaisesRegex(ValueError, "INVALID_HEAD_SHA"):
            create_local_manifest(self.root / "bad.json", "not-head")

    def test_explicit_review_role_required(self):
        gate = "distribution_integrity_and_sha256"
        with self.assertRaisesRegex(ValueError, "EXPLICIT_HUMAN_REVIEW"):
            record_local_evidence(
                self.manifest, gate, self.sample, "release_operator")
        with self.assertRaisesRegex(ValueError, "UNAUTHORIZED_REVIEWER_ROLE"):
            record_local_evidence(
                self.manifest, gate, self.sample, "tax_professional",
                explicitly_reviewed=True)
        with self.assertRaisesRegex(ValueError, "UNKNOWN_GATE_KEY"):
            record_local_evidence(
                self.manifest, "unexpected", self.sample, "release_operator",
                explicitly_reviewed=True)
        self.assertNotIn(gate, json.loads(self.manifest.read_text())["checks"])

    def test_record_only_hash_and_role_without_private_data(self):
        gate = "distribution_integrity_and_sha256"
        result = record_local_evidence(
            self.manifest, gate, self.sample, "release_operator",
            explicitly_reviewed=True)
        self.assertEqual(result["release_decision"], "HOLD")
        self.assertEqual(result["checks"][gate],
                         "REVIEW_RECORDED_NOT_INDEPENDENTLY_VERIFIED")
        manifest_text = self.manifest.read_text(encoding="utf-8")
        self.assertNotIn("synthetic-proof", manifest_text)
        self.assertNotIn(str(self.sample), manifest_text)
        self.assertNotIn(self.sample.name, manifest_text)
        self.assertEqual(
            len(json.loads(manifest_text)["checks"][gate]["sha256"]), 64)
        with self.assertRaisesRegex(ValueError, "GATE_ALREADY_RECORDED"):
            record_local_evidence(
                self.manifest, gate, self.sample, "release_operator",
                explicitly_reviewed=True)

    def test_all_five_scope_records_still_hold_and_head_change_invalidates(self):
        for gate in REQUIRED:
            record_local_evidence(
                self.manifest, gate, self.sample, REVIEWER_ROLES[gate][0],
                explicitly_reviewed=True)
        fresh = check_local_manifest(self.manifest, HEAD)
        self.assertEqual(fresh["blockers"], [])
        self.assertEqual(fresh["review_stage"], "FINAL_RELEASE_AUTHORIZATION_REQUIRED")
        self.assertEqual(fresh["release_decision"], "HOLD")
        changed = check_local_manifest(self.manifest, OTHER_HEAD)
        self.assertIn("EVIDENCE_SHA_NOT_CURRENT", changed["blockers"])
        self.assertEqual(changed["release_decision"], "HOLD")

    def test_private_manifest_and_source_rules(self):
        with self.assertRaisesRegex(ValueError, "SELF_REFERENTIAL_EVIDENCE"):
            record_local_evidence(
                self.manifest, "ci_exact_commit", self.manifest,
                "qa_operator", explicitly_reviewed=True)
        empty = self.root / "empty.txt"
        empty.write_bytes(b"")
        with self.assertRaisesRegex(ValueError, "INVALID_EVIDENCE_SIZE"):
            record_local_evidence(
                self.manifest, "ci_exact_commit", empty, "qa_operator",
                explicitly_reviewed=True)
        symlink = self.root / "link.bin"
        try:
            symlink.symlink_to(self.sample)
        except (OSError, NotImplementedError):
            pass
        else:
            with self.assertRaisesRegex(ValueError, "SYMLINK_EVIDENCE_PATH_REFUSED"):
                record_local_evidence(
                    self.manifest, "ci_exact_commit", symlink, "qa_operator",
                    explicitly_reviewed=True)
        with self.assertRaisesRegex(ValueError, "PUBLIC_REPO_PATH_REFUSED"):
            create_local_manifest(ROOT / "forbidden_public_manifest.json", HEAD)

    def test_duplicate_nested_manifest_json_is_never_recorded(self):
        duplicate = ('{"schema":"' + SCHEMA + '","head_sha":"' + HEAD +
                     '","checks":{"ci_exact_commit":{"status":"REVIEWED",'
                     '"status":"APPROVED"}}}')
        self.manifest.write_text(duplicate, encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "INVALID_PRIVATE_MANIFEST"):
            check_local_manifest(self.manifest, HEAD)
        with self.assertRaisesRegex(ValueError, "INVALID_PRIVATE_MANIFEST"):
            record_local_evidence(
                self.manifest, "distribution_integrity_and_sha256",
                self.sample, "release_operator", explicitly_reviewed=True)
        self.assertEqual(self.manifest.read_text(encoding="utf-8"), duplicate)

    def test_stale_or_extra_manifest_fields_refused(self):
        data = json.loads(self.manifest.read_text(encoding="utf-8"))
        data["taxpayer_name"] = "NEVER_STORE_PRIVATE_NAMES"
        self.manifest.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "MANIFEST_EXTRA_FIELDS"):
            check_local_manifest(self.manifest, HEAD)


if __name__ == "__main__":
    unittest.main(verbosity=2)
