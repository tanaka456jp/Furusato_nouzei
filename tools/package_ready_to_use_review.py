"""Bundle two already-verified same-run CI artifacts for REVIEW ONLY.

This never builds new VBA, re-signs a binary, or authorizes a release. It
validates the Excel acceptance digest and preserves the generated XLSM bytes.
Customer/taxpayer documents must never be supplied as inputs.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

MARKER = (
    "REVIEW BUILD - NOT FOR PUBLIC DISTRIBUTION\n"
    "Unsigned / release gates incomplete. Never use this package as a formal release.\n"
)
EXPECTED_NAMES = {
    "Furusato_nouzei.xlsm",
    "FurusatoDocumentReader.exe",
    "README.txt",
    "NOT_FOR_PUBLIC_RELEASE.txt",
}
SCHEMA = "furusato-ready-to-use-review/v1"


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        for piece in iter(lambda: source.read(1024 * 1024), b""):
            h.update(piece)
    return h.hexdigest()


def _render_review_readme(guide, head_sha):
    """Write a conspicuous review-only README, not a misleading release guide."""
    original = Path(guide).read_text(encoding="utf-8-sig")
    # Current guide also documents the previous official v4.18.2 release.
    # Correct statements referring to THIS ZIP; preserve historical instructions.
    original = original.replace(
        "# ふるさと納税 寄附限度額試算 v4.18.2 正式版（対応範囲限定）",
        "# ふるさと納税 寄附限度額試算：開発検証用ガイド（正式配布HOLD）",
    ).replace(
        "本パッケージはv4.18.2正式版です。",
        "本検証ZIPは正式版ではありません。現行正式版v4.18.2とは別の開発用成果物です。",
    )
    notice = (
        "# 次期版 ReadyToUse 実機検証用 — 正式配布HOLD\\n\\n"
        f"対象開発コミット：{head_sha}\\n\\n"
        "このZIPは検証専用です。現行正式版v4.18.2でも、署名済みの販売製品でもありません。\\n"
        "同梱EXEのコード署名・VBA署名の真正性は未検証です。\\n"
        "本番の税務判断に用いず、隔離された検証環境で確認してください。\\n"
        "Windows/Officeのセキュリティ設定を一括解除しないでください。\\n"
        "セットアップは不要です。別フォルダへ展開し、組織のポリシーが許す\\n"
        "Windows Excel 365環境でFurusato_nouzei.xlsmを開いてください。\\n"
        "原票にない扶養・控除・自治体情報が不明なら確定的な寄附上限を出しません。\\n\\n"
        "---\\n\\n"
        "以下は既存のユーザーガイドを検証版向けに表示修正した参考資料です。\\n\\n"
    )
    return (notice.replace(chr(92) + 'n', chr(10)) + original).encode("utf-8")


def package_review(book, reader, acceptance, guide, target, *, head_sha):
    paths = [Path(x) for x in (book, reader, acceptance, guide)]
    target = Path(target)
    if not isinstance(head_sha, str) or re.fullmatch(r"[0-9a-f]{40}", head_sha) is None:
        raise ValueError("INVALID_HEAD_SHA")
    if len({p.resolve() for p in paths + [target.resolve()]}) != 5:
        raise ValueError("INPUT_OUTPUT_PATH_COLLISION")
    if not all(p.is_file() for p in paths):
        raise ValueError("MISSING_ACCEPTANCE_ARTIFACT")
    if paths[0].name != "Furusato_nouzei.xlsm" or paths[1].name != "FurusatoDocumentReader.exe":
        raise ValueError("UNEXPECTED_BINARY_FILENAMES")
    if not 100000 <= paths[0].stat().st_size <= 100000000:
        raise ValueError("INVALID_REVIEW_WORKBOOK_SIZE")
    if not 10000 <= paths[1].stat().st_size <= 100000000:
        raise ValueError("INVALID_READER_EXE_SIZE")
    if paths[3].stat().st_size > 1024 * 1024:
        raise ValueError("OVERSIZED_USER_GUIDE")
    review_readme = _render_review_readme(paths[3], head_sha)
    if len(review_readme) > 1024 * 1024:
        raise ValueError("OVERSIZED_REVIEW_README")
    report = json.loads(paths[2].read_text(encoding="utf-8-sig"))
    if not isinstance(report, dict) or report.get("status") != "PASS":
        raise ValueError("EXCEL_ACCEPTANCE_NOT_PASSED")
    expected = report.get("workbook_sha256")
    if not isinstance(expected, str) or re.fullmatch(r"[0-9a-fA-F]{64}", expected) is None:
        raise ValueError("INVALID_EXCEL_ACCEPTANCE_CHECKSUM")
    workbook_sha = digest(paths[0])
    if expected.lower() != workbook_sha:
        raise ValueError("ACCEPTED_XLSM_SHA256_MISMATCH")
    if target.exists():
        raise ValueError("REFUSE_TO_OVERWRITE_REVIEW_ZIP")
    sources = {
        "Furusato_nouzei.xlsm": paths[0],
        "FurusatoDocumentReader.exe": paths[1],
    }
    with ZipFile(target, "x", ZIP_DEFLATED) as zipped:
        for name, source in sources.items():
            zipped.write(source, name)
        zipped.writestr("README.txt", review_readme)
        zipped.writestr("NOT_FOR_PUBLIC_RELEASE.txt", MARKER)
    with ZipFile(target) as zipped:
        if set(zipped.namelist()) != EXPECTED_NAMES or zipped.testzip() is not None:
            raise ValueError("INVALID_REVIEW_ZIP")
        for name, source in sources.items():
            with zipped.open(name) as contents:
                extracted = hashlib.sha256()
                for chunk in iter(lambda: contents.read(1024 * 1024), b""):
                    extracted.update(chunk)
            if extracted.hexdigest() != digest(source):
                raise ValueError("REVIEW_ZIP_MEMBER_SHA256_MISMATCH")
        if zipped.read("README.txt") != review_readme:
            raise ValueError("REVIEW_README_MISMATCH")
    return {
        "schema": SCHEMA,
        "head_sha": head_sha,
        "release_decision": "HOLD",
        "package_class": "SYNTHETIC_CI_REVIEW_ONLY",
        "ready_to_use_review_sha256": digest(target),
        "accepted_workbook_sha256": workbook_sha,
        "reader_sha256": digest(paths[1]),
        "review_readme_sha256": hashlib.sha256(review_readme).hexdigest(),
        "signing_state": "NOT_VERIFIED",
        "note": "Review only. Physical printer, legal tax cases, live GAS, signatures and release approval are not satisfied.",
    }


def main():
    ap = argparse.ArgumentParser()
    for name in ("book", "reader", "acceptance", "guide", "target", "evidence"):
        ap.add_argument("--" + name, required=True, type=Path)
    ap.add_argument("--head-sha", required=True)
    a = ap.parse_args()
    if a.evidence.exists():
        raise ValueError("REFUSE_TO_OVERWRITE_EVIDENCE")
    result = package_review(a.book, a.reader, a.acceptance, a.guide,
                            a.target, head_sha=a.head_sha)
    a.evidence.write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n",
                          encoding="utf-8")
    print("READY_TO_USE_REVIEW_CREATED_RELEASE_HOLD")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
