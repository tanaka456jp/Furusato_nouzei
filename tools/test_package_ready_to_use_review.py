"""Review-only ReadyToUse packaging must never promote unaccepted bytes."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from package_ready_to_use_review import package_review, EXPECTED_NAMES

HEAD = "a" * 40


class ReadyToUseReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        folder = Path(self.tmp.name)
        self.book = folder / "Furusato_nouzei.xlsm"
        self.book.write_bytes(b"synthetic-com-workbook" * 7000)
        self.exe = folder / "FurusatoDocumentReader.exe"
        self.exe.write_bytes(b"MZ" + b"synthetic-exe" * 1000)
        self.guide = folder / "README.txt"
        self.guide.write_text("anonymous synthetic instructions",encoding="utf-8")
        self.acceptance = folder / "excel_acceptance.json"
        self.out = folder / "candidate.zip"
        self.acceptance.write_text(json.dumps({
            "status":"PASS",
            "workbook_sha256": hashlib.sha256(self.book.read_bytes()).hexdigest()}),
            encoding="utf-8")

    def build(self):
        return package_review(self.book, self.exe, self.acceptance,
                              self.guide,self.out,head_sha=HEAD)

    def test_valid_accepted_binary_bytes_still_hold(self):
        report = self.build()
        self.assertEqual(report["release_decision"], "HOLD")
        self.assertEqual(report["package_class"],"SYNTHETIC_CI_REVIEW_ONLY")
        with ZipFile(self.out) as archive:
            self.assertEqual(set(archive.namelist()), EXPECTED_NAMES)
            self.assertEqual(archive.read("Furusato_nouzei.xlsm"),self.book.read_bytes())
            self.assertIn(b"NOT FOR PUBLIC DISTRIBUTION",
                          archive.read("NOT_FOR_PUBLIC_RELEASE.txt"))
            readme = archive.read("README.txt").decode("utf-8")
            self.assertTrue(readme.startswith("# 次期版 ReadyToUse 実機検証用"))
            self.assertIn(HEAD, readme)
            self.assertIn("正式配布HOLD", readme)
            self.assertIn("Excel 365", readme)
            self.assertNotIn("本パッケージはv4.18.2正式版です。", readme)
            self.assertEqual(report["review_readme_sha256"],
                             hashlib.sha256(archive.read("README.txt")).hexdigest())
        with self.assertRaisesRegex(ValueError,"REFUSE_TO_OVERWRITE_REVIEW_ZIP"):
            self.build()

    def test_previous_official_release_copy_is_corrected_only_in_review_zip(self):
        content = ("# ふるさと納税 寄附限度額試算 v4.18.2 正式版（対応範囲限定）\\n"
                   "本パッケージはv4.18.2正式版です。\\n")
        self.guide.write_text(content, encoding="utf-8")
        self.build()
        with ZipFile(self.out) as archive:
            readme = archive.read("README.txt").decode("utf-8")
        self.assertIn("本検証ZIPは正式版ではありません", readme)
        self.assertNotIn("本パッケージはv4.18.2正式版です", readme)
        # Do not mutate the canonical current-version user guide.
        self.assertEqual(self.guide.read_text(encoding="utf-8"), content)

    def test_forged_or_stale_acceptance_rejected(self):
        self.book.write_bytes(self.book.read_bytes() + b"modified")
        with self.assertRaisesRegex(ValueError,"ACCEPTED_XLSM_SHA256_MISMATCH"):
            self.build()
        self.acceptance.write_text(json.dumps({"status":"FAILED","workbook_sha256":"a"*64}))
        with self.assertRaisesRegex(ValueError,"EXCEL_ACCEPTANCE_NOT_PASSED"):
            self.build()

    def test_invalid_source_names_and_sha_rejected(self):
        renamed=self.book.with_name("Other.xlsm")
        renamed.write_bytes(self.book.read_bytes())
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_BINARY_FILENAMES"):
            package_review(renamed,self.exe,self.acceptance,self.guide,self.out,head_sha=HEAD)
        with self.assertRaisesRegex(ValueError,"INVALID_HEAD_SHA"):
            package_review(self.book,self.exe,self.acceptance,self.guide,self.out,head_sha="not-sha")


if __name__=="__main__":
    unittest.main(verbosity=2)
