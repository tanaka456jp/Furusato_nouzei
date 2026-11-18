"""Contract tests: only local operator can sign the accepted offline reader EXE."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
SCRIPT = Path(__file__).with_name("sign_reader_exe_local.ps1")

class ReaderSignerTest(unittest.TestCase):
    def test_fail_closed_signer_contract(self):
        text = SCRIPT.read_text(encoding="utf-8-sig")
        for requirement in (
            "READER_SIGNING_IN_CI_FORBIDDEN", "READER_SOURCE_SHA256_NOT_ACCEPTED",
            "READER_SIGNING_SOURCE_OVERWRITE_FORBIDDEN",
            "READER_SIGNING_PRIVATE_OUTPUT_REQUIRED",
            "READER_CODE_SIGNING_EKU_MISSING",
            "READER_SIGNER_TRUST_CHAIN_FAILED",
            "READER_HTTPS_RFC3161_TIMESTAMP_REQUIRED",
            "READER_AUTHENTICODE_TRUST_OR_TIMESTAMP_INVALID",
            "Get-AuthenticodeSignature", "/fd SHA256 /tr $TimestampUrl /td SHA256",
            "verify /pa /all /tw", "READER_EXE_SIGNED_LOCALLY_RELEASE_STILL_HOLD",
            "release_approved=$false", "[IO.File]::Copy($source,$target,$false)",
        ):
            with self.subTest(requirement=requirement):
                self.assertIn(requirement, text)
        for forbidden in ("New-SelfSignedCertificate", "Import-PfxCertificate",
                          "Set-ExecutionPolicy", "Set-AuthenticodeSignature",
                          "Import-Certificate"):
            self.assertNotIn(forbidden, text)

    @unittest.skipUnless(os.name == "nt", "Native Windows PowerShell required")
    def test_ci_execute_refused_before_access_to_cert_or_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "not_created.exe"
            result = subprocess.run([
                "powershell.exe", "-NoProfile", "-NonInteractive", "-File", str(SCRIPT),
                "-SourceExe", str(Path(tmp)/"nonexistent.exe"),
                "-OutputExe", str(dest),
                "-ExpectedSourceSha256", "a"*64, "-CertificateThumbprint", "b"*40,
                "-TimestampUrl", "https://timestamp.example.invalid", "-Execute",
            ], env={**os.environ, "CI":"true","GITHUB_ACTIONS":"true"},
               capture_output=True, text=True, timeout=25, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("READER_SIGNING_IN_CI_FORBIDDEN", result.stdout+result.stderr)
            self.assertFalse(dest.exists())
if __name__=="__main__":
    unittest.main(verbosity=2)
