"""Only invented fixtures: candidate checks never approve a release."""
import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
from openpyxl import Workbook
from make_excel_release_readme import render

from release_readiness import PRODUCT_SCOPE, REQUIRED, REVIEWER_ROLES, SCHEMA
from verify_excel_release_candidate import verify, sha256

HEAD = "a" * 40
RUN = 44043000554
VERSION = "v4.18.35"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def workbook_bytes(label="ふるさと納税 寄附限度額試算    " + VERSION):
    book = Workbook()
    book.active.title = "操作画面"
    book.active["A1"] = label
    mortgage = book.create_sheet("住宅確申寄附検算")
    mortgage["A1"] = "確定申告・住宅ローン控除併用：寄附額別の実税負担差分"
    stream = BytesIO()
    book.save(stream)
    book.close()
    return stream.getvalue()


class ExcelPrepublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.archive = Path(self.tmp.name) / "synthetic-signed-candidate.zip"
        self.reader = b"synthetic-reader-byte-fixture" * 64
        self.book_bytes = workbook_bytes()
        self.readme = render(VERSION, HEAD)
        with ZipFile(self.archive, "w") as zipfile:
            zipfile.writestr("Furusato_nouzei.xlsm", self.book_bytes)
            zipfile.writestr("FurusatoDocumentReader.exe", self.reader)
            zipfile.writestr("README.txt", self.readme)
        self.manifest = {
            "schema": SCHEMA, "head_sha": HEAD, "checks": {
                key: {"status": "REVIEWED", "sha256": "f" * 64,
                      "reviewer_role": REVIEWER_ROLES[key][0], "head_sha": HEAD}
                for key in REQUIRED
            },
        }
        self.ci = {
            "schema": "furusato-ci-acceptance/v1", "head_sha": HEAD,
            "run_id": RUN, "ci_exact_head_gate": "PASS", "review_only": True,
            "release_decision": "HOLD",
            "prerequisite_jobs": {key: "success" for key in
                                  ("static", "windows_compat", "excel", "document_reader")},
            "review_zip_sha256": "b" * 64,
            "accepted_workbook_sha256": "c" * 64,
            "reader_sha256": "d" * 64,
            "review_readme_sha256": "e" * 64,
        }
        self.signature = {
            "schema": "furusato-signed-distribution-local/v1",
            "archive_sha256": sha256(self.archive),
            "reader_exe_sha256": digest(self.reader),
            "authenticode": "VALID_TRUSTED_EXPECTED_SIGNER",
            "certificate_thumbprint_verified": True,
            "macro_workbook_signature":
                "CONTAINER_DETECTED_CRYPTOGRAPHIC_VALIDITY_NOT_VERIFIED",
            "office_vba_signed_property": "OFFICE_RECOGNIZED_SIGNED_PROJECT",
            "macro_signature_office_validation": "REQUIRED_BEFORE_RELEASE",
            "exact_release_members": "THREE_EXPECTED_FILES_ONLY",
            "manual_publisher_approval": "REQUIRED",
            "release_decision": "HOLD",
        }

    def run_check(self, **overrides):
        x = dict(head=HEAD, run_id=RUN, version=VERSION,
                 archive=self.archive, expected_hash=sha256(self.archive),
                 ci=self.ci, manifest=self.manifest, signature=self.signature)
        x.update(overrides)
        return verify(**x)

    def test_preprint_only_eight_gates_pass_and_paper_stays_pending(self):
        manifest = copy.deepcopy(self.manifest)
        del manifest["checks"]["physical_printer_preview_and_output"]
        with self.assertRaisesRegex(ValueError, "EXCEL_PRIVATE_REVIEWS_INCOMPLETE"):
            self.run_check(manifest=manifest)
        receipt = self.run_check(manifest=manifest, preprint_only=True)
        self.assertEqual(receipt["candidate_gate"],
                         "EIGHT_NONPHYSICAL_GATES_RECORDED_PREPRINT_HOLD")
        self.assertEqual(receipt["physical_paper_gate"], "PENDING")
        self.assertEqual(receipt["private_review_records"], 8)
        self.assertEqual(receipt["release_decision"], "HOLD")

        # Preprint is not a generic override. All other gates are still required.
        del manifest["checks"]["signed_distribution_and_sha256"]
        with self.assertRaisesRegex(ValueError, "PREPRINT_REQUIRES_ALL_EIGHT"):
            self.run_check(manifest=manifest, preprint_only=True)
        manifest = copy.deepcopy(self.manifest)
        manifest["checks"]["physical_printer_preview_and_output"]["status"] = "INVALID"
        with self.assertRaisesRegex(ValueError, "PREPRINT_REQUIRES_ALL_EIGHT"):
            self.run_check(manifest=manifest, preprint_only=True)
        with self.assertRaisesRegex(ValueError, "PREPRINT_REQUIRES_ALL_EIGHT"):
            self.run_check(preprint_only=True)

    def test_all_claims_still_hold_and_web_is_separate(self):
        result = self.run_check()
        self.assertEqual(result["candidate_gate"], "METADATA_AND_ARCHIVE_CHECKED")
        self.assertEqual(result["release_decision"], "HOLD")
        self.assertEqual(result["product_scope"], PRODUCT_SCOPE)
        self.assertEqual(result["private_review_records"], 9)
        self.assertIn("REQUIRES_HUMAN", result["source_lineage_after_signing"])
        self.assertEqual(result["office_vba_signed_property"],
                         "OFFICE_RECOGNIZED_SIGNED_PROJECT")

    def test_mismatched_or_tampered_candidate_refused(self):
        with self.assertRaisesRegex(ValueError, "SHA256_MISMATCH"):
            self.run_check(expected_hash="0" * 63 + "1")
        accepted_hash = sha256(self.archive)
        with self.archive.open("ab") as out:
            out.write(b"tamper")
        with self.assertRaisesRegex(ValueError, "SHA256_MISMATCH"):
            self.run_check(expected_hash=accepted_hash)

    def test_review_source_cannot_be_forged(self):
        for change in ({"head_sha": "b" * 40}, {"run_id": RUN + 1},
                       {"review_only": False}, {"release_decision": "APPROVED"},
                       {"prerequisite_jobs": {"static": "success"}}):
            with self.subTest(change=change):
                ci = dict(self.ci, **change)
                with self.assertRaisesRegex(ValueError, "CI_EXACT_SOURCE"):
                    self.run_check(ci=ci)

    def test_gas_only_or_stale_manifest_cannot_pass(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["checks"].pop("mortgage_filing_independent_tax_difference")
        with self.assertRaisesRegex(ValueError, "REVIEWS_INCOMPLETE"):
            self.run_check(manifest=manifest)
        manifest = copy.deepcopy(self.manifest)
        manifest["schema"] = "furusato-release-readiness/v3"
        with self.assertRaisesRegex(ValueError, "SCOPE_MANIFEST"):
            self.run_check(manifest=manifest)

    def test_missing_trusted_signature_refused(self):
        for field, value in (("authenticode", "NotSigned"),
                             ("archive_sha256", "f" * 64),
                             ("reader_exe_sha256", "f" * 64),
                             ("macro_signature_office_validation", "PASS"),
                             ("office_vba_signed_property", "UNVERIFIED"),
                             ("release_decision", "APPROVED")):
            with self.subTest(field=field):
                evidence = dict(self.signature, **{field: value})
                with self.assertRaisesRegex(ValueError, "SIGNED_ARCHIVE"):
                    self.run_check(signature=evidence)

    def test_mismatched_readme_source_head_refused(self):
        with ZipFile(self.archive, "w") as z:
            z.writestr("Furusato_nouzei.xlsm", self.book_bytes)
            z.writestr("FurusatoDocumentReader.exe", self.reader)
            z.writestr("README.txt", render(VERSION, "b" * 40))
        signature = dict(self.signature, archive_sha256=sha256(self.archive))
        with self.assertRaisesRegex(ValueError, "RELEASE_README_HEAD_MISMATCH"):
            self.run_check(signature=signature)

    def test_workbook_brand_and_readme_are_bound_to_official_version(self):
        with self.assertRaisesRegex(ValueError, "INVALID_NEXT_RELEASE_VERSION"):
            self.run_check(version="v4.18.2")
        for title in ("ふるさと納税 寄附限度額試算    v4.18.34",
                      "ふるさと納税 寄附限度額試算    v4.18.35 検証版"):
            with self.subTest(title=title):
                with ZipFile(self.archive, "w") as z:
                    z.writestr("Furusato_nouzei.xlsm", workbook_bytes(title))
                    z.writestr("FurusatoDocumentReader.exe", self.reader)
                    z.writestr("README.txt", self.readme)
                signature = dict(self.signature, archive_sha256=sha256(self.archive))
                with self.assertRaisesRegex(ValueError, "BRANDING_INVALID"):
                    self.run_check(signature=signature)

    def test_old_edition_and_review_marker_refused(self):
        with self.assertRaisesRegex(ValueError, "INVALID_NEXT_RELEASE_VERSION"):
            self.run_check(version="v4.18.2")
        with ZipFile(self.archive, "w") as z:
            z.writestr("Furusato_nouzei.xlsm", self.book_bytes)
            z.writestr("FurusatoDocumentReader.exe", self.reader)
            z.writestr("README.txt", "正式配布HOLD " + VERSION)
        signature = dict(self.signature, archive_sha256=sha256(self.archive))
        with self.assertRaisesRegex(ValueError, "REVIEW_OR_WRONG_VERSION_README"):
            self.run_check(signature=signature)


if __name__ == "__main__":
    unittest.main(verbosity=2)
