"""Release candidate workbook/README product identity negative contracts."""
import tempfile
import unittest
from pathlib import Path
from io import BytesIO
from openpyxl import Workbook
from zipfile import ZipFile, ZIP_STORED
from release_candidate_branding import verify_workbook_labels, verify_release_readme
from make_excel_release_readme import render
from assemble_excel_candidate_local import assemble

HEAD="a"*40
VER="v4.18.35"

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
        verify_release_readme(render(VER,HEAD),VER)

    def test_old_and_review_labels_rejected(self):
        for text in ("ふるさと納税 寄附限度額試算    v4.18.34",
                     "ふるさと納税 寄附限度額試算    "+VER+" 検証版"):
            with self.subTest(text=text),self.assertRaisesRegex(ValueError,"BRANDING_INVALID"):
                verify_workbook_labels(make_xlsm(text),VER)
        with self.assertRaises(ValueError):
            verify_workbook_labels(b"not an xlsm",VER)
        with self.assertRaises(ValueError):
            verify_release_readme(render(VER,HEAD).replace(VER.encode(),b"v4.18.2"),VER)
        with self.assertRaises(ValueError):
            verify_release_readme(render(VER,HEAD)+b"NOT FOR PUBLIC DISTRIBUTION",VER)

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
            h=assemble(book,reader,readme,target,VER)
            self.assertEqual(len(h),64)
            self.assertTrue(target.is_file())
            with self.assertRaisesRegex(ValueError,"CANDIDATE_OVERWRITE"):
                assemble(book,reader,readme,target,VER)

if __name__=="__main__":
    unittest.main(verbosity=2)
