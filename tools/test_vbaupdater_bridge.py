"""Portable staging contract checks. Does not invoke private VBAUpdater."""
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from prepare_vbaupdater_project import CANONICAL_VBA, prepare


class VbaUpdaterBridgeTest(unittest.TestCase):
    def test_staging_is_sandboxed_and_sources_are_unchanged(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            workbook = root / "Furusato_nouzei.xlsm"
            # Synthetic ZIP fixture, never used as an Excel acceptance artifact.
            with ZipFile(workbook, "w") as archive:
                archive.writestr("xl/workbook.xml", "<workbook/>")
                archive.writestr("xl/vbaProject.bin", b"test-only" * 2800)
            before = sha256(workbook.read_bytes()).hexdigest()
            vba_before = sha256(CANONICAL_VBA.read_bytes()).hexdigest()
            dest = root / "new-stage"
            report = prepare(workbook, dest)
            manifest = json.loads((dest / "project.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["schemaVersion"], "1.0")
            self.assertEqual(manifest["projectName"], "Furusato_nouzei_Inspection")
            self.assertEqual(manifest["source"]["root"], "source")
            self.assertEqual(manifest["components"], [{
                "type": "standard",
                "name": "TaxLawUpdater",
                "file": "standard/TaxLawUpdater.bas",
            }])
            self.assertTrue(manifest["validation"]["requireBackup"])
            self.assertEqual(manifest["target"]["file"], "Furusato_nouzei.xlsm")
            self.assertEqual(report["status"], "PREPARED_ONLY")
            self.assertEqual(report["source_workbook_sha256"], report["staged_workbook_sha256"])
            self.assertEqual(report["canonical_vba_sha256"], report["staged_vba_sha256"])
            self.assertEqual(sha256(workbook.read_bytes()).hexdigest(), before)
            self.assertEqual(sha256(CANONICAL_VBA.read_bytes()).hexdigest(), vba_before)
            with self.assertRaises(FileExistsError):
                prepare(workbook, dest)

    def test_rejects_untrusted_or_incomplete_workbooks(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            wrong = root / "Furusato_nouzei.xlsx"
            wrong.write_bytes(b"x" * 21000)
            with self.assertRaises(ValueError):
                prepare(wrong, root / "never-created")
            self.assertFalse((root / "never-created").exists())
            invalid = root / "Furusato_nouzei.xlsm"
            with ZipFile(invalid, "w") as archive:
                archive.writestr("xl/workbook.xml", b"x" * 25000)
            with self.assertRaises(ValueError):
                prepare(invalid, root / "never-created")
            self.assertFalse((root / "never-created").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
