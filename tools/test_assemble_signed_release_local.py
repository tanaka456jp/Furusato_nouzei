"""Synthetic, review-only negative tests for private signed ZIP assembly.

The XLSM/OLE and PE fixtures are deliberately NOT signed. Patch only the
Office OOXML structure classifier in the positive test; this test must never
be treated as proof of live Windows SIP/Authenticode trust.
"""
import copy
import hashlib
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZIP_STORED, ZipFile

from assemble_signed_release_local import assemble, file_sha
from release_readiness import VERSION

HEAD = "a" * 40
VBA = bytes.fromhex("D0CF11E0A1B11AE1") + b"synthetic" * 200


def dummy_book(signed=False, vba=VBA):
    import io
    memory = io.BytesIO()
    with ZipFile(memory, "w", compression=ZIP_STORED) as archive:
        archive.writestr("xl/vbaProject.bin", vba)
        archive.writestr("padding.bin", bytes(115000))
        if signed:
            archive.writestr("xl/vbaProjectSignature.bin", b"dummy" * 150)
    return memory.getvalue()


def dummy_exe(signed=False):
    data = bytearray(24000)
    data[0:2] = b"MZ"
    struct.pack_into("<I", data, 0x3c, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    if signed:
        data[-1] = 1
    return bytes(data)


class SignedAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="furusato_signed_synth_")
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.accepted = root / "accepted.xlsm"
        self.signed = root / "signed.xlsm"
        self.reader = root / "accepted.exe"
        self.signed_reader = root / "signed.exe"
        self.vba_file = root / "vba-evidence.json"
        self.reader_file = root / "reader-evidence.json"
        self.target = root / "assembled.zip"
        self.receipt = root / "assembly.json"
        self.accepted.write_bytes(dummy_book())
        self.signed.write_bytes(dummy_book(signed=True))
        self.reader.write_bytes(dummy_exe())
        self.signed_reader.write_bytes(dummy_exe(signed=True))
        self.vba = {
            "schema": "furusato-local-vba-signing/v2",
            "head_sha": HEAD, "signing_state": "SIGNED",
            "availability": "AVAILABLE",
            "source_workbook_sha256": file_sha(self.accepted),
            "signed_workbook_sha256": file_sha(self.signed),
            "accepted_vba_project_sha256": hashlib.sha256(VBA).hexdigest(),
            "signed_vba_project_sha256": hashlib.sha256(VBA).hexdigest(),
            "signing_certificate_eku": "CODE_SIGNING",
            "certificate_thumbprint_matched": True,
            "office_vba_signed_property": "OFFICE_RECOGNIZED_SIGNED_PROJECT",
            "signtool_verified": True, "certificate_chain_verified": True,
            "timestamp_verified": True, "test_only": False,
            "release_approved": False,
        }
        self.exe_evidence = {
            "schema": "furusato-reader-authenticode-local/v1",
            "signing_state": "SIGNED",
            "source_exe_sha256": file_sha(self.reader),
            "signed_exe_sha256": file_sha(self.signed_reader),
            "signer_certificate_verified": True,
            "signer_chain_verified": True,
            "timestamp_verified": True, "release_approved": False,
        }
        self.flush()
        self.args = dict(
            head=HEAD, run_id=44577629255, version=VERSION,
            accepted_book=self.accepted, signed_book=self.signed,
            accepted_reader=self.reader, signed_reader=self.signed_reader,
            vba_evidence=self.vba_file, reader_evidence=self.reader_file,
            target=self.target, receipt=self.receipt,
            accepted_book_sha=file_sha(self.accepted),
            accepted_reader_sha=file_sha(self.reader),
        )

    def flush(self):
        self.vba_file.write_text(json.dumps(self.vba), encoding="utf-8")
        self.reader_file.write_text(json.dumps(self.exe_evidence), encoding="utf-8")

    def attempt(self, **changes):
        options = dict(self.args, **changes)
        # Synthetic fixtures are not actual Office OOXML signatures; a real
        # signed workbook is fully validated by _verify_xlsm, never mocked in
        # the production assembler.
        with patch("assemble_signed_release_local.verify_workbook_labels"), \
             patch("assemble_signed_release_local._verify_xlsm",
                   return_value=hashlib.sha256(VBA).hexdigest()):
            return assemble(**options)

    def assert_refused(self, reason, **changes):
        with self.assertRaisesRegex(ValueError, reason):
            self.attempt(**changes)
        self.assertFalse(self.target.exists())
        self.assertFalse(self.receipt.exists())

    def test_review_only_assembly_binds_actual_binaries_and_zip(self):
        result = self.attempt()
        self.assertEqual(result["release_decision"], "HOLD")
        self.assertEqual(result["local_crypto_signature_reverification"], "REQUIRED")
        self.assertEqual(result["signed_zip_sha256"], file_sha(self.target))
        self.assertEqual(result["signed_workbook_sha256"], file_sha(self.signed))
        self.assertEqual(result["signed_reader_sha256"], file_sha(self.signed_reader))
        with ZipFile(self.target) as archive:
            self.assertEqual(archive.namelist(),
                             ["Furusato_nouzei.xlsm", "FurusatoDocumentReader.exe",
                              "README.txt"])
            self.assertEqual(archive.read("Furusato_nouzei.xlsm"),
                             self.signed.read_bytes())
            self.assertEqual(archive.read("FurusatoDocumentReader.exe"),
                             self.signed_reader.read_bytes())
        self.assertEqual(json.loads(self.receipt.read_text()), result)

    def test_ci_identity_and_source_digest_must_match(self):
        self.assert_refused("SIGNED_ASSEMBLY_IDENTITY_INVALID", head="b" * 40)
        self.assert_refused("SIGNED_ASSEMBLY_IDENTITY_INVALID", run_id=0)
        self.assert_refused("SIGNED_ASSEMBLY_IDENTITY_INVALID", version="v4.18.2")
        self.assert_refused("SIGNED_ASSEMBLY_UNACCEPTED_CI_SOURCES",
                            accepted_book_sha="0" * 64)
        self.assert_refused("SIGNED_ASSEMBLY_UNACCEPTED_CI_SOURCES",
                            accepted_reader_sha="0" * 64)

    def test_forged_or_legacy_signing_evidence_rejected(self):
        for field, invalid in (
            ("schema", "furusato-local-vba-signing/v1"),
            ("head_sha", "b" * 40),
            ("test_only", True),
            ("signtool_verified", False),
            ("certificate_chain_verified", False),
            ("timestamp_verified", False),
            ("release_approved", True),
            ("signed_workbook_sha256", "0" * 64),
        ):
            with self.subTest(field=field):
                changed = copy.deepcopy(self.vba)
                changed[field] = invalid
                self.vba_file.write_text(json.dumps(changed), encoding="utf-8")
                self.assert_refused("SIGNED_ASSEMBLY_VBA_EVIDENCE_INVALID")
                self.flush()
        changed = dict(self.vba, unexpected_private_key="must-reject")
        self.vba_file.write_text(json.dumps(changed), encoding="utf-8")
        self.assert_refused("SIGNED_ASSEMBLY_VBA_EVIDENCE_INVALID")
        self.flush()

    def test_reader_signing_evidence_must_match_actual_exe(self):
        for field, invalid in (
            ("signing_state", "UNSIGNED"),
            ("source_exe_sha256", "0" * 64),
            ("signed_exe_sha256", "0" * 64),
            ("timestamp_verified", False),
            ("release_approved", True),
        ):
            with self.subTest(field=field):
                changed = copy.deepcopy(self.exe_evidence)
                changed[field] = invalid
                self.reader_file.write_text(json.dumps(changed), encoding="utf-8")
                self.assert_refused("SIGNED_ASSEMBLY_READER_EVIDENCE_INVALID")
                self.flush()

    def test_vba_source_must_survive_signing_unchanged(self):
        new_project = VBA + b"tamper"
        self.signed.write_bytes(dummy_book(signed=True, vba=new_project))
        self.vba["signed_workbook_sha256"] = file_sha(self.signed)
        self.flush()
        self.assert_refused("SIGNED_ASSEMBLY_VBA_PROJECT_CHANGED")

    def test_cannot_overwrite_or_claim_invalid_reader(self):
        self.signed_reader.write_bytes(self.reader.read_bytes())
        self.exe_evidence["signed_exe_sha256"] = file_sha(self.signed_reader)
        self.flush()
        self.assert_refused("SIGNED_ASSEMBLY_SOURCE_AND_SIGNED_IDENTICAL")
        self.signed_reader.write_bytes(dummy_exe(signed=True))
        self.flush()
        self.target.write_bytes(b"do-not-overwrite")
        with self.assertRaisesRegex(ValueError, "SIGNED_ASSEMBLY_INPUT_OR_OUTPUT_INVALID"):
            self.attempt()
        self.assertEqual(self.target.read_bytes(), b"do-not-overwrite")

    def test_duplicate_and_nonfinite_evidence_json_refused(self):
        self.vba_file.write_text('{"schema":"x","schema":"y"}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "DUPLICATE_RELEASE_EVIDENCE_JSON_KEY"):
            self.attempt()
        self.assertFalse(self.target.exists())
        self.vba_file.write_text('{"schema":NaN}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "NONFINITE_RELEASE_EVIDENCE_JSON"):
            self.attempt()
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
