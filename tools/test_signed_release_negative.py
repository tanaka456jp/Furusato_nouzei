"""Run the *actual* offline release guard against synthetic unsigned XLSM.

No private documents, real printers, certificates, network APIs, or releases
are accessed. The test creates disposable nested ZIP fixtures and proves that
unsigned VBA is rejected before any Authenticode approval.
"""
import hashlib
import io
import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("verify_signed_release_local.ps1")


def _candidate(folder, include_vba, include_signature, relationship="absent",
               valid_ole_header=True, embedded_marker=False, content_types="valid",
               workbook_relationship="linked", signature_kind="legacy"):
    workbook = io.BytesIO()
    with zipfile.ZipFile(workbook, "w", compression=zipfile.ZIP_STORED) as out:
        if include_vba:
            # Valid CFB header; rest is synthetic, deliberately unsigned.
            header = bytes.fromhex("D0CF11E0A1B11AE1") if valid_ole_header else b"NOT_OLE!"
            marker = ("\x05" + "DigitalSignature").encode("utf-16-le") if embedded_marker else b""
            out.writestr("xl/vbaProject.bin", header + bytes(2040) + marker)
        sig_name = ("vbaProjectSignatureAgile.bin"
                    if signature_kind == "agile" else "vbaProjectSignature.bin")
        if include_signature:
            out.writestr("xl/" + sig_name, bytes(256))
        out.writestr("xl/workbook.xml",
                     '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>')
        if workbook_relationship != "absent":
            wb_type = (
                "http://schemas.microsoft.com/office/2006/relationships/vbaProject"
                if workbook_relationship != "wrong-type" else
                "http://schemas.microsoft.com/office/2006/relationships/other"
            )
            wb_target = "not-vba.bin" if workbook_relationship == "wrong-target" else "vbaProject.bin"
            wb_mode = ' TargetMode="External"' if workbook_relationship == "external" else ""
            wb_rels = (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="' + wb_type +
                '" Target="' + wb_target + '"' + wb_mode + "/></Relationships>"
            )
            if workbook_relationship == "duplicate":
                wb_rels = wb_rels.replace(
                    "</Relationships>",
                    '<Relationship Id="rId2" Type="' + wb_type +
                    '" Target="vbaProject.bin"/></Relationships>')
            if workbook_relationship == "xml-entity":
                wb_rels = '<!DOCTYPE Relationships [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + wb_rels
            out.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        if relationship != "absent":
            relation_type = (
                ("http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignatureAgile"
                 if signature_kind == "agile" else
                 "http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignature")
                if relationship != "wrong-type" else
                "http://schemas.microsoft.com/office/2006/relationships/other")
            target_mode = ' TargetMode="External"' if relationship == "external" else ""
            target = (
                "missingSignature.bin" if relationship == "wrong-target"
                else sig_name
            )
            rels = (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="' + relation_type +
                '" Target="' + target + '"' + target_mode + "/></Relationships>"
            )
            if relationship in ("linked-and-external", "duplicate-linked"):
                second_mode = ' TargetMode="External"' if relationship == "linked-and-external" else ""
                second = '<Relationship Id="rId2" Type="' + relation_type + '" Target="vbaProjectSignature.bin"' + second_mode + "/>"
                rels = rels.replace("</Relationships>", second + "</Relationships>")
            if relationship == "malformed":
                rels = '<!DOCTYPE a [ <!ENTITY stolen SYSTEM "file:///etc/passwd"> ]><Relationships>&stolen;</Relationships>'
            out.writestr("xl/_rels/vbaProject.bin.rels", rels)
        if content_types != "absent":
            ct_ns = "http://schemas.openxmlformats.org/package/2006/content-types"
            ct_entries = []
            if content_types != "missing-project":
                ct_entries.append('<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>')
            if include_signature and content_types != "missing-signature":
                ct = ("application/octet-stream" if content_types == "wrong-signature"
                      else ("application/vnd.ms-office.vbaProjectSignatureAgile"
                            if signature_kind == "agile" else
                            "application/vnd.ms-office.vbaProjectSignature"))
                sig_override = '<Override PartName="/xl/' + sig_name + '" ContentType="' + ct + '"/>'
                ct_entries.append(sig_override)
                if content_types == "duplicate-signature":
                    ct_entries.append(sig_override)
            xml = '<Types xmlns="' + ct_ns + '">' + "".join(ct_entries) + "</Types>"
            if content_types == "xml-entity":
                xml = '<!DOCTYPE Types [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml
            out.writestr("[Content_Types].xml", xml)
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
        ("powershell.exe" if os.name == "nt" else "pwsh"),
        "-NoProfile", "-NonInteractive", "-File", str(SCRIPT),
        "-Package", str(package),
        "-ExpectedPackageSha256", checksum,
        "-ExpectedSignerThumbprint", "A" * 40,
        "-EvidencePath", str(folder / "must_not_be_created.json"),
    ]
    output = subprocess.run(cmd, cwd=folder, text=True, capture_output=True,
                            timeout=35, check=False)
    return output.returncode, output.stdout + output.stderr


class LocalSignedReleaseNegativeAcceptance(unittest.TestCase):
    def _assert_refused(self, *, vba, signature, expected, relationship="absent",
                        valid_ole_header=True, embedded_marker=False, content_types="valid",
                        workbook_relationship="linked", signature_kind="legacy"):
        with tempfile.TemporaryDirectory(prefix="furusato_fake_release_") as root:
            folder = Path(root)
            package = _candidate(folder, vba, signature, relationship,
                                 valid_ole_header=valid_ole_header,
                                 embedded_marker=embedded_marker, content_types=content_types,
                                 workbook_relationship=workbook_relationship,
                                 signature_kind=signature_kind)
            rc, output = _run_probe(folder, package)
            self.assertNotEqual(rc, 0, "Unsafe package was accepted")
            self.assertIn(expected, output)
            self.assertFalse((folder / "must_not_be_created.json").exists())

    def test_workbook_vba_project_links_fail_closed(self):
        scenarios = {
            "absent": "VBA_PROJECT_WORKBOOK_RELATIONSHIP_MISSING",
            "wrong-type": "INVALID_VBA_PROJECT_WORKBOOK_RELATIONSHIP",
            "wrong-target": "INVALID_VBA_PROJECT_WORKBOOK_RELATIONSHIP",
            "external": "VBA_PROJECT_WORKBOOK_EXTERNAL_RELATIONSHIP",
            "duplicate": "VBA_PROJECT_WORKBOOK_RELATIONSHIP_MISSING_OR_DUPLICATE",
        }
        for scenario, expected in scenarios.items():
            with self.subTest(workbook_relationship=scenario):
                self._assert_refused(
                    vba=True, signature=True, relationship="linked",
                    workbook_relationship=scenario, expected=expected)

    def test_xxe_workbook_relationship_is_refused(self):
        with tempfile.TemporaryDirectory(prefix="furusato_fake_release_") as root:
            folder = Path(root)
            package = _candidate(folder, True, True, "linked",
                                 workbook_relationship="xml-entity")
            rc, output = _run_probe(folder, package)
            self.assertNotEqual(rc, 0)
            self.assertFalse((folder / "must_not_be_created.json").exists())
            self.assertNotIn(
                "SIGNATURE_AND_ARCHIVE_HASH_VERIFIED_MANUAL_RELEASE_APPROVAL_REQUIRED",
                output)

    def test_official_agile_signature_link_reaches_unsigned_exe_gate(self):
        # Official Microsoft Agile relationship uses the office/2006 URI.
        with tempfile.TemporaryDirectory(prefix="furusato_fake_release_") as root:
            folder = Path(root)
            package = _candidate(folder, True, True, "linked",
                                 signature_kind="agile")
            rc, output = _run_probe(folder, package)
            self.assertNotEqual(rc, 0)
            if os.name == "nt":
                self.assertIn("READER_EXE_AUTHENTICODE_NOT_TRUSTED", output)
            for unexpected in (
                "VBA_SIGNATURE_PART_NOT_ATTACHED_TO_PROJECT",
                "VBA_SIGNATURE_CONTENT_TYPE_MISMATCH",
                "INVALID_VBA_SIGNATURE_RELATIONSHIP",
                "VBA_PROJECT_WORKBOOK_RELATIONSHIP_MISSING",
            ):
                self.assertNotIn(unexpected, output)
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
        cases = {
            "wrong-type": "INVALID_VBA_SIGNATURE_RELATIONSHIP",
            "wrong-target": "INVALID_VBA_SIGNATURE_RELATIONSHIP",
            "external": "VBA_SIGNATURE_EXTERNAL_RELATIONSHIP",
        }
        for relationship, expected in cases.items():
            with self.subTest(relationship=relationship):
                self._assert_refused(
                    vba=True, signature=True, relationship=relationship,
                    expected=expected)

    def test_linked_signature_cannot_skip_ole_container_validation(self):
        self._assert_refused(
            vba=True, signature=True, relationship="linked",
            valid_ole_header=False, expected="INVALID_VBA_OLE_CONTAINER")

    def test_fake_embedded_signature_marker_is_not_accepted(self):
        self._assert_refused(
            vba=True, signature=False, embedded_marker=True,
            expected="VBA_MACRO_SIGNATURE_NOT_DISCOVERED")

    def test_valid_link_plus_external_link_is_rejected(self):
        self._assert_refused(
            vba=True, signature=True, relationship="linked-and-external",
            expected="VBA_SIGNATURE_EXTERNAL_RELATIONSHIP")

    def test_duplicate_signature_relationship_is_rejected(self):
        self._assert_refused(
            vba=True, signature=True, relationship="duplicate-linked",
            expected="DUPLICATE_VBA_SIGNATURE_RELATIONSHIP")

    def test_invalid_content_type_mappings_are_refused(self):
        cases = {
            "absent": "VBA_SIGNATURE_CONTENT_TYPES_MISSING",
            "missing-project": "VBA_SIGNATURE_CONTENT_TYPE_MISMATCH",
            "missing-signature": "VBA_SIGNATURE_CONTENT_TYPE_MISMATCH",
            "wrong-signature": "VBA_SIGNATURE_CONTENT_TYPE_MISMATCH",
            "duplicate-signature": "DUPLICATE_OR_INVALID_CONTENT_TYPE_OVERRIDE",
        }
        for content_types, expected in cases.items():
            with self.subTest(content_types=content_types):
                self._assert_refused(vba=True, signature=True,
                                     relationship="linked", content_types=content_types,
                                     expected=expected)

    def test_xxe_content_types_are_refused(self):
        with tempfile.TemporaryDirectory(prefix="furusato_fake_release_") as root:
            folder = Path(root)
            package = _candidate(folder, True, True, "linked", content_types="xml-entity")
            rc, output = _run_probe(folder, package)
            self.assertNotEqual(rc, 0)
            self.assertFalse((folder / "must_not_be_created.json").exists())
            self.assertNotIn(
                "SIGNATURE_AND_ARCHIVE_HASH_VERIFIED_MANUAL_RELEASE_APPROVAL_REQUIRED",
                output)

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
