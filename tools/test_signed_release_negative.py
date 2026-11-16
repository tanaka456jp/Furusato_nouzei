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


def _candidate(folder, include_vba, include_signature):
    workbook = io.BytesIO()
    with zipfile.ZipFile(workbook, "w", compression=zipfile.ZIP_STORED) as out:
        if include_vba:
            out.writestr("xl/vbaProject.bin", bytes(2048))
        if include_signature:
            out.writestr("xl/vbaProjectSignature.bin", bytes(256))
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
    def _assert_refused(self, *, vba, signature, expected):
        with tempfile.TemporaryDirectory(prefix="furusato_fake_release_") as root:
            folder = Path(root)
            package = _candidate(folder, vba, signature)
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

    def test_signature_container_cannot_approve_unsigned_reader(self):
        # A fake signature container has no authority. The unsigned EXE
        # must still fail its independent Authenticode check on Windows;
        # on non-Windows PowerShell, the Authenticode cmdlet may be absent.
        with tempfile.TemporaryDirectory(prefix="furusato_fake_release_") as root:
            folder = Path(root)
            package = _candidate(folder, True, True)
            rc, output = _run_probe(folder, package)
            self.assertNotEqual(rc, 0)
            self.assertFalse((folder / "must_not_be_created.json").exists())
            self.assertNotIn(
                "SIGNATURE_AND_ARCHIVE_HASH_VERIFIED_MANUAL_RELEASE_APPROVAL_REQUIRED",
                output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
