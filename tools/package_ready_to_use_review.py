"""Bundle two already-verified same-run CI artifacts for REVIEW ONLY.

This never builds new VBA, re-signs a binary, or authorizes a release. It
validates the Excel acceptance digest and preserves the generated XLSM bytes.
Customer/taxpayer documents must never be supplied as inputs.
"""
import argparse
import hashlib
import io
import json
import re
import shutil
import stat
import struct
from pathlib import Path
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile, ZipInfo, ZIP_DEFLATED, ZIP_STORED

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
DISTRIBUTION_SCHEMA = "furusato-ready-to-use-distribution/v2"
SIGNING_SCHEMA = "furusato-local-vba-signing/v2"
BOOK_NAME = "Furusato_nouzei.xlsm"
READER_NAME = "FurusatoDocumentReader.exe"
README_NAME = "README.txt"
DISTRIBUTION_MEMBERS = {BOOK_NAME, READER_NAME, README_NAME}
VBA_PROJECT = "xl/vbaProject.bin"
RELATIONSHIPS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
CONTENT_TYPES = "{http://schemas.openxmlformats.org/package/2006/content-types}"
VBA_CONTENT_TYPE = "application/vnd.ms-office.vbaProject"
VBA_RELATIONSHIP = "http://schemas.microsoft.com/office/2006/relationships/vbaProject"
SIGNATURE_SUFFIXES = {
    ".bin": VBA_RELATIONSHIP + "Signature",
    "Agile.bin": VBA_RELATIONSHIP + "SignatureAgile",
    "V3.bin": "http://schemas.microsoft.com/office/2020/07/relationships/vbaProjectSignatureV3",
}
MAX_PACKAGE_BYTES = 150_000_000
MEMBER_SIZE_LIMITS = {
    BOOK_NAME: (100_000, 100_000_000),
    READER_NAME: (10_000, 120_000_000),
    README_NAME: (1, 1_048_576),
}


def validate_release_signing_evidence(evidence, *, head_sha, workbook_sha256, signing_state):
    if not isinstance(evidence, dict) or (
        evidence.get("schema") != SIGNING_SCHEMA
        or evidence.get("head_sha") != head_sha
        or evidence.get("signing_state") != signing_state
        or not _is_sha256(evidence.get("source_workbook_sha256"))
    ):
        raise ValueError("SIGNING_EVIDENCE_PROVENANCE_INVALID")
    if signing_state == "UNSIGNED":
        if (evidence.get("availability") not in {
                "SIGNING_NOT_CONFIGURED", "CODE_SIGNING_CERTIFICATE_NOT_FOUND_IN_CURRENT_USER_MY",
                "SIGNING_PRIVATE_KEY_NOT_ACCESSIBLE", "X86_WINDOWS_SDK_NOT_FOUND",
                "X86_SIGNTOOL_NOT_FOUND", "X86_OFFICE_SIP_NOT_REGISTERED",
            } or "signed_workbook_sha256" not in evidence
            or evidence["signed_workbook_sha256"] is not None
            or evidence["source_workbook_sha256"] != workbook_sha256):
            raise ValueError("UNSIGNED_EVIDENCE_INVALID")
        return None
    if (signing_state != "SIGNED" or evidence.get("availability") != "AVAILABLE"
        or evidence.get("signed_workbook_sha256") != workbook_sha256
        or evidence["source_workbook_sha256"] == workbook_sha256
        or not _is_sha256(evidence.get("accepted_vba_project_sha256"))
        or evidence.get("signed_vba_project_sha256") != evidence["accepted_vba_project_sha256"]
        or evidence.get("signing_certificate_eku") != "CODE_SIGNING"
        or evidence.get("office_vba_signed_property") != "OFFICE_RECOGNIZED_SIGNED_PROJECT"
        or evidence.get("test_only") is not False
        or evidence.get("release_approved") is not False
        or any(evidence.get(key) is not True for key in (
            "certificate_thumbprint_matched", "signtool_verified",
            "certificate_chain_verified", "timestamp_verified",
        ))):
        raise ValueError("SIGNED_VBA_EVIDENCE_INVALID")
    return evidence["signed_vba_project_sha256"]


def _is_sha256(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _release_readme(head_sha, version, signing_state):
    if not isinstance(head_sha, str) or re.fullmatch(r"[0-9a-f]{40}", head_sha) is None:
        raise ValueError("INVALID_HEAD_SHA")
    if not isinstance(version, str) or re.fullmatch(r"v\d+\.\d+\.\d+", version) is None or version == "v4.18.2":
        raise ValueError("INVALID_DISTRIBUTION_VERSION")
    if signing_state == "SIGNED":
        workbook_notice = "VBA 署名あり。実際の Excel と Office SIP で検証した署名です。"
    elif signing_state == "UNSIGNED":
        workbook_notice = "VBA 署名なし。Office のマクロ保護が有効な環境では実行を拒否される場合があります。"
    else:
        raise ValueError("INVALID_DISTRIBUTION_SIGNING_STATE")
    docs = f"https://github.com/tanaka456jp/Furusato_nouzei/blob/{head_sha}/docs"
    return f"""# ふるさと納税 寄附限度額試算 {version}

【配布ファイルの署名状態】
Furusato_nouzei.xlsm の VBA: {signing_state} — {workbook_notice}
FurusatoDocumentReader.exe: UNSIGNED — PDF読取用EXEには独立したコード署名がありません。
公式 GitHub Release からダウンロードし、ZIP の SHA-256 を同じリリースの SHA256SUMS.txt と照合してください。

【開いて使う】
1. ZIP を新しいローカルフォルダーに展開します。設定作業は不要です。XLSM と EXE は同じフォルダーに置いてください。
2. Windows 11 の Excel 365 で Furusato_nouzei.xlsm を開きます。
3. 所得年を選び「税制を更新」を実行します。源泉徴収票の金額を手入力するか「源泉票を取込」を使い、仮転記を原票で照合します。
4. 操作画面の「住民税の課税自治体」（D51）で自治体の税率を確認し、「標準市町村」（市町村民税6%・都道府県民税4%）または「標準指定都市」（市民税8%・道府県民税2%）を選びます。「条例差・不明」または未入力の場合は寄附目安を表示しません。
5. 取込を行った場合は「読取内容の確認」を実行します。「計算」を押して計算の状態と寄附目安を確認します。「計算根拠」で税額の内訳を確認し、「印刷プレビュー」または「PDF出力」を使えます。
6. 「案件保存」で顧客ごとのコピーを作成し、再編集時はそのコピーを開きます。税制更新の前に作成されたバックアップは Furusato_backups フォルダーで確認できます。

【組織のポリシーが許す場合だけ個別に許可】
Microsoft 365 はインターネットから取得したファイルのマクロをブロックします。管理 PC では管理者の方針に従い、変更権限がないときは管理者へ相談してください。
公式配布元と SHA-256 を照合でき、所属組織の方針で許可されている場合は、Excel を閉じ、展開した XLSM の「プロパティ」から個別の「許可する（ブロックの解除）」を選べます。再度開き、そのファイルの内容と発行元を確認してから Excel の案内に従ってください。
Office 全体のマクロ保護・保護ビューを解除せず、信頼済み場所を追加しないでください。EXE が Windows や組織の保護で止まった場合はポリシーに従い、許可されるまでは数値を手入力してください。
Microsoft のマクロ保護の説明はこちらです。
https://learn.microsoft.com/ja-jp/deployoffice/security/internet-macros-blocked

【対象範囲】
所得年は 2025 年分・2026 年分。2026 年分は 12 月施行後の通常の年末調整等が対象です。条例差、特殊な控除、所得区分や資料が対応範囲外・未確認のときは表示された HOLD の理由を確認してください。
この結果は対応条件内の試算です。OCR 仮転記は必ず原票と照合し、確定税額や自己負担額の保証として使用しないでください。
同梱 EXE はオフラインで文字情報のある源泉徴収票 PDF を読取ります。画像 PDF・写真の OCR に必要な Tesseract と日本語辞書、および HEIC デコーダーは同梱していません。対応する資料の再取得または手入力をお試しください。
算定の対応条件と一次資料はこちらです。
{docs}/excel-v41836-tax-scope.md
同梱ソフトウェアのライセンスは、同じ GitHub Release に掲載する THIRD_PARTY_NOTICES.txt を参照してください。
実機で確認した表示条件は Excel 365 の 1920×1080・125% です。1920×1080・100% と 1366×768・150% は未確認です。印刷の検査は Excel から生成した PDF で行い、実紙は試験していません。
VBAUpdater で保守する場合は案件・配布原本を保全し、コピーで差分と再オープンを確認してから利用してください。VBA 更新により署名が失効する場合があります。
{docs}/vbaupdater-integration.md

ソースHEAD：{head_sha}
""".encode("utf-8")


def verify_release_readme(payload, head_sha, version, signing_state):
    from release_candidate_branding import verify_release_readme as verify_branding

    verify_branding(payload, version, head_sha)
    if payload != _release_readme(head_sha, version, signing_state):
        raise ValueError("DISTRIBUTION_README_CONTENT_OR_SIGNING_STATE_MISMATCH")
    return True


def _safe_zip_member(info, minimum, maximum):
    kind = stat.S_IFMT((info.external_attr >> 16) & 0xffff)
    return (not info.is_dir() and not info.flag_bits & 1
            and not info.external_attr & 0x0410  # Windows reparse point or directory
            and kind in (0, stat.S_IFREG)
            and info.compress_type in (ZIP_STORED, ZIP_DEFLATED)
            and minimum <= info.file_size <= maximum
            and info.compress_size > 0
            and info.file_size <= info.compress_size * 1000)


def _load_package_xml(zip_file, name, root_tag):
    info = zip_file.getinfo(name)
    if not _safe_zip_member(info, 1, 131_072):
        raise ValueError("UNSAFE_XLSM_XML_PART")
    payload = zip_file.read(info)
    # Excel emits UTF-8 OPC metadata. Reject encodings that can hide a DTD.
    clean = payload.decode("utf-8-sig")
    if any(marker in clean for marker in ("\0", "<!DOCTYPE", "<!ENTITY")):
        raise ValueError("UNSAFE_XLSM_XML_PART")
    parsed = ElementTree.fromstring(clean)
    if parsed.tag != root_tag:
        raise ValueError("INVALID_XLSM_XML_PART")
    return parsed


def _verify_xlsm(payload, version, signing_state, expected_vba_sha):
    from release_candidate_branding import verify_workbook_labels

    with ZipFile(io.BytesIO(payload)) as workbook:
        entries = workbook.infolist()
        names = {entry.filename.casefold(): entry.filename for entry in entries}
        if (len(entries) > 5000 or len(names) != len(entries)
            or sum(item.file_size for item in entries) > 200_000_000
            or any(not _safe_zip_member(item, 1, 100_000_000)
                   or "\\" in item.filename or ":" in item.filename
                   or item.orig_filename != item.filename
                   or any(segment in ("", ".", "..") for segment in item.filename.split("/"))
                   for item in entries)):
            raise ValueError("UNSAFE_DISTRIBUTION_XLSM_ENTRIES")
        project = workbook.getinfo(VBA_PROJECT)
        if not _safe_zip_member(project, 1024, 30_000_000):
            raise ValueError("INVALID_DISTRIBUTION_VBA_PROJECT")
        vba = workbook.read(project)
        if vba[:8] != bytes.fromhex("D0CF11E0A1B11AE1"):
            raise ValueError("INVALID_DISTRIBUTION_VBA_PROJECT")
        vba_sha = hashlib.sha256(vba).hexdigest()
        if expected_vba_sha and expected_vba_sha != vba_sha:
            raise ValueError("SIGNED_VBA_PROJECT_DIGEST_MISMATCH")
        types = _load_package_xml(workbook, "[Content_Types].xml", CONTENT_TYPES + "Types")
        overrides = _unique_package_attributes(types, "Override", "PartName", "ContentType", CONTENT_TYPES)
        defaults = _unique_package_attributes(types, "Default", "Extension", "ContentType", CONTENT_TYPES)
        if (overrides.get("/xl/workbook.xml") != "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
            or overrides.get("/xl/vbaProject.bin", defaults.get("bin")) != VBA_CONTENT_TYPE):
            raise ValueError("INVALID_DISTRIBUTION_VBA_CONTENT_TYPES")
        links = _load_package_xml(workbook, "xl/_rels/workbook.xml.rels", RELATIONSHIPS + "Relationships")
        related = [link for link in links if link.get("Type") == VBA_RELATIONSHIP
                   or link.get("Target", "").casefold().endswith("vbaproject.bin")]
        if (len(related) != 1 or related[0].tag != RELATIONSHIPS + "Relationship"
            or related[0].get("Type") != VBA_RELATIONSHIP
            or related[0].get("Target") not in ("vbaProject.bin", "/xl/vbaProject.bin")
            or related[0].get("TargetMode") not in (None, "Internal")):
            raise ValueError("INVALID_DISTRIBUTION_VBA_LINK")
        sig_names = {name for key, name in names.items() if key.startswith("xl/vbaprojectsignature")}
        sig_overrides = {key.removeprefix("/") for key, value in overrides.items()
                         if value.startswith(VBA_CONTENT_TYPE + "Signature")}
        rels_name = "xl/_rels/vbaProject.bin.rels"
        has_sig_rels = rels_name.casefold() in names
        if signing_state == "UNSIGNED":
            if sig_names or sig_overrides or has_sig_rels or any(
                    entry.startswith("_xmlsignatures/") for entry in names):
                raise ValueError("UNSIGNED_DISTRIBUTION_CONTAINS_SIGNATURE")
        else:
            if not sig_names or not has_sig_rels or sig_overrides != sig_names:
                raise ValueError("SIGNED_DISTRIBUTION_VBA_SIGNATURE_PART_MISSING")
            sig_links = _load_package_xml(workbook, rels_name, RELATIONSHIPS + "Relationships")
            expected_links = {}
            for name in sig_names:
                target = name.removeprefix("xl/")
                suffix = target.removeprefix("vbaProjectSignature")
                if (suffix not in SIGNATURE_SUFFIXES or not target.startswith("vbaProjectSignature")
                    or not _safe_zip_member(workbook.getinfo(name), 129, 5_000_000)
                    or overrides["/" + name] != VBA_CONTENT_TYPE + "Signature" + suffix[:-4]):
                    raise ValueError("INVALID_DISTRIBUTION_VBA_SIGNATURE_PART")
                expected_links[target] = SIGNATURE_SUFFIXES[suffix]
            found_links = {}
            for link in sig_links:
                target = link.get("Target", "").removeprefix("/xl/")
                if (link.tag != RELATIONSHIPS + "Relationship" or target in found_links
                    or link.get("TargetMode") not in (None, "Internal")):
                    raise ValueError("INVALID_DISTRIBUTION_VBA_SIGNATURE_LINK")
                found_links[target] = link.get("Type")
            if found_links != expected_links:
                raise ValueError("INVALID_DISTRIBUTION_VBA_SIGNATURE_LINK")
    verify_workbook_labels(payload, version)
    return vba_sha


def _unique_package_attributes(root, tag, key_attribute, value_attribute, namespace):
    results = {}
    seen = set()
    for element in root.findall(namespace + tag):
        key = element.get(key_attribute, "")
        value = element.get(value_attribute, "")
        if not key or not value or key.casefold() in seen:
            raise ValueError("INVALID_XLSM_DUPLICATE_OR_EMPTY_CONTENT_TYPE")
        seen.add(key.casefold())
        results[key] = value
    return results


def _inspect_reader(stream, size):
    def at(offset, count):
        if offset < 0 or offset + count > size:
            raise ValueError("INVALID_DISTRIBUTION_READER_PE")
        stream.seek(offset)
        chunk = stream.read(count)
        if len(chunk) != count:
            raise ValueError("INVALID_DISTRIBUTION_READER_PE")
        return chunk

    if at(0, 2) != b"MZ":
        raise ValueError("INVALID_DISTRIBUTION_READER_PE")
    offset = struct.unpack("<I", at(0x3c, 4))[0]
    if not 64 <= offset <= 65_536 or at(offset, 4) != b"PE\0\0":
        raise ValueError("INVALID_DISTRIBUTION_READER_PE")
    optional_header_size = struct.unpack("<H", at(offset + 20, 2))[0]
    optional_header_start = offset + 24
    magic = struct.unpack("<H", at(optional_header_start, 2))[0]
    directory_offset = {0x10b: 96, 0x20b: 112}.get(magic)
    if directory_offset is None or optional_header_size < directory_offset + 40:
        raise ValueError("INVALID_DISTRIBUTION_READER_PE")
    count = struct.unpack("<I", at(optional_header_start + directory_offset - 4, 4))[0]
    if count < 5 or any(at(optional_header_start + directory_offset + 32, 8)):
        raise ValueError("DISTRIBUTION_READER_UNSIGNED_STATE_MISMATCH")


def check_distribution_zip_entries(entries):
    if (len(entries) != len(DISTRIBUTION_MEMBERS)
        or {item.filename for item in entries} != DISTRIBUTION_MEMBERS
        or sum(item.file_size for item in entries) > MAX_PACKAGE_BYTES
        or any(item.orig_filename != item.filename
               or not _safe_zip_member(item, *MEMBER_SIZE_LIMITS[item.filename])
               for item in entries)):
        raise ValueError("UNSAFE_DISTRIBUTION_ZIP_ENTRIES")


def verify_distribution_archive(path, *, head_sha, version, accepted_workbook_sha256,
                                accepted_reader_sha256, signing_state="UNSIGNED", signing_evidence=None):
    path = Path(path)
    if (not _is_sha256(accepted_workbook_sha256) or not _is_sha256(accepted_reader_sha256)
        or not path.is_file() or path.is_symlink() or not 0 < path.stat().st_size <= MAX_PACKAGE_BYTES):
        raise ValueError("INVALID_DISTRIBUTION_INPUT_OR_DIGEST")
    expected_vba_sha = validate_release_signing_evidence(
        signing_evidence, head_sha=head_sha, workbook_sha256=accepted_workbook_sha256,
        signing_state=signing_state,
    )
    archive_sha = digest(path)
    try:
        with ZipFile(path) as archive:
            check_distribution_zip_entries(archive.infolist())
            book = archive.read(BOOK_NAME)
            if hashlib.sha256(book).hexdigest() != accepted_workbook_sha256:
                raise ValueError("DISTRIBUTION_WORKBOOK_DIGEST_MISMATCH")
            vba_sha = _verify_xlsm(book, version, signing_state, expected_vba_sha)
            with archive.open(READER_NAME) as reader:
                reader_size = archive.getinfo(READER_NAME).file_size
                _inspect_reader(reader, reader_size)
                reader.seek(0)
                reader_sha = hashlib.sha256()
                for block in iter(lambda: reader.read(1024 * 1024), b""):
                    reader_sha.update(block)
            if reader_sha.hexdigest() != accepted_reader_sha256:
                raise ValueError("DISTRIBUTION_READER_DIGEST_MISMATCH")
            readme = archive.read(README_NAME)
            verify_release_readme(readme, head_sha, version, signing_state)
    except (BadZipFile, ElementTree.ParseError, KeyError, UnicodeError) as exc:
        raise ValueError("INVALID_DISTRIBUTION_PACKAGE_FORMAT") from exc
    if digest(path) != archive_sha:
        raise ValueError("DISTRIBUTION_CHANGED_DURING_VERIFICATION")
    return {
        "schema": DISTRIBUTION_SCHEMA, "head_sha": head_sha, "version": version,
        "archive_sha256": archive_sha, "workbook_sha256": accepted_workbook_sha256,
        "vba_project_sha256": vba_sha, "reader_sha256": accepted_reader_sha256,
        "readme_sha256": hashlib.sha256(readme).hexdigest(), "signing_state": signing_state,
        "reader_signing_state": "UNSIGNED", "package_state": "VERIFIED_NOT_PUBLISHED",
    }


def package_distribution(book, reader, target, *, head_sha, version, accepted_workbook_sha256,
                         accepted_reader_sha256, signing_state="UNSIGNED", signing_evidence=None):
    book, reader, target = map(Path, (book, reader, target))
    if (len({p.resolve() for p in (book, reader, target)}) != 3
        or any(not p.is_file() or p.is_symlink() for p in (book, reader))):
        raise ValueError("INVALID_DISTRIBUTION_INPUT_PATHS")
    for path, name, expected in ((book, BOOK_NAME, accepted_workbook_sha256),
                                 (reader, READER_NAME, accepted_reader_sha256)):
        minimum, maximum = MEMBER_SIZE_LIMITS[name]
        if (not minimum <= path.stat().st_size <= maximum or not _is_sha256(expected)
            or digest(path) != expected):
            raise ValueError("DISTRIBUTION_SOURCE_SIZE_OR_DIGEST_MISMATCH")
    readme = _release_readme(head_sha, version, signing_state)
    validate_release_signing_evidence(signing_evidence, head_sha=head_sha,
                                      workbook_sha256=accepted_workbook_sha256,
                                      signing_state=signing_state)
    created = False
    try:
        with target.open("xb") as output:
            created = True
            with ZipFile(output, "w", ZIP_DEFLATED) as archive:
                for source, name in ((book, BOOK_NAME), (reader, READER_NAME)):
                    member = ZipInfo(name)
                    member.compress_type = ZIP_DEFLATED
                    member.external_attr = (stat.S_IFREG | 0o644) << 16
                    with source.open("rb") as original, archive.open(member, "w") as destination:
                        shutil.copyfileobj(original, destination, length=1024 * 1024)
                archive.writestr(ZipInfo(README_NAME), readme)
        return verify_distribution_archive(target, head_sha=head_sha, version=version,
                                           accepted_workbook_sha256=accepted_workbook_sha256,
                                           accepted_reader_sha256=accepted_reader_sha256,
                                           signing_state=signing_state, signing_evidence=signing_evidence)
    except BaseException:
        if created:
            target.unlink(missing_ok=True)
        raise


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
