"""Synthetic tests for the exact-head CI receipt, never actual taxpayer data."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from record_ci_acceptance import JOBS, evaluate, digest_file

HEAD = "a" * 40
JOBS_OK = {job: "success" for job in JOBS}
BOOK = b"anonymous-synthetic-xlsm-bytes"
READER = b"anonymous-synthetic-reader"
README = ("# 次期版 ReadyToUse 実機検証用 — 正式配布HOLD\n"
          "対象開発コミット：" + HEAD + "\n").encode("utf-8")
MARKER = b"REVIEW BUILD - NOT FOR PUBLIC DISTRIBUTION\n"


def sha(data):
    return hashlib.sha256(data).hexdigest()


class CiAcceptanceReceiptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.archive = Path(self.tmp.name) / "synthetic-review.zip"
        with ZipFile(self.archive, "w", ZIP_DEFLATED) as zipped:
            zipped.writestr("Furusato_nouzei.xlsm", BOOK)
            zipped.writestr("FurusatoDocumentReader.exe", READER)
            zipped.writestr("README.txt", README)
            zipped.writestr("NOT_FOR_PUBLIC_RELEASE.txt", MARKER)
        self.report = {
            "schema": "furusato-ready-to-use-review/v1",
            "head_sha": HEAD,
            "package_class": "SYNTHETIC_CI_REVIEW_ONLY",
            "release_decision": "HOLD",
            "signing_state": "NOT_VERIFIED",
            "accepted_workbook_sha256": sha(BOOK),
            "reader_sha256": sha(READER),
            "review_readme_sha256": sha(README),
            "ready_to_use_review_sha256": digest_file(self.archive),
        }

    def run_gate(self, jobs=None, report=None, head=HEAD):
        return evaluate(
            head, 44000000000, JOBS_OK if jobs is None else jobs,
            self.report if report is None else report, self.archive,
        )

    def test_matching_archive_is_ci_pass_but_release_hold(self):
        result = self.run_gate()
        self.assertEqual(result["ci_exact_head_gate"], "PASS")
        self.assertEqual(result["release_decision"], "HOLD")
        self.assertEqual(result["head_sha"], HEAD)
        self.assertTrue(result["review_only"])
        self.assertEqual(result["accepted_workbook_sha256"], sha(BOOK))

    def test_all_four_success_are_mandatory(self):
        for key in JOBS:
            for status in ("failure", "skipped", "cancelled", "pending"):
                with self.subTest(key=key, status=status):
                    jobs = dict(JOBS_OK, **{key: status})
                    with self.assertRaisesRegex(ValueError, "PREREQUISITE"):
                        self.run_gate(jobs=jobs)

    def test_wrong_head_and_run_rejected(self):
        with self.assertRaisesRegex(ValueError, "INVALID_HEAD"):
            self.run_gate(head="invalid")
        with self.assertRaisesRegex(ValueError, "PROVENANCE"):
            self.run_gate(head="b" * 40)
        with self.assertRaisesRegex(ValueError, "INVALID_RUN"):
            evaluate(HEAD, 0, JOBS_OK, self.report, self.archive)

    def test_forged_report_status_and_checksums_rejected(self):
        for key, value in (
            ("release_decision", "APPROVED"),
            ("signing_state", "VALID"),
            ("package_class", "SIGNED_RELEASE"),
            ("accepted_workbook_sha256", "f" * 64),
            ("reader_sha256", "f" * 64),
            ("review_readme_sha256", "f" * 64),
            ("ready_to_use_review_sha256", "f" * 64),
        ):
            with self.subTest(key=key):
                data = dict(self.report, **{key: value})
                with self.assertRaises(ValueError):
                    self.run_gate(report=data)

    def test_tampered_archive_rejected(self):
        with self.archive.open("ab") as output:
            output.write(b"post-packaging-tamper")
        with self.assertRaisesRegex(ValueError, "REVIEW_ZIP_SHA256_MISMATCH"):
            self.run_gate()

    def test_duplicate_or_extra_members_rejected(self):
        with ZipFile(self.archive, "a") as zipped:
            zipped.writestr("extra-secret.txt", b"must not enter CI output")
        report = dict(self.report, ready_to_use_review_sha256=digest_file(self.archive))
        with self.assertRaisesRegex(ValueError, "REVIEW_ZIP_MEMBERS_INVALID"):
            self.run_gate(report=report)

    def test_missing_review_warning_rejected(self):
        with ZipFile(self.archive, "w", ZIP_DEFLATED) as zipped:
            zipped.writestr("Furusato_nouzei.xlsm", BOOK)
            zipped.writestr("FurusatoDocumentReader.exe", READER)
            zipped.writestr("README.txt", b"unsafe: falsely called formal release")
            zipped.writestr("NOT_FOR_PUBLIC_RELEASE.txt", MARKER)
        report = dict(
            self.report,
            ready_to_use_review_sha256=digest_file(self.archive),
            review_readme_sha256=sha(b"unsafe: falsely called formal release"),
        )
        with self.assertRaisesRegex(ValueError, "REVIEW_README_MISLEADING"):
            self.run_gate(report=report)


if __name__ == "__main__":
    unittest.main(verbosity=2)
