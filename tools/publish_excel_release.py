"""Verify exact-HEAD GitHub Actions evidence; publish only an accepted Excel ZIP."""

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from collect_reader_notices import NOTICE_LIMIT, NOTICE_NAME
from record_ci_acceptance import digest_file
from release_readiness import (
    BRANCH, RELEASE_ARTIFACT, RELEASE_PR, RELEASE_ZIP, REPOSITORY, VERSION,
    REQUIRED, SCHEMA, evaluate, read_evidence, require,
    validate_candidate_report, validate_github, valid_sha,
)
from verify_excel_release_candidate import verify_distribution
from verify_release_display_matrix import inspect_display_matrix

SUMS = "SHA256SUMS.txt"


@dataclass(frozen=True)
class PublisherApproval:
    """Local, in-process approval. No identity or confirmation is uploaded to CI."""
    version: str
    head_sha: str
    archive_sha256: str
    login: str
    permission: str


def local_interactive():
    return sys.stdin.isatty() and sys.stdout.isatty()


def apply_private_display_and_scope(report, folder_100, folder_150, manifest):
    """Accept two observed local modes for the exact previously accepted CI XLSM."""
    require(report.get("candidate_verified") is True
            and report.get("display_modes") == ["1920x1080@125"]
            and report.get("unverified_display_modes") ==
                ["1920x1080@100", "1366x768@150"],
            "PRIVATE_DISPLAY_REQUIRES_UNMODIFIED_EXACT_CI_CANDIDATE")
    assessment = evaluate(report["head_sha"], manifest)
    require(assessment["schema"] == SCHEMA and not assessment["blockers"]
            and set(assessment["checks"]) == set(REQUIRED)
            and assessment["review_stage"] == "FINAL_RELEASE_AUTHORIZATION_REQUIRED",
            "PRIVATE_V6_SCOPE_MANIFEST_INCOMPLETE")
    summary = inspect_display_matrix(
        [folder_100, folder_150], report["workbook_sha256"], report["head_sha"],
        modes=("1920x1080@100", "1366x768@150"))
    require(summary["status"] == "PASS"
            and summary["verified_modes"] == ["1920x1080@100", "1366x768@150"]
            and summary["image_count"] == 8,
            "PRIVATE_TWO_DISPLAY_MODES_INCOMPLETE")
    report["unverified_display_modes"] = []
    report["private_display_acceptance"] = "PASS_TWO_MODES_SAME_HEAD_AND_BOOK"
    report["private_manifest_v6_checked"] = True
    return summary


def authenticate_private_publisher(report, prompt=None):
    """Require interactive, authenticated GitHub maintain/admin and full-byte consent."""
    require(not os.environ.get("CI") and not os.environ.get("GITHUB_ACTIONS")
            and local_interactive(), "PUBLICATION_HOLD:INTERACTIVE_LOCAL_PUBLISHER_REQUIRED")
    username = json.loads(gh("api", "user")).get("login")
    require(isinstance(username, str) and username
            and all(c.isascii() and (c.isalnum() or c == "-") for c in username),
            "PUBLICATION_HOLD:AUTHENTICATED_GITHUB_USER_MISSING")
    permission = api(f"collaborators/{username}/permission").get("permission")
    require(permission in ("admin", "maintain"),
            "PUBLICATION_HOLD:GITHUB_PUBLISHER_MAINTAIN_PERMISSION_REQUIRED")
    ask = input if prompt is None else prompt
    print(f"LOCAL_PUBLISHER_CONFIRMATION: {VERSION} HEAD={report['head_sha']} "
          f"ZIP_SHA256={report['archive_sha256']}")
    challenges = (
        ("Version: ", VERSION),
        ("Full 40-character HEAD: ", report["head_sha"]),
        ("Full 64-character ZIP SHA-256: ", report["archive_sha256"]),
        ("Final confirmation phrase: ", "PUBLISH " + VERSION),
    )
    for label, expected in challenges:
        require(ask(label).strip() == expected,
                "PUBLICATION_HOLD:EXPLICIT_EXACT_RELEASE_CONFIRMATION_MISMATCH")
    return PublisherApproval(VERSION, report["head_sha"], report["archive_sha256"],
                             username, permission)


def gh(*arguments):
    child = subprocess.run(["gh", *map(str, arguments)], capture_output=True, check=False)
    if child.returncode:
        # No CLI stderr: local paths, account names and auth hints stay off the report.
        raise ValueError(f"GITHUB_COMMAND_FAILED:{arguments[0]}:{arguments[1]}")
    return child.stdout.decode("utf-8")


def api(path, *args):
    return json.loads(gh("api", f"repos/{REPOSITORY}/{path}", *args))


def approved_head(expected_head):
    pr = api(f"pulls/{RELEASE_PR}")
    require(pr.get("state") == "open" and pr.get("head", {}).get("sha") == expected_head
            and pr["head"].get("ref") == BRANCH and
            (pr["head"].get("repo") or {}).get("full_name") == REPOSITORY,
            "GITHUB_PR5_HEAD_CHANGED")


def pull_verified_candidate(run_id, head, out):
    require(valid_sha(head, 40) and type(run_id) is int and run_id > 0,
            "INVALID_GITHUB_ACCEPTANCE_REFERENCE")
    approved_head(head)
    run = api(f"actions/runs/{run_id}")
    attempt = run.get("run_attempt")
    require(type(attempt) is int and attempt > 0, "INVALID_GITHUB_RUN_ATTEMPT")
    jobs = api(f"actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")
    success = validate_github(run, jobs["jobs"], head, run_id)
    name = f"{RELEASE_ARTIFACT}_{run_id}-{attempt}"
    artifacts = api(f"actions/runs/{run_id}/artifacts?per_page=100")
    matches = [item for item in artifacts["artifacts"] if item.get("name") == name]
    require(len(matches) == 1 and matches[0].get("expired") is False
            and (matches[0].get("workflow_run") or {}).get("head_sha") == head,
            "GITHUB_RUN_CANDIDATE_ARTIFACT_MISSING_OR_UNBOUND")
    require(not out.exists(), "RELEASE_OUTPUT_ALREADY_EXISTS")
    gh("run", "download", run_id, "--repo", REPOSITORY, "--name", name, "--dir", out)
    require({p.name for p in out.iterdir()} == {RELEASE_ZIP, NOTICE_NAME, "candidate.json"},
            "GITHUB_RELEASE_ARTIFACT_UNEXPECTED_FILES")
    report = validate_candidate_report(read_evidence(out / "candidate.json"), head, run_id, attempt)
    payload = verify_distribution(out / RELEASE_ZIP, head, VERSION, report["workbook_sha256"],
                                  report["reader_sha256"], report["signing_state"],
                                  report["signing_evidence"])
    require(all(report.get(key) == value for key, value in payload.items()),
            "GITHUB_CANDIDATE_ASSET_HASH_MISMATCH")
    require(report.get("source_workbook_sha256") == payload["workbook_sha256"]
            if report["signing_state"] == "UNSIGNED"
            else valid_sha(report.get("source_workbook_sha256")) and
            report["source_workbook_sha256"] != payload["workbook_sha256"],
            "GITHUB_CANDIDATE_SIGNING_SOURCE_INVALID")
    notice = out / NOTICE_NAME
    require(notice.is_file() and 0 < notice.stat().st_size <= NOTICE_LIMIT
            and report.get("third_party_notices_sha256") == digest_file(notice),
            "GITHUB_CANDIDATE_THIRD_PARTY_NOTICES_MISMATCH")
    report.update(release_decision="HOLD", candidate_verified=True, required_jobs=success,
                  github_run_url=f"https://github.com/{REPOSITORY}/actions/runs/{run_id}",
                  github_artifact_id=matches[0]["id"])
    (out / SUMS).write_text(
        f'{report["archive_sha256"]}  {RELEASE_ZIP}\n'
        f'{report["third_party_notices_sha256"]}  {NOTICE_NAME}\n', encoding="ascii")
    (out / "release-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def verify_approved_release_snapshot(expected, out, report):
    """Recheck immutable operator-approved asset identity after draft upload."""
    require(expected.get(RELEASE_ZIP) == report.get("archive_sha256")
            and expected.get(NOTICE_NAME) == report.get("third_party_notices_sha256")
            and (out / SUMS).read_text(encoding="ascii") ==
                (f'{report["archive_sha256"]}  {RELEASE_ZIP}\n'
                 f'{report["third_party_notices_sha256"]}  {NOTICE_NAME}\n'),
            "PUBLICATION_HOLD:APPROVED_ASSET_SNAPSHOT_CHANGED")


def inspect_draft_assets(draft, out, report):
    require(draft.get("tag_name") == VERSION and draft.get("draft") is True
            and draft.get("target_commitish") == report["head_sha"],
            "GITHUB_RELEASE_DRAFT_IDENTITY_MISMATCH")
    assets = draft.get("assets", [])
    expected = {name: digest_file(out / name) for name in (RELEASE_ZIP, SUMS, NOTICE_NAME)}
    verify_approved_release_snapshot(expected, out, report)
    require(len(assets) == len(expected) and
            {asset.get("name") for asset in assets} == set(expected) and
            all(asset.get("state") == "uploaded" and
                asset.get("size") == (out / asset["name"]).stat().st_size and
                asset.get("digest") == f'sha256:{expected[asset["name"]]}'
                for asset in assets), "GITHUB_RELEASE_DRAFT_ASSET_SHA256_MISMATCH")
    return expected


def release_body(report):
    return (
        f"# Furusato_nouzei Excel {VERSION}\n\n"
        f"- Excel VBA署名 {report['signing_state']}。同梱EXEのAuthenticodeは{report.get('reader_authenticode', 'UNVERIFIED')}。\n"
        "- 所得年2025年・2026年。対応条件とマクロの扱いは同梱READMEに記載。\n"
        "- PC① Excel 365で1920×1080・125%、同一HEAD・XLSMのローカル検証で1920×1080・100%および1366×768・150%を検証。合成A4 PDFも検証。\n"
        f"- SHA-256 `{report['archive_sha256']}`\n"
        f"- ソースコミット `{report['head_sha']}`\n"
        f"- [GitHub Actionsの実機受入]({report['github_run_url']})\n"
    )


def release_for_version():
    pages = api("releases?per_page=100", "--paginate", "--slurp")
    matching = [release for page in pages for release in page if release.get("tag_name") == VERSION]
    require(len(matching) <= 1, "GITHUB_RELEASE_NOT_UNIQUE")
    return matching[0] if matching else None


def verify_tag(tag, head):
    require(tag.get("ref") == f"refs/tags/{VERSION}"
            and tag.get("object", {}).get("type") == "commit"
            and tag["object"].get("sha") == head, "RELEASE_TAG_SHA_MISMATCH")


def publication_blockers(report, approval=None):
    """Neither CI nor a private JSON flag can manufacture publisher approval."""
    blockers = []
    if report.get("candidate_verified") is not True or report.get("required_jobs") != {
            "static": "success", "windows_compat": "success",
            "document_reader": "success", "excel": "success",
            "ready_to_use_review": "success"}:
        blockers.append("EXACT_HEAD_FIVE_JOB_CANDIDATE_NOT_VERIFIED")
    if (report.get("unverified_display_modes") != [] or
            report.get("private_display_acceptance") != "PASS_TWO_MODES_SAME_HEAD_AND_BOOK"):
        blockers.append("DISPLAY_MODES_NOT_FULLY_VERIFIED")
    if report.get("private_manifest_v6_checked") is not True:
        blockers.append("PRIVATE_V6_SCOPE_MANIFEST_INCOMPLETE")
    if report.get("tax_evidence_scope") != "SYNTHETIC_2025_2026":
        blockers.append("AUTOMATED_2025_2026_TAX_ACCEPTANCE_MISSING")
    if (not isinstance(approval, PublisherApproval) or approval.version != VERSION
            or approval.head_sha != report.get("head_sha")
            or approval.archive_sha256 != report.get("archive_sha256")
            or approval.permission not in ("admin", "maintain") or not approval.login):
        blockers.append("EXPLICIT_FINAL_RELEASE_APPROVAL_MISSING")
    return blockers


def require_publication_clearance(report, approval=None):
    blockers = publication_blockers(report, approval)
    require(not blockers, "PUBLICATION_HOLD:" + ",".join(blockers))


def publish(out, report, approval=None):
    # Paper printing and human tax review are not gates. Explicit issuer consent is.
    # No GitHub write may precede exact authorization and the five automated gates.
    require_publication_clearance(report, approval)
    require(digest_file(out / RELEASE_ZIP) == report["archive_sha256"]
            and digest_file(out / NOTICE_NAME) == report["third_party_notices_sha256"]
            and (out / SUMS).read_text(encoding="ascii") ==
                (f'{report["archive_sha256"]}  {RELEASE_ZIP}\n'
                 f'{report["third_party_notices_sha256"]}  {NOTICE_NAME}\n'),
            "PUBLICATION_HOLD:APPROVED_ZIP_OR_CHECKSUM_CHANGED")
    head = report["head_sha"]
    approved_head(head)
    refs = api(f"git/matching-refs/tags/{VERSION}")
    current = release_for_version()
    body = release_body(report)
    if current is None:
        require(not refs, "GITHUB_RELEASE_TAG_ALREADY_EXISTS")
        notes = out / "release-notes.md"
        notes.write_bytes(body.encode("utf-8"))
        gh("release", "create", VERSION, out / RELEASE_ZIP, out / SUMS, out / NOTICE_NAME,
           "--repo", REPOSITORY, "--draft", "--target", head,
           "--title", f"Furusato_nouzei Excel {VERSION}", "--notes-file", notes)
        current = release_for_version()
        require(current is not None, "GITHUB_RELEASE_DRAFT_MISSING")
    stored_body = (current.get("body") or "").replace("\r\n", "\n")
    require(stored_body.strip() == body.strip(),
            "GITHUB_RELEASE_NOTES_DIFFER_FROM_ACCEPTED_CANDIDATE")
    if current.get("draft") is True:
        expected = inspect_draft_assets(current, out, report)
        approved_head(head)
        refs = api(f"git/matching-refs/tags/{VERSION}")
        if refs:
            require(len(refs) == 1, "GITHUB_RELEASE_TAG_NOT_UNIQUE")
            verify_tag(refs[0], head)
        else:
            ref = api("git/refs", "--method", "POST", "-f", f"ref=refs/tags/{VERSION}",
                      "-f", f"sha={head}")
            verify_tag(ref, head)
        approved_head(head)
        published = api(f"releases/{current['id']}", "--method", "PATCH",
                        "-F", "draft=false", "-f", "make_latest=true")
    else:
        expected = {name: digest_file(out / name) for name in (RELEASE_ZIP, SUMS, NOTICE_NAME)}
        verify_approved_release_snapshot(expected, out, report)
        published = current
    require(published.get("draft") is False and published.get("prerelease") is False
            and published.get("tag_name") == VERSION, "GITHUB_RELEASE_PUBLISH_STATE_UNVERIFIED")
    verify_tag(api(f"git/ref/tags/{VERSION}"), head)
    require(len(published.get("assets", [])) == len(expected) and
            {asset.get("name"): asset.get("digest") for asset in published["assets"]} ==
            {name: "sha256:" + value for name, value in expected.items()},
            "PUBLISHED_RELEASE_ASSET_SHA256_MISMATCH")
    return published["html_url"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--head", required=True)
    parser.add_argument("--run-id", required=True, type=int)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--publish", action="store_true",
                        help="Local authenticated publisher only; never run in CI")
    parser.add_argument("--display-100", type=Path, help="Private 1920x1080@100 evidence folder")
    parser.add_argument("--display-150", type=Path, help="Private 1366x768@150 evidence folder")
    parser.add_argument("--manifest-v6", type=Path, help="Private five-check v6 scope manifest")
    a = parser.parse_args()
    try:
        if a.publish:
            require(not os.environ.get("CI") and not os.environ.get("GITHUB_ACTIONS")
                    and local_interactive(), "PUBLICATION_HOLD:INTERACTIVE_LOCAL_PUBLISHER_REQUIRED")
        present = [a.display_100 is not None, a.display_150 is not None,
                   a.manifest_v6 is not None]
        require(all(present) or not any(present),
                "PUBLICATION_HOLD:ALL_PRIVATE_SCREEN_AND_V6_INPUTS_REQUIRED")
        require(not a.publish or all(present),
                "PUBLICATION_HOLD:PRIVATE_SCREEN_AND_V6_INPUTS_REQUIRED")
        if all(present):
            root = Path(__file__).resolve().parents[1]
            for private_path in (a.display_100, a.display_150, a.manifest_v6):
                real = private_path.resolve()
                require(real != root and root not in real.parents,
                        "PUBLICATION_HOLD:PRIVATE_EVIDENCE_INSIDE_PUBLIC_REPOSITORY")
        report = pull_verified_candidate(a.run_id, a.head, a.output.resolve())
        if all(present):
            apply_private_display_and_scope(
                report, a.display_100, a.display_150, read_evidence(a.manifest_v6))
        if a.publish:
            pending = [item for item in publication_blockers(report)
                       if item != "EXPLICIT_FINAL_RELEASE_APPROVAL_MISSING"]
            require(not pending, "PUBLICATION_HOLD:" + ",".join(pending))
            approval = authenticate_private_publisher(report)
            print("PUBLISHED", publish(a.output.resolve(), report, approval),
                  report["archive_sha256"])
        else:
            print("CANDIDATE_VERIFIED_PUBLICATION_HOLD",
                  ",".join(publication_blockers(report)), report["archive_sha256"])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print("RELEASE_VERIFICATION_HOLD",
              str(error) if isinstance(error, ValueError) else type(error).__name__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
