"""Release candidate workbook/README product identity negative contracts."""
import re
import tempfile
import warnings
import unittest
from pathlib import Path
from io import BytesIO
from openpyxl import Workbook
from zipfile import ZipFile, ZIP_STORED
from release_candidate_branding import verify_workbook_labels, verify_release_readme
from make_excel_release_readme import render
from assemble_excel_candidate_local import assemble

HEAD="a"*40
VER="v4.18.36"

def make_xlsm(title=None):
    wb=Workbook()
    wb.active.title="操作画面"
    wb.active["A1"]=title or ("ふるさと納税 寄附限度額試算    "+VER)
    wb.create_sheet("住宅確申寄附検算")["A1"]="確定申告・住宅ローン控除併用：寄附額別の実税負担差分"
    out=BytesIO()
    wb.save(out)
    wb.close()
    # Real signed macro-enabled books exceed 100 KiB. Preserve the product
    # minimum-size safety gate; pad only this invented in-memory OOXML test.
    with ZipFile(out, "a") as zipped:
        zipped.writestr("synthetic/randomlike-padding.bin",
                        bytes(range(256)) * 480, compress_type=ZIP_STORED)
    return out.getvalue()

class ReleaseCandidateBranding(unittest.TestCase):
    def test_verified_workbook_labels_and_readme(self):
        verify_workbook_labels(make_xlsm(),VER)
        verify_release_readme(render(VER,HEAD),VER,HEAD)

    def test_old_and_review_labels_rejected(self):
        for text in ("ふるさと納税 寄附限度額試算    v4.18.35",
                     "ふるさと納税 寄附限度額試算    "+VER+" 検証版"):
            with self.subTest(text=text),self.assertRaisesRegex(ValueError,"BRANDING_INVALID"):
                verify_workbook_labels(make_xlsm(text),VER)
        with self.assertRaises(ValueError):
            verify_workbook_labels(b"not an xlsm",VER)
        with self.assertRaises(ValueError):
            verify_release_readme(render(VER,HEAD).replace(VER.encode(),b"v4.18.2"),VER,HEAD)
        with self.assertRaises(ValueError):
            verify_release_readme(render(VER,HEAD)+b"NOT FOR PUBLIC DISTRIBUTION",VER,HEAD)

    def test_ambiguous_workbook_versions_and_readme_versions_fail_closed(self):
        # A valid version appended to a stale title must not make it releasable.
        for title in (
            "ふるさと納税 寄附限度額試算    "+VER+" / v4.18.35",
            "ふるさと納税 寄附限度額試算    v4.18.35 / "+VER,
        ):
            with self.subTest(title=title), self.assertRaisesRegex(
                    ValueError, "BRANDING_INVALID"):
                verify_workbook_labels(make_xlsm(title),VER)
        misleading = render(VER,HEAD).replace(
            "ソースHEAD：".encode("utf-8"),
            "参考 v4.18.35\\nソースHEAD：".encode("utf-8"))
        with self.assertRaisesRegex(ValueError, "VERSION_OR_SCOPE_INVALID"):
            verify_release_readme(misleading,VER,HEAD)

    def test_ambiguous_or_traversal_ooxml_members_fail_closed(self):
        # ZIP may present a different workbook.xml to Office than to openpyxl.
        for member in ("xl/workbook.xml", "XL/WORKBOOK.XML",
                       "xl/../xl/evil.xml", "xl\\evil.xml"):
            with self.subTest(member=member):
                packet = BytesIO(make_xlsm())
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    with ZipFile(packet, "a", compression=ZIP_STORED) as out:
                        out.writestr(member, b"<altered/>")
                with self.assertRaisesRegex(
                        ValueError, "UNSAFE_RELEASE_XLSM_INTERNAL_PACKAGE"):
                    verify_workbook_labels(packet.getvalue(),VER)

    def test_source_head_is_bound_to_release_candidate_readme(self):
        with self.assertRaisesRegex(ValueError, "RELEASE_README_HEAD_MISMATCH"):
            verify_release_readme(render(VER, HEAD), VER, "b" * 40)
        with self.assertRaisesRegex(ValueError, "INVALID_RELEASE_SOURCE_HEAD"):
            verify_release_readme(render(VER, HEAD), VER, "")

    def test_release_instructions_match_candidate_version(self):
        # Commands in operator guides must match the current XLSM/README branding.
        docs = Path(__file__).resolve().parents[1] / "docs"
        for name in ("excel-v41836-release.md",):
            with self.subTest(document=name):
                content = (docs / name).read_text(encoding="utf-8")
                versions = re.findall(r"--version\s+(v\d+\.\d+\.\d+)", content)
                self.assertTrue(versions, "Missing concrete release candidate command")
                self.assertTrue(all(version == VER for version in versions),
                                f"Stale release candidate version in {name}: {versions}")

    def test_assembler_only_stage_copy_preserving_bytes(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            book=root/"Furusato_nouzei.xlsm"
            reader=root/"FurusatoDocumentReader.exe"
            readme=root/"README.txt"
            target=root/"test-release-candidate.zip"
            book.write_bytes(make_xlsm())
            reader.write_bytes(b"synthetic-exe-no-signature"*500)
            readme.write_bytes(render(VER,HEAD))
            h=assemble(book,reader,readme,target,VER,HEAD)
            self.assertEqual(len(h),64)
            self.assertTrue(target.is_file())
            with self.assertRaisesRegex(ValueError,"CANDIDATE_OVERWRITE"):
                assemble(book,reader,readme,target,VER,HEAD)

if __name__=="__main__":
    unittest.main(verbosity=2)
