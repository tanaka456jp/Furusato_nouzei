import copy
import tempfile
import unittest
from pathlib import Path
import json
import os
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo

from publish_excel_release import (
    PublisherApproval, apply_private_display_and_scope,
    authenticate_private_publisher, inspect_draft_assets, publish,
    release_body, publication_blockers, require_publication_clearance,
)
from record_ci_acceptance import digest_file
from release_readiness import (
    BRANCH, PC1, RELEASE_JOBS, RELEASE_ZIP, REPOSITORY, VERSION, EXCEL_RELEASE_STEPS,
    validate_github, validate_runner,
)
from verify_excel_release_candidate import verify_distribution

HEAD = "a" * 40
BOOK = "b" * 64
RUN_ID = 10


def runner_records():
    compile_report = {
        "schema": "furusato-vbe-compile/v1", "command_id": 578, "command_enabled_after": False,
        "workbook_sha256": BOOK, "status": "VBE_COMPILE_EXECUTED",
    }
    update = {
        "schema": "furusato-vbaupdater-readonly/v1", "original_preserved": True,
        "original_workbook_sha256": BOOK.upper(), "status": "READONLY_PREFLIGHT_DIFF_PASS",
    }
    return [
        {"schema": "furusato-excel-runner/v1", "head_sha": HEAD, "name": PC1,
         "environment": "self-hosted", "workbook_sha256": BOOK},
        {"schema": "furusato-excel-acceptance/v1", "status": "PASS", "excel_version": "16.0",
         "workbook_sha256": BOOK},
        compile_report.copy(), compile_report.copy(),
        {"schema": "furusato-excel-display-acceptance/v2", "source_head": HEAD,
         "workbook_sha256": BOOK, "status": "PASS", "image_count": 4,
         "verified_modes": ["1920x1080@125"], "unverified_modes": ["1920x1080@100", "1366x768@150"],
         "checks": ["command_bounds", "command_captions", "no_command_overlap", "focus_and_scroll",
                    "visible_content_bounds", "rendered_worksheet"]},
        {"schema": "furusato-excel-pdf-acceptance/v2", "source_head": HEAD,
         "revision": VERSION, "workbook_sha256": BOOK, "status": "PASS", "page_count": 5,
         "physical_printer_tested": False},
        update,
        {**update, "status": "STAGED_PUSH_EXCEL_PASS", "synthetic_source_verified": True,
         "synthetic_source_delta": "MARKER_COMMENT_IN_STAGE_ONLY", "project_push": "PASS",
         "post_push_diff": "PASS", "post_push_excel": "PASS"},
        {"actualExcelCOM": True, "matched": 41, "mismatchCount": 0, "workbookSha256": BOOK,
         "levyComparisonBasis": "POOLED_BEFORE_MUNICIPAL_SPLIT",
         "calculationStateVerdict": "DONE_41_OF_41"},
        {"schema": "furusato-local-vba-signing/v2", "head_sha": HEAD,
         "signing_state": "UNSIGNED", "source_workbook_sha256": BOOK,
         "signed_workbook_sha256": None, "availability": "SIGNING_NOT_CONFIGURED"},
    ]


class ReleaseAutomationTest(unittest.TestCase):
    def test_live_all_five_jobs_and_no_wrong_sha_or_pc(self):
        run = {
            "id": RUN_ID, "run_attempt": 1, "head_sha": HEAD, "head_branch": BRANCH,
            "event": "workflow_dispatch",
            "path": ".github/workflows/workbook.yml", "status": "completed", "conclusion": "success",
            "repository": {"full_name": REPOSITORY}, "head_repository": {"full_name": REPOSITORY},
            "actor": {"type": "User", "login": "operator"},
            "triggering_actor": {"type": "User", "login": "operator"},
            "pull_requests": [{"number": 5,
                               "head": {"ref": BRANCH, "repo": {"name": "Furusato_nouzei"}}}],
        }
        jobs = [
            {"name": name, "run_id": RUN_ID, "run_attempt": 1, "head_sha": HEAD, "conclusion": "success"}
            for name in RELEASE_JOBS
        ]
        excel = next(job for job in jobs if job["name"] == "excel")
        excel.update(
            runner_name=PC1, labels=["Windows", "furusato-excel", "self-hosted"],
            steps=[{"name": name, "status": "completed", "conclusion": "success"}
                   for name in EXCEL_RELEASE_STEPS])
        self.assertEqual(len(validate_github(run, jobs, HEAD, RUN_ID)), 5)
        with self.assertRaisesRegex(ValueError, "MANUAL_DISPATCH"):
            validate_github({**run, "event": "pull_request"}, jobs, HEAD, RUN_ID)
        with self.assertRaisesRegex(ValueError, "MANUAL_OPERATOR_IDENTITY"):
            validate_github({**run, "actor": {"type": "Bot", "login": "bot"}},
                            jobs, HEAD, RUN_ID)
        missing_gate = copy.deepcopy(jobs)
        gate = next(x for x in missing_gate if x["name"] == "excel")
        gate["steps"] = [s for s in gate["steps"]
                         if s["name"] != "Apex One operator confirmation gate (reader EXE not started)"]
        with self.assertRaisesRegex(ValueError, "MANDATORY_STEP"):
            validate_github(run, missing_gate, HEAD, RUN_ID)
        skipped_gate = copy.deepcopy(jobs)
        gate = next(x for x in skipped_gate if x["name"] == "excel")
        next(s for s in gate["steps"]
             if s["name"] == "Apex One operator confirmation gate (reader EXE not started)")["conclusion"] = "skipped"
        with self.assertRaisesRegex(ValueError, "MANDATORY_STEP"):
            validate_github(run, skipped_gate, HEAD, RUN_ID)
        missing_readiness = copy.deepcopy(jobs)
        gate = next(x for x in missing_readiness if x["name"] == "excel")
        next(s for s in gate["steps"] if s["name"].startswith("Notify PC1 operator"))["conclusion"] = "skipped"
        with self.assertRaisesRegex(ValueError, "MANDATORY_STEP"):
            validate_github(run, missing_readiness, HEAD, RUN_ID)
        for mutation in ("failure", "cancelled", "skipped"):
            bad = copy.deepcopy(jobs)
            bad[-1]["conclusion"] = mutation
            with self.assertRaisesRegex(ValueError, "FIVE_JOBS"):
                validate_github(run, bad, HEAD, RUN_ID)
        with self.assertRaisesRegex(ValueError, "FIVE_JOBS"):
            validate_github(run, jobs[:-1], HEAD, RUN_ID)
        with self.assertRaisesRegex(ValueError, "EXACT_HEAD"):
            validate_github({**run, "head_sha": "c" * 40}, jobs, HEAD, RUN_ID)
        excel["runner_name"] = "PC2"
        with self.assertRaisesRegex(ValueError, "NOT_ON_PC1"):
            validate_github(run, jobs, HEAD, RUN_ID)

    def test_real_runner_records_and_fail_closed(self):
        records = runner_records()
        self.assertEqual(validate_runner(HEAD, BOOK, *records)["signing_state"], "UNSIGNED")
        for position, key, replacement, code in (
            (0, "name", "hosted Windows", "RUNNER_NOT_PC1"),
            (1, "workbook_sha256", "c" * 64, "FUNCTIONAL_TESTS_INCOMPLETE"),
            (2, "command_enabled_after", True, "VBE_COMPILE_INCOMPLETE"),
            (4, "verified_modes", ["1920x1080@100"], "DISPLAY_SCOPE_INCOMPLETE"),
            (5, "source_head", "d" * 40, "PDF_INCOMPLETE"),
            (6, "original_preserved", False, "PREFLIGHT_INCOMPLETE"),
            (7, "post_push_excel", "SKIP", "STAGED_UPDATE_INCOMPLETE"),
            (8, "matched", 40, "PARITY_INCOMPLETE"),
            (9, "availability", "SIGNING_VALIDATION_FAILED", "FALLBACK_NOT_JUSTIFIED"),
        ):
            with self.subTest(code=code):
                invalid = copy.deepcopy(records)
                invalid[position][key] = replacement
                with self.assertRaisesRegex(ValueError, code):
                    validate_runner(HEAD, BOOK, *invalid)

    def test_signed_route_has_distinct_original_and_verified_timestamp(self):
        records = runner_records()
        signed = records[-1]
        source = "d" * 64
        signed.update(
            signing_state="SIGNED", availability="AVAILABLE", source_workbook_sha256=source,
            signed_workbook_sha256=BOOK, accepted_vba_project_sha256="c" * 64,
            signed_vba_project_sha256="c" * 64, office_vba_signed_property="OFFICE_RECOGNIZED_SIGNED_PROJECT",
            signing_certificate_eku="CODE_SIGNING", test_only=False, signtool_verified=True,
            certificate_thumbprint_matched=True, certificate_chain_verified=True, timestamp_verified=True,
        )
        records[2]["workbook_sha256"] = source
        self.assertEqual(validate_runner(HEAD, BOOK, *records)["signing_state"], "SIGNED")
        signed["timestamp_verified"] = False
        with self.assertRaisesRegex(ValueError, "SIGNING_EVIDENCE_INVALID"):
            validate_runner(HEAD, BOOK, *records)

    def test_zip_refuses_paths_and_links_before_parsing_payload(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "candidate.zip"
            valid_paths = ["Furusato_nouzei.xlsm", "FurusatoDocumentReader.exe", "README.txt"]
            with ZipFile(archive, "w") as zipped:
                for name in ("../../pfx", *valid_paths[1:]):
                    zipped.writestr(name, "synthetic")
            with self.assertRaisesRegex(ValueError, "UNSAFE_DISTRIBUTION_ZIP_ENTRIES"):
                verify_distribution(archive, HEAD, VERSION, BOOK, "f" * 64, "UNSIGNED", runner_records()[-1])
            with ZipFile(archive, "w") as zipped:
                for name in valid_paths:
                    member = ZipInfo(name)
                    if name == "README.txt":
                        member.create_system = 3
                        member.external_attr = 0o120777 << 16
                    zipped.writestr(member, "synthetic")
            with self.assertRaisesRegex(ValueError, "UNSAFE_DISTRIBUTION_ZIP_ENTRIES"):
                verify_distribution(archive, HEAD, VERSION, BOOK, "f" * 64, "UNSIGNED", runner_records()[-1])

    def test_refuse_distinct_github_asset_digest(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            for name in (RELEASE_ZIP, "SHA256SUMS.txt", "THIRD_PARTY_NOTICES.txt"):
                (folder / name).write_text("synthetic")
            report = {
                "head_sha": HEAD,
                "archive_sha256": digest_file(folder / RELEASE_ZIP),
                "third_party_notices_sha256": digest_file(folder / "THIRD_PARTY_NOTICES.txt"),
            }
            (folder / "SHA256SUMS.txt").write_text(
                f'{report["archive_sha256"]}  {RELEASE_ZIP}\n'
                f'{report["third_party_notices_sha256"]}  THIRD_PARTY_NOTICES.txt\n')
            draft = {
                "tag_name": VERSION, "draft": True, "target_commitish": HEAD,
                "assets": [{"name": item.name, "state": "uploaded", "size": item.stat().st_size,
                            "digest": "sha256:" + digest_file(item)} for item in folder.iterdir()],
            }
            self.assertEqual(len(inspect_draft_assets(draft, folder, report)), 3)
            draft["assets"][0]["digest"] = "sha256:" + "f" * 64
            with self.assertRaisesRegex(ValueError, "ASSET_SHA256_MISMATCH"):
                inspect_draft_assets(draft, folder, report)
            # Even a draft containing matching new bytes must not be published
            # if those bytes changed after the operator approved the old ZIP.
            (folder / RELEASE_ZIP).write_text("tampered after consent")
            for asset in draft["assets"]:
                if asset["name"] == RELEASE_ZIP:
                    asset["size"] = (folder / RELEASE_ZIP).stat().st_size
                    asset["digest"] = "sha256:" + digest_file(folder / RELEASE_ZIP)
            with self.assertRaisesRegex(ValueError, "APPROVED_ASSET_SNAPSHOT_CHANGED"):
                inspect_draft_assets(draft, folder, report)

    def test_unsigned_exact_run_cannot_resume_or_publish_existing_draft(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            for name in (RELEASE_ZIP, "SHA256SUMS.txt", "THIRD_PARTY_NOTICES.txt"):
                (folder / name).write_bytes(b"synthetic")
            report = {"head_sha": HEAD, "signing_state": "UNSIGNED", "archive_sha256": BOOK,
                      "github_run_url": "https://example.test/run"}
            draft = {
                "id": 1, "tag_name": VERSION, "draft": True, "target_commitish": HEAD,
                "body": release_body(report).replace("\n", "\r\n"),
                "assets": [{"name": item.name, "state": "uploaded", "size": item.stat().st_size,
                            "digest": "sha256:" + digest_file(item)} for item in folder.iterdir()],
            }
            tag = {"ref": f"refs/tags/{VERSION}", "object": {"type": "commit", "sha": HEAD}}
            published = {**draft, "draft": False, "prerelease": False, "html_url": "https://example.test/release"}
            with patch("publish_excel_release.approved_head") as approved, \
                 patch("publish_excel_release.release_for_version") as get_release, \
                 patch("publish_excel_release.api") as api, \
                 patch("publish_excel_release.gh") as gh:
                with self.assertRaisesRegex(ValueError, "PUBLICATION_HOLD"):
                    publish(folder, report)
                approved.assert_not_called()
                get_release.assert_not_called()
                api.assert_not_called()
                gh.assert_not_called()

    def test_no_ci_result_can_replace_independent_release_approval(self):
        report = {
            "release_decision": "HOLD",
            "signing_state": "UNSIGNED",
            "reader_authenticode": "UNSIGNED",
            "unverified_display_modes": ["1920x1080@100", "1366x768@150"],
            "physical_printer_tested": False,
            "tax_evidence_scope": "SYNTHETIC_2025_2026",
        }
        blockers = publication_blockers(report)
        self.assertGreaterEqual(len(blockers), 2)
        self.assertNotIn('VBA_TRUSTED_SIGNATURE_NOT_VERIFIED', blockers)
        self.assertNotIn('READER_AUTHENTICODE_NOT_VERIFIED', blockers)
        self.assertIn("EXPLICIT_FINAL_RELEASE_APPROVAL_MISSING", blockers)
        self.assertNotIn("PHYSICAL_PAPER_NOT_VERIFIED", blockers)
        self.assertNotIn("INDEPENDENT_TAX_REVIEW_NOT_APPROVED", blockers)
        with self.assertRaisesRegex(ValueError, "PUBLICATION_HOLD"):
            require_publication_clearance(report)

        independently_reviewed = dict(
            report, signing_state="UNSIGNED",
            reader_authenticode="UNSIGNED",
            unverified_display_modes=[], physical_printer_tested=True,
            tax_evidence_scope="SYNTHETIC_2025_2026",
            manual_final_approval="PRIVATE_EXPLICIT_APPROVAL",
        )
        independently_reviewed.update(
            candidate_verified=True, required_jobs={job: "success" for job in RELEASE_JOBS},
            private_display_acceptance="PASS_TWO_MODES_SAME_HEAD_AND_BOOK",
            private_manifest_v6_checked=True, head_sha=HEAD, archive_sha256=BOOK)
        approval = PublisherApproval(VERSION, HEAD, BOOK, "publisher", "admin")
        self.assertEqual(publication_blockers(independently_reviewed, approval), [])
        self.assertIn("EXPLICIT_FINAL_RELEASE_APPROVAL_MISSING",
                      publication_blockers(independently_reviewed))
        independently_reviewed["tax_evidence_scope"] = "INDEPENDENT_2025_2026_REVIEW_APPROVED"
        self.assertIn("AUTOMATED_2025_2026_TAX_ACCEPTANCE_MISSING",
                      publication_blockers(independently_reviewed))
        independently_reviewed["tax_evidence_scope"] = "SYNTHETIC_2025_2026"
        independently_reviewed["manual_final_approval"] = "CI_SUCCESS"
        self.assertIn("EXPLICIT_FINAL_RELEASE_APPROVAL_MISSING",
                      publication_blockers(independently_reviewed))


    def test_even_forged_all_positive_flags_cannot_publish_ci_candidate(self):
        # CI candidate ZIP was generated with an unsigned EXE. Independent
        # metadata string edits cannot transform it into an accepted signed ZIP.
        forged = {
            "release_decision": "READY",
            "head_sha": HEAD,
            "signing_state": "SIGNED",
            "reader_authenticode": "VALID_TRUSTED_EXPECTED_SIGNER",
            "unverified_display_modes": [],
            "physical_printer_tested": True,
            "tax_evidence_scope": "SYNTHETIC_2025_2026",
            "manual_final_approval": "PRIVATE_EXPLICIT_APPROVAL",
        }
        self.assertIn('EXPLICIT_FINAL_RELEASE_APPROVAL_MISSING', publication_blockers(forged))
        with tempfile.TemporaryDirectory() as temp, \
             patch("publish_excel_release.approved_head") as approved, \
             patch("publish_excel_release.release_for_version") as get_release, \
             patch("publish_excel_release.api") as api, \
             patch("publish_excel_release.gh") as gh:
            with self.assertRaisesRegex(ValueError,
                                        "PUBLICATION_HOLD:EXACT_HEAD_FIVE_JOB_CANDIDATE_NOT_VERIFIED"):
                publish(Path(temp), forged)
            approved.assert_not_called()
            get_release.assert_not_called()
            api.assert_not_called()
            gh.assert_not_called()
            self.assertEqual(list(Path(temp).iterdir()), [])

    def test_local_publisher_authentication_rejects_ci_and_wrong_consent(self):
        report = {"head_sha": HEAD, "archive_sha256": BOOK}
        with patch("publish_excel_release.local_interactive", return_value=False), \
             patch("publish_excel_release.gh") as gh:
            with self.assertRaisesRegex(ValueError, "INTERACTIVE_LOCAL_PUBLISHER_REQUIRED"):
                authenticate_private_publisher(report)
            gh.assert_not_called()
        with patch.dict(os.environ, {"CI": "", "GITHUB_ACTIONS": ""}), \
             patch("publish_excel_release.local_interactive", return_value=True), \
             patch("publish_excel_release.gh", return_value=json.dumps({"login": "publisher"})), \
             patch("publish_excel_release.api", return_value={"permission": "maintain"}):
            answers = iter((VERSION, HEAD, BOOK, "PUBLISH " + VERSION))
            approved = authenticate_private_publisher(report, prompt=lambda _: next(answers))
            self.assertEqual(approved, PublisherApproval(VERSION, HEAD, BOOK,
                                                         "publisher", "maintain"))
            incorrect = iter((VERSION, HEAD, "0" * 64))
            with self.assertRaisesRegex(ValueError, "EXACT_RELEASE_CONFIRMATION_MISMATCH"):
                authenticate_private_publisher(report, prompt=lambda _: next(incorrect))
        with patch.dict(os.environ, {"CI": "", "GITHUB_ACTIONS": ""}), \
             patch("publish_excel_release.local_interactive", return_value=True), \
             patch("publish_excel_release.gh", return_value=json.dumps({"login": "publisher"})), \
             patch("publish_excel_release.api", return_value={"permission": "read"}):
            with self.assertRaisesRegex(ValueError, "MAINTAIN_PERMISSION_REQUIRED"):
                authenticate_private_publisher(report, prompt=lambda _: "unused")

    def test_private_display_receipts_reject_wrong_schema_or_ci_identity(self):
        from release_readiness import REQUIRED, REVIEWER_ROLES, SCHEMA
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            candidate_dir = out / "candidate"
            folder100 = out / "screen100"
            folder150 = out / "screen150"
            for folder in (candidate_dir, folder100, folder150):
                folder.mkdir()
            (candidate_dir / "candidate.json").write_text('{"synthetic":"ci"}')
            (candidate_dir / RELEASE_ZIP).write_bytes(b"synthetic-release-zip")
            (folder100 / "display_review.json").write_text('{"synthetic":"100"}')
            (folder150 / "display_review.json").write_text('{"synthetic":"150"}')
            actual = {
                "ci_exact_commit": digest_file(candidate_dir / "candidate.json"),
                "screen_1920x1080_100pct": digest_file(folder100 / "display_review.json"),
                "screen_1920x1080_125pct": digest_file(candidate_dir / "candidate.json"),
                "screen_1366x768_150pct": digest_file(folder150 / "display_review.json"),
                "distribution_integrity_and_sha256": digest_file(candidate_dir / RELEASE_ZIP),
            }
            checks = {key: {"status": "REVIEWED", "sha256": actual[key],
                            "reviewer_role": REVIEWER_ROLES[key][0], "head_sha": HEAD}
                      for key in REQUIRED}
            manifest = {"schema": SCHEMA, "head_sha": HEAD, "checks": checks}
            accepted = {"status": "PASS",
                        "verified_modes": ["1920x1080@100", "1366x768@150"],
                        "image_count": 8}
            def original():
                return {"candidate_verified": True,
                        "display_modes": ["1920x1080@125"],
                        "unverified_display_modes": ["1920x1080@100", "1366x768@150"],
                        "head_sha": HEAD, "workbook_sha256": BOOK,
                        "archive_sha256": actual["distribution_integrity_and_sha256"]}
            with patch("publish_excel_release.inspect_display_matrix",
                       return_value=accepted) as verify:
                report = original()
                apply_private_display_and_scope(
                    report, folder100, folder150, manifest, candidate_dir)
                verify.assert_called_once_with(
                    [folder100, folder150], BOOK, HEAD,
                    modes=("1920x1080@100", "1366x768@150"))
                self.assertEqual(report["unverified_display_modes"], [])
                self.assertTrue(report["private_manifest_v6_checked"])
                bad = original()
                bad["unverified_display_modes"] = ["1920x1080@100"]
                with self.assertRaisesRegex(ValueError, "UNMODIFIED_EXACT_CI_CANDIDATE"):
                    apply_private_display_and_scope(
                        bad, folder100, folder150, manifest, candidate_dir)
                manifest["schema"] = "furusato-release-readiness/v5"
                with self.assertRaisesRegex(ValueError, "PRIVATE_V6_SCOPE_MANIFEST_INCOMPLETE"):
                    apply_private_display_and_scope(
                        original(), folder100, folder150, manifest, candidate_dir)
                manifest["schema"] = SCHEMA
                checks["screen_1920x1080_100pct"]["sha256"] = "f" * 64
                with self.assertRaisesRegex(ValueError, "MANIFEST_HASH_NOT_BOUND"):
                    apply_private_display_and_scope(
                        original(), folder100, folder150, manifest, candidate_dir)
                checks["screen_1920x1080_100pct"]["sha256"] = actual["screen_1920x1080_100pct"]
                forged = original()
                forged["archive_sha256"] = "c" * 64
                with self.assertRaisesRegex(ValueError, "DISTRIBUTION_NOT_SAME_ACCEPTED_ZIP"):
                    apply_private_display_and_scope(
                        forged, folder100, folder150, manifest, candidate_dir)
                (folder150 / "display_review.json").write_text('{"tampered":true}')
                with self.assertRaisesRegex(ValueError, "MANIFEST_HASH_NOT_BOUND"):
                    apply_private_display_and_scope(
                        original(), folder100, folder150, manifest, candidate_dir)


if __name__ == "__main__":
    unittest.main(verbosity=2)
