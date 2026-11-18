"""Contract tests: only local operator can sign the accepted offline reader EXE."""
import hashlib
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
SCRIPT = Path(__file__).with_name("sign_reader_exe_local.ps1")

class ReaderSignerTest(unittest.TestCase):
    def test_fail_closed_signer_contract(self):
        text = SCRIPT.read_text(encoding="utf-8-sig")
        common = SCRIPT.with_name("office_vba_signature_common.ps1").read_text(
            encoding="utf-8-sig")
        self.assertIn("Find-X86SignTool $SignToolPath", text)
        self.assertIn("X86_SIGNTOOL_MICROSOFT_SIGNATURE_REQUIRED", common)
        self.assertIn("Get-LocalAuthenticodeSignature $candidate", common)
        self.assertNotIn("function Find-SignTool(", text)
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
            "$evidenceCreated=$true", "Remove-Item -LiteralPath $evidence -Force",
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

    @unittest.skipUnless(os.name == "nt", "Native Windows PowerShell required")
    def test_invalid_pe_and_source_digest_rejected_without_certificate(self):
        # Deliberately synthetic byte fixtures; no executable customer file
        # and no certificate/private-key use. Probe the real PowerShell code.
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "synthetic.exe")
            target = Path(tmp, "signed-not-created.exe")
            cases = []
            malformed_offset = bytearray(2048)
            malformed_offset[:2] = b"MZ"
            cases.append((malformed_offset, None, "READER_EXE_PE_OFFSET_INVALID"))
            malformed_signature = bytearray(2048)
            malformed_signature[:2] = b"MZ"
            malformed_signature[0x3C:0x40] = struct.pack("<I", 0x80)
            cases.append((malformed_signature, None, "READER_EXE_PE_SIGNATURE_INVALID"))
            valid_minimal = bytearray(malformed_signature)
            valid_minimal[0x80:0x84] = b"PE\x00\x00"
            # Wrong accepted digest must fail BEFORE any certificate access.
            cases.append((valid_minimal, "a" * 64, "READER_SOURCE_SHA256_NOT_ACCEPTED"))
            for contents, override, reason in cases:
                with self.subTest(reason=reason):
                    source.write_bytes(contents)
                    source_hash = override or hashlib.sha256(contents).hexdigest()
                    result = subprocess.run([
                        "powershell.exe", "-NoProfile", "-NonInteractive", "-File", str(SCRIPT),
                        "-SourceExe", str(source),
                        "-OutputExe", str(target),
                        "-ExpectedSourceSha256", source_hash,
                        "-CertificateThumbprint", "b" * 40,
                        "-TimestampUrl", "https://timestamp.example.invalid",
                    ], capture_output=True, text=True, check=False, timeout=25)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(reason, result.stdout + result.stderr)
                    self.assertFalse(target.exists())

    @unittest.skipUnless(os.name == "nt", "Native Windows PowerShell required")
    def test_fake_unsigned_signtool_is_refused_before_private_key_execution(self):
        # Test only the existing Microsoft-signed SDK tool resolver. Never
        # call an untrusted binary and never access a certificate/private key.
        with tempfile.TemporaryDirectory() as tmp:
            sdk = Path(tmp, "fake-sdk", "x86")
            sdk.mkdir(parents=True)
            impostor = sdk / "signtool.exe"
            pe = bytearray(2048)
            pe[:2] = b"MZ"
            pe[0x3C:0x40] = struct.pack("<I", 0x80)
            pe[0x80:0x86] = b"PE\x00\x00" + struct.pack("<H", 0x14c)
            impostor.write_bytes(pe)
            common = SCRIPT.with_name("office_vba_signature_common.ps1")
            escaped_common = str(common).replace("'", "''")
            escaped_impostor = str(impostor).replace("'", "''")
            command = (". '" + escaped_common + "'; " +
                       "Find-X86SignTool '" + escaped_impostor + "'")
            result = subprocess.run(["powershell.exe", "-NoProfile",
                                     "-NonInteractive", "-Command", command],
                                    capture_output=True, text=True,
                                    timeout=30, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("X86_SIGNTOOL_MICROSOFT_SIGNATURE_REQUIRED",
                          result.stdout + result.stderr)

if __name__=="__main__":
    unittest.main(verbosity=2)
