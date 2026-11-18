import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo

from publish_excel_release import inspect_draft_assets, publish, release_body
from record_ci_acceptance import digest_file
from release_readiness import (
    BRANCH, PC1, RELEASE_JOBS, RELEASE_ZIP, REPOSITORY, VERSION,
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
            "id": RUN_ID, "run_attempt": 1, "head_sha": HEAD, "head_branch": BRANCH, "event": "pull_request",
            "path": ".github/workflows/workbook.yml", "status": "completed", "conclusion": "success",
            "repository": {"full_name": REPOSITORY}, "head_repository": {"full_name": REPOSITORY},
            "pull_requests": [{"number": 5, "head": {"sha": HEAD}}],
        }
        jobs = [
            {"name": name, "run_id": RUN_ID, "run_attempt": 1, "head_sha": HEAD, "conclusion": "success"}
            for name in RELEASE_JOBS
        ]
        excel = next(job for job in jobs if job["name"] == "excel")
        excel.update(runner_name=PC1, labels=["Windows", "furusato-excel", "self-hosted"])
        self.assertEqual(len(validate_github(run, jobs, HEAD, RUN_ID)), 5)
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
            draft = {
                "tag_name": VERSION, "draft": True, "target_commitish": HEAD,
                "assets": [{"name": item.name, "state": "uploaded", "size": item.stat().st_size,
                            "digest": "sha256:" + digest_file(item)} for item in folder.iterdir()],
            }
            self.assertEqual(len(inspect_draft_assets(draft, folder, {"head_sha": HEAD})), 3)
            draft["assets"][0]["digest"] = "sha256:" + "f" * 64
            with self.assertRaisesRegex(ValueError, "ASSET_SHA256_MISMATCH"):
                inspect_draft_assets(draft, folder, {"head_sha": HEAD})

    def test_resume_verified_windows_draft_at_existing_exact_tag(self):
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
            with patch("publish_excel_release.approved_head"), \
                 patch("publish_excel_release.release_for_version", return_value=draft), \
                 patch("publish_excel_release.api", side_effect=[[tag], [tag], published, tag]) as api:
                self.assertEqual(publish(folder, report), published["html_url"])
                self.assertEqual([call.args[0] for call in api.call_args_list], [
                    f"git/matching-refs/tags/{VERSION}", f"git/matching-refs/tags/{VERSION}",
                    "releases/1", f"git/ref/tags/{VERSION}"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
