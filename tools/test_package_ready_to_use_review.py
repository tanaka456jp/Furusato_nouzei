"""Review-only ReadyToUse packaging must never promote unaccepted bytes."""
import hashlib
import io
import json
import random
import stat
import struct
import tempfile
import unittest
import warnings
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from openpyxl import Workbook

from package_ready_to_use_review import (
    BOOK_NAME, DISTRIBUTION_MEMBERS, EXPECTED_NAMES, READER_NAME, README_NAME,
    SIGNING_SCHEMA, check_distribution_zip_entries, digest, package_distribution,
    package_review, verify_distribution_archive,
)

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
            self.assertIn(chr(10) + chr(10) + "対象開発コミット", readme)
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
        self.assertNotIn("現行正式版v4.18.2", readme)
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


class ReadyToUseDistributionTests(unittest.TestCase):
    VERSION = "v4.18.36"

    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.folder = Path(scratch.name)
        self.book = self.folder / BOOK_NAME
        self.reader = self.folder / READER_NAME
        self.out = self.folder / "ReadyToUse.zip"

        base = Workbook()
        base.active.title = "操作画面"
        base.active["A1"] = "ふるさと納税 寄附限度額試算    " + self.VERSION
        base.create_sheet("住宅確申寄附検算")["A1"] = "確定申告・住宅ローン控除併用（試算）"
        workbook = io.BytesIO()
        base.save(workbook)
        base.close()
        self.vba = bytes.fromhex("D0CF11E0A1B11AE1") + random.Random(0).randbytes(120_000)
        with ZipFile(workbook) as original, ZipFile(self.book, "w") as result:
            for name in original.namelist():
                part = original.read(name)
                if name == "[Content_Types].xml":
                    part = part.replace(b"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
                                        b"application/vnd.ms-excel.sheet.macroEnabled.main+xml")
                    part = part.replace(b"</Types>", b'<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>')
                elif name == "xl/_rels/workbook.xml.rels":
                    part = part.replace(b"</Relationships>", b'<Relationship Id="rId100" Target="vbaProject.bin" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject"/></Relationships>')
                result.writestr(name, part)
            result.writestr("xl/vbaProject.bin", self.vba)

        reader = bytearray(random.Random(1).randbytes(15_000))
        reader[:2] = b"MZ"
        struct.pack_into("<I", reader, 0x3c, 64)
        reader[64:68] = b"PE\0\0"
        struct.pack_into("<H", reader, 84, 240)
        struct.pack_into("<H", reader, 88, 0x20b)
        struct.pack_into("<I", reader, 196, 16)
        reader[232:240] = bytes(8)
        self.reader.write_bytes(reader)

    def options(self):
        workbook_sha = digest(self.book)
        return {
            "head_sha": HEAD, "version": self.VERSION, "accepted_workbook_sha256": workbook_sha,
            "accepted_reader_sha256": digest(self.reader), "signing_state": "UNSIGNED",
            "signing_evidence": {
                "schema": SIGNING_SCHEMA, "head_sha": HEAD, "signing_state": "UNSIGNED",
                "availability": "SIGNING_NOT_CONFIGURED", "source_workbook_sha256": workbook_sha,
                "signed_workbook_sha256": None,
            },
        }

    def test_unsigned_package_discloses_separate_modes_and_revalidates(self):
        options = self.options()
        result = package_distribution(self.book, self.reader, self.out, **options)
        self.assertEqual(result, verify_distribution_archive(self.out, **options))
        self.assertEqual(result["package_state"], "VERIFIED_NOT_PUBLISHED")
        self.assertEqual(result["vba_project_sha256"], hashlib.sha256(self.vba).hexdigest())
        renamed = self.folder / "second.zip"
        self.assertEqual(result["archive_sha256"], package_distribution(
            self.book, self.reader, renamed, **options)["archive_sha256"])
        with ZipFile(self.out) as archive:
            self.assertEqual(set(archive.namelist()), DISTRIBUTION_MEMBERS)
            guide = archive.read(README_NAME).decode("utf-8")
            self.assertIn("Furusato_nouzei.xlsm の VBA: UNSIGNED", guide)
            self.assertIn("FurusatoDocumentReader.exe: UNSIGNED", guide)
            self.assertIn("ブロックの解除", guide)
            self.assertIn("SHA-256", guide)
            self.assertIn("複数人一覧", guide)
            self.assertIn("一括計算一覧", guide)
            self.assertIn("給与所得だけ", guide)
            self.assertIn("申告分離課税", guide)
            self.assertIn("精緻計算", guide)
            self.assertIn("一覧消去", guide)
            self.assertIn("最大5人", guide)
            self.assertIn("HOLD", guide)
            self.assertIn("通常の上書き保存", guide)
        with self.assertRaises(FileExistsError):
            package_distribution(self.book, self.reader, self.out, **options)
        self.assertEqual(digest(self.out), result["archive_sha256"])

    def test_stale_head_or_signing_failure_cannot_be_unsigned(self):
        options = self.options()
        options["signing_evidence"]["head_sha"] = "b" * 40
        with self.assertRaisesRegex(ValueError, "SIGNING_EVIDENCE_PROVENANCE_INVALID"):
            package_distribution(self.book, self.reader, self.out, **options)
        options = self.options()
        options["signing_evidence"]["availability"] = "OFFICE_SIP_SIGNTOOL_SIGN_FAILED"
        with self.assertRaisesRegex(ValueError, "UNSIGNED_EVIDENCE_INVALID"):
            package_distribution(self.book, self.reader, self.out, **options)
        self.assertFalse(self.out.exists())

    def test_unsigned_package_refuses_embedded_signatures_and_cleans_failed_output(self):
        with ZipFile(self.book, "a") as archive:
            archive.writestr("xl/vbaProjectSignature.bin", b"invalid signature marker")
        with self.assertRaisesRegex(ValueError, "UNSIGNED_DISTRIBUTION_CONTAINS_SIGNATURE"):
            package_distribution(self.book, self.reader, self.out, **self.options())
        self.assertFalse(self.out.exists())

    def test_reader_is_independent_and_cannot_mislead_about_signature(self):
        unsafe_reader = bytearray(self.reader.read_bytes())
        struct.pack_into("<II", unsafe_reader, 232, 10_000, 1000)
        self.reader.write_bytes(unsafe_reader)
        with self.assertRaisesRegex(ValueError, "DISTRIBUTION_READER_UNSIGNED_STATE_MISMATCH"):
            package_distribution(self.book, self.reader, self.out, **self.options())
        self.assertFalse(self.out.exists())

    def test_package_refuses_duplicates_traversal_symlinks_and_bomb_ratio(self):
        options = self.options()
        package_distribution(self.book, self.reader, self.out, **options)
        symlink = ZipInfo(README_NAME)
        symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
        with ZipFile(self.out) as source:
            assets = [(entry.filename, source.read(entry)) for entry in source.infolist()]
        scenarios = {
            "duplicate": assets + [(README_NAME, b"duplicate")],
            "traversal": assets[:-1] + [("../README.txt", b"traversal")],
            "symlink": assets[:-1] + [(symlink, b"other.txt")],
            "bomb_ratio": assets[:-1] + [(README_NAME, bytes(1_024_000))],
        }
        for name, contents in scenarios.items():
            with self.subTest(name=name), warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                malformed = io.BytesIO()
                with ZipFile(malformed, "w", ZIP_DEFLATED) as archive:
                    for filename, payload in contents:
                        archive.writestr(filename, payload)
                with ZipFile(malformed) as archive:
                    with self.assertRaisesRegex(ValueError, "UNSAFE_DISTRIBUTION_ZIP_ENTRIES"):
                        check_distribution_zip_entries(archive.infolist())


if __name__=="__main__":
    unittest.main(verbosity=2)
