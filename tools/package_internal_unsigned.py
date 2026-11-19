"""Package accepted unsigned XLSM/EXE for a *private internal-use evaluation*.

This is NOT a public Release, product signing, or tax validation. Source binaries
must originate from the exact-head same-run review ZIP and remain unchanged.
Do not include taxpayer documents or any user-created workbook in this ZIP.
"""
import argparse
import hashlib
import io
import json
import re
import stat
import sys
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from collect_reader_notices import NOTICE_LIMIT, NOTICE_NAME
from package_ready_to_use_review import (
    EXPECTED_NAMES, MARKER, _inspect_reader, _verify_xlsm, digest,
)
from release_readiness import VERSION, parse_evidence_json

SCHEMA = "furusato-unsigned-internal/v1"
OUTPUT_NAMES = {
    "Furusato_nouzei.xlsm", "FurusatoDocumentReader.exe", "README.txt",
    "INTERNAL_USE_UNSIGNED.txt", NOTICE_NAME,
}
SHA = re.compile(r"[0-9a-f]{64}\Z")
HEAD = re.compile(r"[0-9a-f]{40}\Z")
MAX_ARCHIVE = 150_000_000


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and
            0 < path.stat().st_size <= 524_288, "PRIVATE_EVIDENCE_INVALID")
    return parse_evidence_json(path.read_text(encoding="utf-8-sig"))


def _guide(head, run_id):
    return (
        "# ふるさと納税 寄附限度額試算 " + VERSION + " — 署名なし・内部利用用\n\n"
        "このZIPは所有者の私用・事務所内での評価専用です。販売・外部再配布・公式Release用ではありません。\n"
        "VBAと付属EXEは署名されていません。発行元の信頼性はコード署名で保証されません。\n"
        "ダウンロード元と同一CIのSHA-256を確認したうえで使用してください。\n"
        "組織のポリシーで許可されないマクロやEXEを実行しないでください。\n"
        "Office全体のマクロ設定を変更したり、信頼済み場所を追加したりしないでください。\n"
        "Windows/OfficeがマクロやEXEをブロックしたら、その保護を優先し管理者へ確認してください。\n\n"
        "使用方法：ZIPを別フォルダに展開し、同じフォルダのXLSMとEXEをそのまま保存します。\n"
        "Windows 11 / Excel 365で開き、対象所得年（2025年／2026年）と源泉徴収票を確認してください。\n"
        "複数人の一括計算一覧は別人を混在させないようにし、共有前に一覧を消去してください。\n"
        "試算額は未確定の参考値です。扶養・住宅ローン控除・他所得・住所・自治体条件などは別途確認してください。\n"
        "2025年／2026年の税務計算について独立監査が完了するまで、本番の確定的税務判断に使わないでください。\n"
        "原票の氏名や番号など実データをGitHub Actionsや公開リポジトリにアップロードしないでください。\n"
        "同梱第三者ソフトの注意事項は " + NOTICE_NAME + " を確認してください。\n\n"
        "内部評価用CI実行ID: " + str(run_id) + "\n"
        "ソースHEAD：" + head + "\n"
    ).encode("utf-8")


def build(review_zip, review_receipt, reader_report, notice, output, evidence, *,
          head, run_id):
    review_zip, review_receipt, reader_report, notice, output, evidence = map(
        Path, (review_zip, review_receipt, reader_report, notice, output, evidence))
    require(isinstance(head, str) and HEAD.fullmatch(head)
            and type(run_id) is int and run_id > 0, "INTERNAL_SOURCE_IDENTITY_INVALID")
    require(len({p.resolve() for p in (review_zip, review_receipt,
                                      reader_report, notice, output, evidence)}) == 6,
            "INTERNAL_PATH_COLLISION")
    require(all(p.is_file() and not p.is_symlink()
                for p in (review_zip, review_receipt, reader_report, notice))
            and not output.exists() and not evidence.exists()
            and output.parent.is_dir() and evidence.parent.is_dir(),
            "INTERNAL_INPUT_OR_OUTPUT_INVALID")
    require(0 < review_zip.stat().st_size <= MAX_ARCHIVE, "INTERNAL_REVIEW_ZIP_OVERSIZED")
    review = read_json(review_receipt)
    reader = read_json(reader_report)
    require(isinstance(review, dict) and
            review.get("schema") == "furusato-ready-to-use-review/v1"
            and review.get("head_sha") == head
            and review.get("release_decision") == "HOLD"
            and review.get("package_class") == "SYNTHETIC_CI_REVIEW_ONLY"
            and review.get("signing_state") == "NOT_VERIFIED"
            and review.get("ready_to_use_review_sha256") == digest(review_zip),
            "INTERNAL_REVIEW_PROVENANCE_INVALID")
    require(isinstance(reader, dict) and
            reader.get("schema") == "furusato-reader-build/v1"
            and reader.get("head_sha") == head
            and reader.get("run_id") == run_id
            and reader.get("exe_authenticode") == "UNSIGNED"
            and reader.get("windows_cli_accepted") is True,
            "INTERNAL_READER_BUILD_PROVENANCE_INVALID")
    require(notice.stat().st_size > 0 and notice.stat().st_size <= NOTICE_LIMIT
            and notice.read_bytes().startswith(
                ("FurusatoDocumentReader.exe third-party notices\n"
                 "Source HEAD: " + head + "\n").encode("ascii"))
            and reader.get("third_party_notices_sha256") == digest(notice),
            "INTERNAL_THIRD_PARTY_NOTICE_INVALID")
    with ZipFile(review_zip) as z:
        infos = z.infolist()
        require(len(infos) == 4 and set(z.namelist()) == EXPECTED_NAMES and
                len({x.filename.casefold() for x in infos}) == len(infos) and
                all(not x.is_dir() and not x.flag_bits & 1 and
                    x.file_size > 0 and x.compress_size > 0 and
                    x.file_size <= 120_000_000 and
                    x.file_size <= x.compress_size * 1000 and
                    not x.filename.startswith(("/", "\\")) and
                    ((x.external_attr >> 16) & 0o170000) != 0o120000
                    for x in infos) and
                sum(x.file_size for x in infos) <= MAX_ARCHIVE and
                z.testzip() is None, "INTERNAL_REVIEW_ZIP_UNSAFE")
        require(z.read("NOT_FOR_PUBLIC_RELEASE.txt").decode("utf-8") == MARKER,
                "INTERNAL_REVIEW_MARKER_INVALID")
        book = z.read("Furusato_nouzei.xlsm")
        exe = z.read("FurusatoDocumentReader.exe")
        old_readme = z.read("README.txt")
    book_hash = hashlib.sha256(book).hexdigest()
    exe_hash = hashlib.sha256(exe).hexdigest()
    require(review.get("accepted_workbook_sha256") == book_hash
            and review.get("reader_sha256") == exe_hash
            and review.get("review_readme_sha256") == hashlib.sha256(old_readme).hexdigest()
            and reader.get("exe_sha256") == exe_hash,
            "INTERNAL_REVIEW_MEMBER_DIGEST_INVALID")
    _verify_xlsm(book, VERSION, "UNSIGNED", None)
    _inspect_reader(io.BytesIO(exe), len(exe))  # Refuses signed/invalid PE.
    guide = _guide(head, run_id)
    marker = (
        "署名なし・事務所内の評価専用 / NOT FOR PUBLIC RELEASE\n"
        "VBA/EXE are unsigned; verify the source and do not bypass Office protection.\n"
        "Independent tax and physical acceptance remain necessary.\n"
    ).encode("utf-8")
    payloads = {
        "Furusato_nouzei.xlsm": book,
        "FurusatoDocumentReader.exe": exe,
        "README.txt": guide,
        "INTERNAL_USE_UNSIGNED.txt": marker,
        NOTICE_NAME: notice.read_bytes(),
    }
    require(set(payloads) == OUTPUT_NAMES
            and sum(len(v) for v in payloads.values()) <= MAX_ARCHIVE,
            "INTERNAL_PACKAGE_SIZE_INVALID")
    initial = digest(review_zip)
    written = False
    try:
        with output.open("xb") as handle:
            written = True
            with ZipFile(handle, "w") as result:
                for name, data in payloads.items():
                    info = ZipInfo(name)
                    info.compress_type = ZIP_DEFLATED
                    info.external_attr = (stat.S_IFREG | 0o644) << 16
                    result.writestr(info, data)
        with ZipFile(output) as check:
            require(len(check.infolist()) == len(payloads)
                    and check.namelist() == list(payloads)
                    and check.testzip() is None
                    and all(check.read(name) == payload
                            for name, payload in payloads.items()),
                    "INTERNAL_PACKAGE_INTEGRITY_INVALID")
        require(digest(review_zip) == initial and
                digest(notice) == reader["third_party_notices_sha256"],
                "INTERNAL_PACKAGE_INPUT_CHANGED")
        receipt = {
            "schema": SCHEMA, "source_head_sha": head, "ci_run_id": run_id,
            "version": VERSION, "package_class": "UNSIGNED_PRIVATE_INTERNAL_EVALUATION",
            "archive_sha256": digest(output),
            "workbook_sha256": book_hash, "reader_sha256": exe_hash,
            "third_party_notices_sha256": digest(notice),
            "vba_signature": "UNSIGNED", "exe_authenticode": "UNSIGNED",
            "tax_review": "INDEPENDENT_APPROVAL_NOT_VERIFIED",
            "release_decision": "HOLD",
        }
        with evidence.open("x", encoding="utf-8") as result:
            json.dump(receipt, result, ensure_ascii=False, indent=2)
            result.write("\n")
        return receipt
    except BaseException:
        if written:
            output.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("review-zip", "review-receipt", "reader-report", "notice",
                 "output", "evidence"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--head", required=True)
    parser.add_argument("--run-id", required=True, type=int)
    a = parser.parse_args()
    try:
        build(a.review_zip, a.review_receipt, a.reader_report,
              a.notice, a.output, a.evidence, head=a.head, run_id=a.run_id)
    except (ValueError, OSError, TypeError, KeyError, UnicodeError) as err:
        print("INTERNAL_UNSIGNED_PACKAGE_REFUSED=" +
              (str(err) if isinstance(err, ValueError) else "INVALID_LOCAL_INPUT"))
        return 2
    print("INTERNAL_UNSIGNED_CANDIDATE_CREATED_NOT_PUBLIC_RELEASE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
