"""Verify exact-HEAD GitHub Actions evidence; publish only an accepted Excel ZIP."""

import argparse
import json
import subprocess
from pathlib import Path

from collect_reader_notices import NOTICE_LIMIT, NOTICE_NAME
from record_ci_acceptance import digest_file
from release_readiness import (
    BRANCH, RELEASE_ARTIFACT, RELEASE_PR, RELEASE_ZIP, REPOSITORY, VERSION,
    read_evidence, require, validate_candidate_report, validate_github, valid_sha,
)
from verify_excel_release_candidate import verify_distribution

SUMS = "SHA256SUMS.txt"


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
    report.update(release_decision="READY", required_jobs=success,
                  github_run_url=f"https://github.com/{REPOSITORY}/actions/runs/{run_id}",
                  github_artifact_id=matches[0]["id"])
    (out / SUMS).write_text(
        f'{report["archive_sha256"]}  {RELEASE_ZIP}\n'
        f'{report["third_party_notices_sha256"]}  {NOTICE_NAME}\n', encoding="ascii")
    (out / "release-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def inspect_draft_assets(draft, out, report):
    require(draft.get("tag_name") == VERSION and draft.get("draft") is True
            and draft.get("target_commitish") == report["head_sha"],
            "GITHUB_RELEASE_DRAFT_IDENTITY_MISMATCH")
    assets = draft.get("assets", [])
    expected = {name: digest_file(out / name) for name in (RELEASE_ZIP, SUMS, NOTICE_NAME)}
    require(len(assets) == len(expected) and
            {asset.get("name") for asset in assets} == set(expected) and
            all(asset.get("state") == "uploaded" and
                asset.get("size") == (out / asset["name"]).stat().st_size and
                asset.get("digest") == f'sha256:{expected[asset["name"]]}'
                for asset in assets), "GITHUB_RELEASE_DRAFT_ASSET_SHA256_MISMATCH")
    return expected


def publish(out, report):
    head = report["head_sha"]
    approved_head(head)
    require(not api(f"git/matching-refs/tags/{VERSION}"), "GITHUB_RELEASE_TAG_ALREADY_EXISTS")
    releases = api("releases?per_page=100", "--paginate", "--slurp")
    require(not any(release.get("tag_name") == VERSION for page in releases for release in page),
            "GITHUB_RELEASE_ALREADY_EXISTS")
    notes = out / "release-notes.md"
    notes.write_text(
        f"# Furusato_nouzei Excel {VERSION}\n\n"
        f"- Excel VBA署名 {report['signing_state']}。同梱EXEのAuthenticodeはUNSIGNED。\n"
        "- 所得年2025年・2026年。対応条件とマクロの扱いは同梱READMEに記載。\n"
        "- PC① Windows Excel 365で、1920×1080・125%と合成A4 PDFを検証。\n"
        f"- SHA-256 `{report['archive_sha256']}`\n"
        f"- ソースコミット `{head}`\n"
        f"- [GitHub Actionsの実機受入]({report['github_run_url']})\n",
        encoding="utf-8",
    )
    gh("release", "create", VERSION, out / RELEASE_ZIP, out / SUMS, out / NOTICE_NAME, "--repo", REPOSITORY,
       "--draft", "--target", head, "--title", f"Furusato_nouzei Excel {VERSION}",
       "--notes-file", notes)
    drafts = api("releases?per_page=100", "--paginate", "--slurp")
    matching = [release for page in drafts for release in page if release.get("tag_name") == VERSION]
    require(len(matching) == 1, "GITHUB_RELEASE_DRAFT_NOT_UNIQUE")
    draft = matching[0]
    expected = inspect_draft_assets(draft, out, report)
    approved_head(head)
    ref = api("git/refs", "--method", "POST", "-f", f"ref=refs/tags/{VERSION}",
              "-f", f"sha={head}")
    require(ref.get("ref") == f"refs/tags/{VERSION}" and
            ref.get("object", {}).get("type") == "commit" and
            ref["object"].get("sha") == head, "NEW_RELEASE_TAG_SHA_MISMATCH")
    published = api(f"releases/{draft['id']}", "--method", "PATCH",
                    "-F", "draft=false", "-f", "make_latest=true")
    require(published.get("draft") is False and published.get("prerelease") is False
            and published.get("tag_name") == VERSION, "GITHUB_RELEASE_PUBLISH_STATE_UNVERIFIED")
    tag = api(f"git/ref/tags/{VERSION}")
    require(tag.get("object", {}).get("type") == "commit"
            and tag["object"].get("sha") == head, "PUBLISHED_RELEASE_TAG_SHA_MISMATCH")
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
                        help="Publish only after exact-HEAD CI, package and draft checks")
    a = parser.parse_args()
    try:
        report = pull_verified_candidate(a.run_id, a.head, a.output.resolve())
        if a.publish:
            print("PUBLISHED", publish(a.output.resolve(), report), report["archive_sha256"])
        else:
            print("RELEASE_READY", report["archive_sha256"])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print("RELEASE_VERIFICATION_HOLD",
              str(error) if isinstance(error, ValueError) else type(error).__name__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
