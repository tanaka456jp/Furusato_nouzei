"""Run the *actual* offline release guard against synthetic unsigned XLSM.

No private documents, real printers, certificates, network APIs, or releases
are accessed. The test creates disposable nested ZIP fixtures and proves that
unsigned VBA is rejected before any Authenticode approval.
"""
import hashlib
import io
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("verify_signed_release_local.ps1")


def _candidate(folder, include_vba, include_signature, relationship="absent"):
    workbook = io.BytesIO()
    with zipfile.ZipFile(workbook, "w", compression=zipfile.ZIP_STORED) as out:
        if include_vba:
            out.writestr("xl/vbaProject.bin", bytes(2048))
        if include_signature:
            out.writestr("xl/vbaProjectSignature.bin", bytes(256))
        if relationship != "absent":
            relation_type = (
                "http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignature"
                if relationship != "wrong-type" else
                "http://schemas.microsoft.com/office/2006/relationships/other")
            target_mode = ' TargetMode="External"' if relationship == "external" else ""
            target = (
                "missingSignature.bin" if relationship == "wrong-target"
                else "vbaProjectSignature.bin"
            )
            rels = (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="' + relation_type +
                '" Target="' + target + '"' + target_mode + "/></Relationships>"
            )
            if relationship == "malformed":
                rels = '<!DOCTYPE a [ <!ENTITY stolen SYSTEM "file:///etc/passwd"> ]><Relationships>&stolen;</Relationships>'
            out.writestr("xl/_rels/vbaProject.bin.rels", rels)
        # Large but harmless stored bytes satisfy the release package size
        # lower bound without generating any real executable or workbook.
        out.writestr("xl/worksheets/sheet1.xml", bytes(110_000))
    filename = folder / "synthetic_release_candidate.zip"
    with zipfile.ZipFile(filename, "w", compression=zipfile.ZIP_STORED) as out:
        out.writestr("Furusato_nouzei.xlsm", workbook.getvalue())
        out.writestr("FurusatoDocumentReader.exe", bytes(11_000))
        out.writestr("README.txt", "Synthetic signed-release guard test only")
    return filename


def _run_probe(folder, package):
    checksum = hashlib.sha256(package.read_bytes()).hexdigest()
    cmd = [
        "pwsh", "-NoProfile", "-NonInteractive", "-File", str(SCRIPT),
        "-Package", str(package),
        "-ExpectedPackageSha256", checksum,
        "-ExpectedSignerThumbprint", "A" * 40,
        "-EvidencePath", str(folder / "must_not_be_created.json"),
    ]
    output = subprocess.run(cmd, cwd=folder, text=True, capture_output=True,
                            timeout=35, check=False)
    return output.returncode, output.stdout + output.stderr


class LocalSignedReleaseNegativeAcceptance(unittest.TestCase):
    def _assert_refused(self, *, vba, signature, expected, relationship="absent"):
        with tempfile.TemporaryDirectory(prefix="furusato_fake_release_") as root:
            folder = Path(root)
            package = _candidate(folder, vba, signature, relationship)
            rc, output = _run_probe(folder, package)
            self.assertNotEqual(rc, 0, "Unsafe package was accepted")
            self.assertIn(expected, output)
            self.assertFalse((folder / "must_not_be_created.json").exists())

    def test_no_macro_project_is_refused_before_exe_check(self):
        self._assert_refused(
            vba=False, signature=False,
            expected="MACRO_WORKBOOK_VBA_PROJECT_MISSING_OR_INVALID")

    def test_unsigned_macro_is_refused_before_exe_check(self):
        self._assert_refused(
            vba=True, signature=False,
            expected="VBA_MACRO_SIGNATURE_NOT_DISCOVERED")

    def test_loose_signature_is_not_project_attached(self):
        self._assert_refused(
            vba=True, signature=True, relationship="absent",
            expected="VBA_SIGNATURE_RELATIONSHIP_MISSING")

    def test_wrong_type_target_or_external_relationship_is_rejected(self):
        for relationship in ("wrong-type", "wrong-target", "external"):
            with self.subTest(relationship=relationship):
                self._assert_refused(
                    vba=True, signature=True, relationship=relationship,
                    expected="VBA_SIGNATURE_PART_NOT_ATTACHED_TO_PROJECT")

    def test_xml_entity_attack_fails_without_release_evidence(self):
        with tempfile.TemporaryDirectory(prefix="furusato_fake_release_") as root:
            folder = Path(root)
            package = _candidate(folder, True, True, "malformed")
            rc, output = _run_probe(folder, package)
            self.assertNotEqual(rc, 0)
            self.assertFalse((folder / "must_not_be_created.json").exists())
            self.assertNotIn(
                "SIGNATURE_AND_ARCHIVE_HASH_VERIFIED_MANUAL_RELEASE_APPROVAL_REQUIRED",
                output)

    def test_signature_container_cannot_approve_unsigned_reader(self):
        # A fake signature container has no authority. The unsigned EXE
        # must still fail its independent Authenticode check on Windows;
        # on non-Windows PowerShell, the Authenticode cmdlet may be absent.
        with tempfile.TemporaryDirectory(prefix="furusato_fake_release_") as root:
            folder = Path(root)
            package = _candidate(folder, True, True, "linked")
            rc, output = _run_probe(folder, package)
            self.assertNotEqual(rc, 0)
            self.assertFalse((folder / "must_not_be_created.json").exists())
            self.assertNotIn(
                "SIGNATURE_AND_ARCHIVE_HASH_VERIFIED_MANUAL_RELEASE_APPROVAL_REQUIRED",
                output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
