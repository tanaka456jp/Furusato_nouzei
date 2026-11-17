"""Fail-closed local Excel VBA signer contract; public CI never signs or owns keys."""
from pathlib import Path
import hashlib
import os
import subprocess
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).with_name("sign_excel_vba_local.ps1")


class ExcelVbaSignerTest(unittest.TestCase):
    def test_local_opt_in_certificate_and_office_verification_guards(self):
        script = SCRIPT.read_text(encoding="utf-8-sig")
        for required in (
            "[switch]$Execute",
            "SIGNING_IN_CI_FORBIDDEN_USE_PRIVATE_LOCAL_MACHINE",
            "ExpectedSourceSha256",
            "SOURCE_WORKBOOK_SHA256_NOT_ACCEPTED",
            "SOURCE_WORKBOOK_ALREADY_HAS_VBA_SIGNATURE",
            "SIGNED_VBA_PROJECT_DIFFERS_FROM_ACCEPTED_INPUT",
            "ACCEPTED_SOURCE_WORKBOOK_CHANGED_DURING_SIGNING",
            "SIGNING_MUST_NOT_MODIFY_ORIGINAL_WORKBOOK",
            "REFUSE_TO_OVERWRITE_SIGNED_OUTPUT",
            "XLSM_MISSING_UNIQUE_VBA_PROJECT",
            "CODE_SIGNING_CERTIFICATE_NOT_FOUND_IN_CURRENT_USER_MY",
            "SIGNING_PRIVATE_KEY_NOT_ACCESSIBLE",
            "CODE_SIGNING_EKU_REQUIRED",
            "CERTIFICATE_CHAIN_OR_REVOCATION_NOT_VALIDATED",
            "HTTPS_RFC3161_TIMESTAMP_URL_REQUIRED",
            "UNTRUSTED_TEST_SIGNATURE_REQUIRES_TEST_ONLY_FILENAME",
            "Copy-Item -LiteralPath $source -Destination $destination",
            "OFFICE_SIP_SIGNTOOL_SIGN_FAILED",
            "OFFICE_SIP_SIGNTOOL_VERIFY_FAILED",
            "OFFICE_VBA_SIGNATURE_NOT_RECOGNIZED",
            "$office.AutomationSecurity = 3",
            "$book.VBASigned",
            "source_workbook_sha256",
            "signed_workbook_sha256",
            "release_approved = $false",
        ):
            with self.subTest(required=required):
                self.assertIn(required, script)
        for forbidden in (
            "New-SelfSignedCertificate",
            "Set-ExecutionPolicy",
            "Import-PfxCertificate",
            "Set-AuthenticodeSignature",
            "Import-Certificate",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, script)

    @unittest.skipUnless(os.name == "nt", "Native Windows PowerShell required")
    def test_ci_refuses_signing_before_touching_key_or_input(self):
        with tempfile.TemporaryDirectory() as root:
            out = Path(root, "refused.xlsm")
            args = [
                "powershell.exe", "-NoProfile", "-NonInteractive", "-File",
                str(SCRIPT), "-SourceWorkbook", str(Path(root, "missing.xlsm")),
                "-OutputWorkbook", str(out), "-CertificateThumbprint", "a" * 40,
                "-ExpectedSourceSha256", "a" * 64, "-Execute",
            ]
            environment = {**os.environ, "CI": "true", "GITHUB_ACTIONS": "true"}
            result = subprocess.run(args, capture_output=True, text=True,
                                    env=environment, timeout=25, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("SIGNING_IN_CI_FORBIDDEN_USE_PRIVATE_LOCAL_MACHINE",
                          result.stdout + result.stderr)
            self.assertFalse(out.exists())

    @unittest.skipUnless(os.name == "nt", "Native Windows PowerShell required")
    def test_wrong_ci_sha_is_refused_before_certificate_access(self):
        with tempfile.TemporaryDirectory() as root:
            xlsm = Path(root, "synthetic.xlsm")
            with zipfile.ZipFile(xlsm, "w") as archive:
                archive.writestr("xl/vbaProject.bin", b"V" * 512)
            destination = Path(root, "not_signed.xlsm")
            args = [
                "powershell.exe", "-NoProfile", "-NonInteractive", "-File",
                str(SCRIPT), "-SourceWorkbook", str(xlsm),
                "-OutputWorkbook", str(destination),
                "-CertificateThumbprint", "a" * 40,
                "-ExpectedSourceSha256", "a" * 64,
            ]
            result = subprocess.run(args, capture_output=True, text=True,
                                    timeout=25, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("SOURCE_WORKBOOK_SHA256_NOT_ACCEPTED",
                          result.stdout + result.stderr)
            self.assertFalse(destination.exists())

    @unittest.skipUnless(os.name == "nt", "Native Windows PowerShell required")
    def test_already_signed_source_is_refused_before_certificate_access(self):
        with tempfile.TemporaryDirectory() as root:
            xlsm = Path(root, "synthetic_signed.xlsm")
            with zipfile.ZipFile(xlsm, "w") as archive:
                archive.writestr("xl/vbaProject.bin", b"V" * 512)
                archive.writestr("xl/vbaProjectSignature.bin", b"synthetic")
            sha = hashlib.sha256(xlsm.read_bytes()).hexdigest()
            destination = Path(root, "not_signed.xlsm")
            args = [
                "powershell.exe", "-NoProfile", "-NonInteractive", "-File",
                str(SCRIPT), "-SourceWorkbook", str(xlsm),
                "-OutputWorkbook", str(destination),
                "-CertificateThumbprint", "a" * 40,
                "-ExpectedSourceSha256", sha,
            ]
            result = subprocess.run(args, capture_output=True, text=True,
                                    timeout=25, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("SOURCE_WORKBOOK_ALREADY_HAS_VBA_SIGNATURE",
                          result.stdout + result.stderr)
            self.assertFalse(destination.exists())

    @unittest.skipUnless(os.name == "nt", "Native Windows PowerShell required")
    def test_missing_input_preflight_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as root:
            out = Path(root, "refused.xlsm")
            args = [
                "powershell.exe", "-NoProfile", "-NonInteractive", "-File",
                str(SCRIPT), "-SourceWorkbook", str(Path(root, "missing.xlsm")),
                "-OutputWorkbook", str(out), "-CertificateThumbprint", "a" * 40,
                "-ExpectedSourceSha256", "a" * 64,
            ]
            environment = {**os.environ, "CI": "true"}
            result = subprocess.run(args, capture_output=True, text=True,
                                    env=environment, timeout=25, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
