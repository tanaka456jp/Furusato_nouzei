"""Unsigned internal bundle: synthetic fixtures only, NEVER a public Release."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from collect_reader_notices import NOTICE_NAME
from package_internal_unsigned import build
from package_ready_to_use_review import package_review

HEAD = "a" * 40
RUN_ID = 123456


class InternalUnsignedPackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="furusato_internal_unsigned_")
        self.addCleanup(self.tmp.cleanup)
        folder = Path(self.tmp.name)
        self.book = folder / "Furusato_nouzei.xlsm"
        self.exe = folder / "FurusatoDocumentReader.exe"
        self.guide = folder / "guide.txt"
        self.acceptance = folder / "acceptance.json"
        self.review_zip = folder / "review.zip"
        self.review_receipt = folder / "review_receipt.json"
        self.reader_report = folder / "reader_build.json"
        self.notice = folder / NOTICE_NAME
        self.out = folder / "INTERNAL_UNSIGNED.zip"
        self.evidence = folder / "private_receipt.json"
        self.book.write_bytes(b"synthetic-unsigned-workbook" * 5000)
        self.exe.write_bytes(b"MZ" + b"synthetic-exe-no-signature" * 1000)
        self.guide.write_text("synthetic user guide", encoding="utf-8")
        self.acceptance.write_text(json.dumps({
            "status": "PASS", "workbook_sha256": self.sha(self.book),
        }), encoding="utf-8")
        self.notice.write_text("FurusatoDocumentReader.exe third-party notices\n"
                               "Source HEAD: " + HEAD + "\nsynthetic notices\n",
                               encoding="utf-8")
        self.reader_data = {
            "schema": "furusato-reader-build/v1", "head_sha": HEAD,
            "run_id": RUN_ID, "exe_sha256": self.sha(self.exe),
            "exe_authenticode": "UNSIGNED", "windows_cli_accepted": True,
            "third_party_notices_sha256": self.sha(self.notice),
        }
        self.reader_report.write_text(json.dumps(self.reader_data), encoding="utf-8")
        receipt = package_review(self.book, self.exe, self.acceptance,
                                 self.guide, self.review_zip, head_sha=HEAD)
        self.review_data = receipt
        self.review_receipt.write_text(json.dumps(receipt), encoding="utf-8")
        self.args = {
            "review_zip": self.review_zip,
            "review_receipt": self.review_receipt,
            "reader_report": self.reader_report,
            "notice": self.notice,
            "output": self.out,
            "evidence": self.evidence,
            "head": HEAD,
            "run_id": RUN_ID,
        }

    @staticmethod
    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def call(self, **changes):
        # Synthetic binaries aren't valid OOXML / PE executables. Production
        # calls these real guards unpatched and rejects unsigned-state fakes.
        with patch("package_internal_unsigned._verify_xlsm"), \
             patch("package_internal_unsigned._inspect_reader"):
            return build(**dict(self.args, **changes))

    def reject(self, code, **changes):
        with self.assertRaisesRegex(ValueError, code):
            self.call(**changes)
        self.assertFalse(self.out.exists())
        self.assertFalse(self.evidence.exists())

    def test_unsigned_bundle_is_private_and_has_actual_binary_hashes(self):
        report = self.call()
        self.assertEqual(report["release_decision"], "HOLD")
        self.assertEqual(report["package_class"],
                         "UNSIGNED_PRIVATE_INTERNAL_EVALUATION")
        self.assertEqual(report["vba_signature"], "UNSIGNED")
        self.assertEqual(report["exe_authenticode"], "UNSIGNED")
        self.assertEqual(report["archive_sha256"], self.sha(self.out))
        with ZipFile(self.out) as zipfile:
            self.assertEqual(zipfile.read("Furusato_nouzei.xlsm"),
                             self.book.read_bytes())
            self.assertEqual(zipfile.read("FurusatoDocumentReader.exe"),
                             self.exe.read_bytes())
            self.assertEqual(zipfile.read(NOTICE_NAME), self.notice.read_bytes())
            readme = zipfile.read("README.txt").decode("utf-8")
            self.assertIn("署名なし・内部利用用", readme)
            self.assertIn(HEAD, readme)
            self.assertIn(str(RUN_ID), readme)
            self.assertIn("マクロ設定を変更したり", readme)
            self.assertIn("独立監査が完了するまで", readme)
            self.assertIn("NOT FOR PUBLIC RELEASE",
                          zipfile.read("INTERNAL_USE_UNSIGNED.txt").decode("utf-8"))
        self.assertEqual(json.loads(self.evidence.read_text()), report)

    def test_bad_head_and_run_refused(self):
        self.reject("INTERNAL_SOURCE_IDENTITY_INVALID", head="bad")
        self.reject("INTERNAL_SOURCE_IDENTITY_INVALID", run_id=-1)
        self.reject("INTERNAL_REVIEW_PROVENANCE_INVALID", head="b" * 40)
        self.reject("INTERNAL_READER_BUILD_PROVENANCE_INVALID", run_id=RUN_ID + 1)

    def test_corrupted_review_zip_refused(self):
        self.review_zip.write_bytes(self.review_zip.read_bytes() + b"tampered")
        self.reject("INTERNAL_REVIEW_PROVENANCE_INVALID")

    def test_missing_or_forged_acceptance_refused(self):
        for key, wrong in [
            ("release_decision", "READY"),
            ("package_class", "PUBLIC"),
            ("signing_state", "SIGNED"),
            ("accepted_workbook_sha256", "0" * 64),
        ]:
            with self.subTest(key=key):
                data = dict(self.review_data, **{key: wrong})
                self.review_receipt.write_text(json.dumps(data), encoding="utf-8")
                self.reject("INTERNAL_REVIEW_PROVENANCE_INVALID" if
                            key in ("release_decision", "package_class", "signing_state")
                            else "INTERNAL_REVIEW_MEMBER_DIGEST_INVALID")
                self.review_receipt.write_text(
                    json.dumps(self.review_data), encoding="utf-8")

    def test_reader_and_notices_bound_to_same_run(self):
        for key, wrong in [
            ("head_sha", "b" * 40), ("exe_authenticode", "SIGNED"),
            ("windows_cli_accepted", False),
            ("third_party_notices_sha256", "0" * 64),
            ("exe_sha256", "0" * 64),
        ]:
            with self.subTest(key=key):
                report = dict(self.reader_data, **{key: wrong})
                self.reader_report.write_text(json.dumps(report), encoding="utf-8")
                self.reject("INTERNAL_READER_BUILD_PROVENANCE_INVALID"
                            if key in ("head_sha", "exe_authenticode",
                                       "windows_cli_accepted")
                            else ("INTERNAL_THIRD_PARTY_NOTICE_INVALID"
                                  if key == "third_party_notices_sha256"
                                  else "INTERNAL_REVIEW_MEMBER_DIGEST_INVALID"))
                self.reader_report.write_text(
                    json.dumps(self.reader_data), encoding="utf-8")

    def test_output_no_overwrite_and_no_private_path_collision(self):
        self.out.write_bytes(b"original-keep")
        with self.assertRaisesRegex(ValueError, "INTERNAL_INPUT_OR_OUTPUT_INVALID"):
            self.call()
        self.assertEqual(self.out.read_bytes(), b"original-keep")
        self.out.unlink()
        self.reject("INTERNAL_PATH_COLLISION", output=self.review_zip)

    def test_json_duplicate_key_and_nonfinite_rejected(self):
        self.review_receipt.write_text('{"schema":"a","schema":"b"}',
                                       encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "DUPLICATE_RELEASE_EVIDENCE_JSON_KEY"):
            self.call()
        self.assertFalse(self.out.exists())
        self.review_receipt.write_text('{"schema":NaN}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "NONFINITE_RELEASE_EVIDENCE_JSON"):
            self.call()
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
